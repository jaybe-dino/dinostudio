"""분석 파이프라인.

파일 단위 상태 모델: discovered → downloaded → transcribed (실패는 failed + 재시도).
어느 단계에서 실패해도 그 파일만 건너뛰고 나머지는 계속 처리하며, 다음 실행에서
재시도 여유가 남아 있으면 다시 시도한다.

발행 멱등성:
* 같은 업무일을 다시 실행하면 Notion 페이지는 갱신되고 새로 쌓이지 않는다.
* 분석 내용이 이전과 같으면 Slack은 다시 보내지 않는다.
"""

from __future__ import annotations

import hashlib
import logging
import shutil
from dataclasses import dataclass, field, replace
from datetime import date, datetime
from pathlib import Path
from typing import Any

from .adapters.base import AdapterError, Analyzer, Publisher, RecordingSource, SpeechToText
from .business_date import business_date_of, day_bounds
from .config import Settings
from .models import DailyAnalysis, DailyReport, TranscriptPart
from .prompts import build_combined_transcript
from .store import (
    RECORDING_STATUS_DOWNLOADED,
    RECORDING_STATUS_FAILED,
    RECORDING_STATUS_TRANSCRIBED,
    Store,
)

logger = logging.getLogger(__name__)


@dataclass
class PipelineResult:
    business_date: date
    discovered: int = 0
    transcribed: int = 0
    failed: int = 0
    skipped_already_done: int = 0
    published: list[str] = field(default_factory=list)
    publish_skipped: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    report_version: int | None = None
    truncated: bool = False
    analyzed: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "business_date": self.business_date.isoformat(),
            "discovered": self.discovered,
            "transcribed": self.transcribed,
            "failed": self.failed,
            "skipped_already_done": self.skipped_already_done,
            "published": self.published,
            "publish_skipped": self.publish_skipped,
            "errors": self.errors,
            "report_version": self.report_version,
            "truncated": self.truncated,
            "analyzed": self.analyzed,
        }


class Pipeline:
    def __init__(
        self,
        *,
        settings: Settings,
        store: Store,
        source: RecordingSource,
        stt: SpeechToText,
        analyzer: Analyzer,
        publishers: list[Publisher],
    ):
        self.settings = settings
        self.store = store
        self.source = source
        self.stt = stt
        self.analyzer = analyzer
        self.publishers = publishers

    # ── 1. 수집 ───────────────────────────────────────────────────────
    def discover(self, business_date: date) -> int:
        """저장소를 조회해 해당 업무일 파일을 등록한다. 등록 건수를 돌려준다."""
        since, until = day_bounds(
            business_date, self.settings.timezone, self.settings.business_day_cutoff_hour
        )
        recordings = self.source.list_recordings(since, until)

        registered = 0
        for recording in recordings:
            resolved = recording.business_date_hint or business_date_of(
                recording.created_at,
                self.settings.timezone,
                self.settings.business_day_cutoff_hour,
            )
            if resolved != business_date:
                continue
            self.store.upsert_recording(
                source=self.source.name,
                source_file_id=recording.source_file_id,
                file_name=recording.file_name,
                created_at=recording.created_at,
                business_date=resolved,
                size_bytes=recording.size_bytes,
                web_link=recording.web_link,
            )
            registered += 1
        return registered

    # ── 2. 전사 ───────────────────────────────────────────────────────
    def transcribe_pending(self, business_date: date, result: PipelineResult) -> None:
        pending = self.store.pending_recordings(business_date, self.settings.max_retry_count)
        if not pending:
            return

        work_dir = self.settings.work_dir / business_date.isoformat()
        work_dir.mkdir(parents=True, exist_ok=True)

        for row in pending:
            recording = _row_to_source_recording(row)
            try:
                audio_path = self.source.download(recording, work_dir)
                checksum = _sha256(audio_path)
                self.store.mark_recording(
                    row["id"], RECORDING_STATUS_DOWNLOADED, checksum=checksum
                )

                transcript = self.stt.transcribe(audio_path)
                self.store.save_transcription(
                    row["id"],
                    text=transcript.text,
                    language=transcript.language,
                    duration_seconds=transcript.duration_seconds,
                    model=transcript.model,
                )
                self.store.mark_recording(row["id"], RECORDING_STATUS_TRANSCRIBED, error=None)
                result.transcribed += 1
                logger.info("전사 완료: %s (%d자)", row["file_name"], transcript.char_count)
            except (AdapterError, OSError, ValueError) as exc:
                message = f"{row['file_name']}: {exc}"
                self.store.mark_recording(
                    row["id"], RECORDING_STATUS_FAILED, error=str(exc), bump_retry=True
                )
                result.failed += 1
                result.errors.append(message)
                logger.warning("전사 실패 — %s", message)

        if not self.settings.keep_downloads:
            shutil.rmtree(work_dir, ignore_errors=True)

    # ── 3~5. 분석·저장·발행 ────────────────────────────────────────────
    def build_report(
        self, business_date: date, *, force: bool = False
    ) -> tuple[DailyReport | None, bool, bool]:
        """(리포트, 잘림 여부, 새로 분석했는지)를 돌려준다.

        전사 내용이 지난번 리포트와 같으면 LLM을 다시 호출하지 않고 저장된 분석을
        재사용한다. 자정 실행과 수동 실행이 겹쳐도 비용과 결과가 흔들리지 않는다.
        """
        rows = self.store.transcripts_for_date(business_date)
        if not rows:
            return None, False, False

        parts = [
            TranscriptPart(
                file_name=row["file_name"],
                text=row["text"],
                created_at=datetime.fromisoformat(row["created_at"]),
                web_link=row["web_link"],
            )
            for row in rows
        ]
        combined, truncated = build_combined_transcript(
            parts, self.settings.max_transcript_chars
        )
        transcript_hash = _transcript_hash(parts)

        existing = self.store.daily_report(business_date)
        reuse = (
            existing is not None
            and not force
            and existing["transcript_hash"] == transcript_hash
            and existing["transcript_hash"] != ""
        )
        if reuse:
            analysis = analysis_from_row(existing)
            analyzed = False
            logger.info("업무일 %s: 전사 변경 없음 — 저장된 분석 재사용", business_date)
        else:
            analysis = self.analyzer.analyze(business_date.isoformat(), combined)
            analyzed = True

        report = DailyReport(
            business_date=business_date,
            analysis=analysis,
            recording_count=len(parts),
            transcript_chars=sum(len(part.text) for part in parts),
            file_links=[part.web_link or "" for part in parts],
            file_names=[part.file_name for part in parts],
            transcript_text=combined,
            transcript_hash=transcript_hash,
        )
        return report, truncated, analyzed

    def publish(self, report: DailyReport, *, force: bool = False) -> tuple[list[str], list[str]]:
        published: list[str] = []
        skipped: list[str] = []
        content_hash = report.analysis.content_hash()

        for publisher in self.publishers:
            previous = self.store.publication(report.business_date, publisher.name)
            unchanged = previous is not None and previous["content_hash"] == content_hash
            if unchanged and not force:
                skipped.append(publisher.name)
                logger.info("발행 생략(내용 동일): %s", publisher.name)
                continue

            outcome = publisher.publish(
                report, previous["external_id"] if previous else None
            )
            self.store.record_publication(
                report.business_date,
                publisher.name,
                external_id=outcome.external_id,
                url=outcome.url,
                content_hash=content_hash,
            )
            published.append(publisher.name)
        return published, skipped

    # ── 전체 실행 ─────────────────────────────────────────────────────
    def run_daily(
        self,
        business_date: date,
        *,
        force: bool = False,
        skip_publish: bool = False,
    ) -> PipelineResult:
        result = PipelineResult(business_date=business_date)
        logger.info("업무일 %s 처리 시작", business_date)

        try:
            result.discovered = self.discover(business_date)
        except (AdapterError, OSError) as exc:
            result.errors.append(f"저장소 조회 실패: {exc}")
            logger.error("저장소 조회 실패: %s", exc)

        before = {
            row["id"]
            for row in self.store.recordings_for_date(business_date)
            if row["status"] == RECORDING_STATUS_TRANSCRIBED
        }
        result.skipped_already_done = len(before)

        self.transcribe_pending(business_date, result)

        report, truncated, analyzed = self.build_report(business_date, force=force)
        result.truncated = truncated
        result.analyzed = analyzed
        if report is None:
            logger.info("업무일 %s: 전사된 내용이 없어 분석을 건너뜁니다.", business_date)
            return result

        stored = self.store.save_daily_report(
            business_date,
            title=report.analysis.daily_title,
            summary=report.analysis.executive_summary,
            payload=report.analysis.to_dict(),
            recording_count=report.recording_count,
            transcript_chars=report.transcript_chars,
            content_hash=report.analysis.content_hash(),
            transcript_hash=report.transcript_hash,
        )
        result.report_version = stored["version"]
        report = replace(report, version=stored["version"])

        if skip_publish:
            logger.info("발행 생략 옵션이 켜져 있습니다.")
            return result

        published, skipped = self.publish(report, force=force)
        result.published = published
        result.publish_skipped = skipped
        return result


def _row_to_source_recording(row) -> Any:
    from .models import SourceRecording

    return SourceRecording(
        source_file_id=row["source_file_id"],
        file_name=row["file_name"],
        created_at=datetime.fromisoformat(row["created_at"]),
        size_bytes=row["size_bytes"],
        web_link=row["web_link"],
    )


def _transcript_hash(parts: list[TranscriptPart]) -> str:
    """전사 집합의 지문. 파일 구성이나 내용이 바뀌면 값이 달라진다."""
    digest = hashlib.sha256()
    for part in parts:
        digest.update(part.file_name.encode("utf-8"))
        digest.update(part.text.encode("utf-8"))
    return digest.hexdigest()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def analysis_from_row(row) -> DailyAnalysis:
    import json

    return DailyAnalysis.from_dict(json.loads(row["payload"]))
