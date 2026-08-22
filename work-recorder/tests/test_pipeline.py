"""파이프라인 — 이관 문서가 제시한 수용 기준을 코드로 고정한다.

* 동일 업무일 재실행 시 Notion·Slack 결과가 중복되지 않는다.
* 한 파일이 실패해도 나머지는 처리되고, 실패 파일은 다음 실행에서 재시도된다.
* 자정 전후 파일이 올바른 업무일로 분류된다.
"""

from __future__ import annotations

from datetime import date

from work_recorder.adapters.analyzer import MockAnalyzer
from work_recorder.adapters.base import AdapterError
from work_recorder.models import DailyAnalysis
from work_recorder.store import RECORDING_STATUS_FAILED, RECORDING_STATUS_TRANSCRIBED

from helpers import KST_MARCH_21, RecordingPublisher, SidecarSTT, add_recording, utc


class ExplodingSTT:
    """지정한 파일만 실패시키는 STT."""

    name = "exploding"

    def __init__(self, inner, failing_names: set[str], *, fail_times: int | None = None):
        self.inner = inner
        self.failing_names = failing_names
        self.fail_times = fail_times
        self.attempts: dict[str, int] = {}

    def transcribe(self, audio_path):
        count = self.attempts.get(audio_path.name, 0) + 1
        self.attempts[audio_path.name] = count
        should_fail = audio_path.name in self.failing_names and (
            self.fail_times is None or count <= self.fail_times
        )
        if should_fail:
            raise AdapterError("STT 서비스 오류")
        return self.inner.transcribe(audio_path)


def test_full_run_transcribes_analyzes_and_publishes(build_pipeline, recordings_dir, store):
    add_recording(recordings_dir, "업무녹음_20260321_060127_part001.wav", "킥오프 회의입니다.")
    add_recording(recordings_dir, "업무녹음_20260321_063127_part002.wav", "견적서 이야기를 했습니다.")

    publisher = RecordingPublisher("notion")
    pipeline = build_pipeline(publishers=[publisher])
    result = pipeline.run_daily(KST_MARCH_21)

    assert result.discovered == 2
    assert result.transcribed == 2
    assert result.failed == 0
    assert result.analyzed is True
    assert result.published == ["notion"]
    assert result.report_version == 1

    report = store.daily_report(KST_MARCH_21)
    assert report["title"] == "3/21 킥오프"
    assert report["recording_count"] == 2
    # 원본은 병합 순서대로 들어간다.
    transcripts = store.transcripts_for_date(KST_MARCH_21)
    assert [row["file_name"] for row in transcripts] == [
        "업무녹음_20260321_060127_part001.wav",
        "업무녹음_20260321_063127_part002.wav",
    ]


def test_rerun_is_idempotent(build_pipeline, recordings_dir, store):
    """같은 업무일을 다시 돌려도 전사·분석·발행이 중복되지 않는다."""
    add_recording(recordings_dir, "업무녹음_20260321_060127_part001.wav", "킥오프 회의입니다.")

    publisher = RecordingPublisher("notion")
    analyzer = MockAnalyzer(result=DailyAnalysis(daily_title="3/21 킥오프"))
    pipeline = build_pipeline(publishers=[publisher], analyzer=analyzer)

    first = pipeline.run_daily(KST_MARCH_21)
    second = pipeline.run_daily(KST_MARCH_21)

    assert first.transcribed == 1
    assert second.transcribed == 0  # 이미 전사된 파일은 다시 하지 않는다
    assert second.skipped_already_done == 1
    assert second.analyzed is False  # 전사가 그대로면 LLM을 다시 부르지 않는다
    assert second.published == []
    assert second.publish_skipped == ["notion"]
    assert len(publisher.calls) == 1  # Notion 페이지는 한 번만 생성
    assert second.report_version == 1  # 내용이 같으면 버전도 올리지 않는다

    assert len(store.recordings_for_date(KST_MARCH_21)) == 1


def test_new_file_next_day_updates_existing_publication(build_pipeline, recordings_dir, store):
    """파일이 추가되면 재분석하고, 기존 발행물을 갱신한다(새로 만들지 않는다)."""
    add_recording(recordings_dir, "업무녹음_20260321_060127_part001.wav", "1부 내용")
    publisher = RecordingPublisher("notion")
    pipeline = build_pipeline(publishers=[publisher])
    pipeline.run_daily(KST_MARCH_21)

    add_recording(recordings_dir, "업무녹음_20260321_070127_part002.wav", "2부 내용")
    # 분석 결과도 달라져야 발행이 다시 일어난다.
    pipeline.analyzer = MockAnalyzer(result=DailyAnalysis(daily_title="3/21 킥오프 (갱신)"))
    second = pipeline.run_daily(KST_MARCH_21)

    assert second.transcribed == 1
    assert second.analyzed is True
    assert second.published == ["notion"]
    assert second.report_version == 2
    # 두 번째 호출은 기존 page id를 넘겨받는다 → 새 페이지가 아니라 갱신
    assert publisher.calls[1][1] == "notion-page-1"


def test_force_republishes_even_when_unchanged(build_pipeline, recordings_dir):
    add_recording(recordings_dir, "업무녹음_20260321_060127_part001.wav", "킥오프")
    publisher = RecordingPublisher("slack")
    pipeline = build_pipeline(publishers=[publisher])

    pipeline.run_daily(KST_MARCH_21)
    forced = pipeline.run_daily(KST_MARCH_21, force=True)

    assert forced.published == ["slack"]
    assert len(publisher.calls) == 2


def test_failed_file_does_not_block_the_others(build_pipeline, recordings_dir, store):
    add_recording(recordings_dir, "업무녹음_20260321_060127_part001.wav", "정상 파일")
    add_recording(recordings_dir, "업무녹음_20260321_063127_part002.wav", "실패 파일")

    stt = ExplodingSTT(SidecarSTT(recordings_dir), {"업무녹음_20260321_063127_part002.wav"})
    result = build_pipeline(stt=stt).run_daily(KST_MARCH_21)

    assert result.transcribed == 1
    assert result.failed == 1
    assert result.analyzed is True  # 성공한 파일만으로 리포트를 만든다
    assert any("part002" in message for message in result.errors)

    statuses = {row["file_name"]: row for row in store.recordings_for_date(KST_MARCH_21)}
    failed = statuses["업무녹음_20260321_063127_part002.wav"]
    assert failed["status"] == RECORDING_STATUS_FAILED
    assert failed["retry_count"] == 1
    assert statuses["업무녹음_20260321_060127_part001.wav"]["status"] == RECORDING_STATUS_TRANSCRIBED


def test_failed_file_is_retried_on_next_run(build_pipeline, recordings_dir, store):
    add_recording(recordings_dir, "업무녹음_20260321_060127_part001.wav", "복구되는 파일")
    stt = ExplodingSTT(SidecarSTT(recordings_dir), {"업무녹음_20260321_060127_part001.wav"}, fail_times=1)
    pipeline = build_pipeline(stt=stt)

    first = pipeline.run_daily(KST_MARCH_21)
    second = pipeline.run_daily(KST_MARCH_21)

    assert first.failed == 1 and first.transcribed == 0
    assert second.transcribed == 1 and second.failed == 0
    row = store.recordings_for_date(KST_MARCH_21)[0]
    assert row["status"] == RECORDING_STATUS_TRANSCRIBED
    assert row["error"] is None


def test_retry_limit_stops_endless_failures(build_pipeline, recordings_dir, settings, store):
    settings.max_retry_count = 2
    add_recording(recordings_dir, "업무녹음_20260321_060127_part001.wav", "계속 실패")
    stt = ExplodingSTT(SidecarSTT(recordings_dir), {"업무녹음_20260321_060127_part001.wav"})
    pipeline = build_pipeline(stt=stt)

    for _ in range(4):
        pipeline.run_daily(KST_MARCH_21)

    assert stt.attempts["업무녹음_20260321_060127_part001.wav"] == 2
    assert store.recordings_for_date(KST_MARCH_21)[0]["retry_count"] == 2


def test_files_are_grouped_by_business_date_not_utc_date(build_pipeline, recordings_dir, store):
    """UTC로는 20일 저녁이지만 KST로는 21일 새벽인 파일."""
    add_recording(
        recordings_dir,
        "recording-a.wav",  # 이름에 힌트가 없으므로 mtime으로 판단
        "자정 직후 녹음",
        mtime=utc(2026, 3, 20, 15, 30),  # KST 3/21 00:30
    )
    add_recording(
        recordings_dir,
        "recording-b.wav",
        "자정 직전 녹음",
        mtime=utc(2026, 3, 20, 14, 30),  # KST 3/20 23:30
    )

    pipeline = build_pipeline()
    result_21 = pipeline.run_daily(date(2026, 3, 21))
    result_20 = pipeline.run_daily(date(2026, 3, 20))

    assert [row["file_name"] for row in store.recordings_for_date(date(2026, 3, 21))] == [
        "recording-a.wav"
    ]
    assert [row["file_name"] for row in store.recordings_for_date(date(2026, 3, 20))] == [
        "recording-b.wav"
    ]
    assert result_21.transcribed == 1
    assert result_20.transcribed == 1


def test_filename_hint_beats_mtime(build_pipeline, recordings_dir, store):
    """복사·이동으로 mtime이 바뀌어도 파일명의 업무일을 신뢰한다."""
    add_recording(
        recordings_dir,
        "업무녹음_20260321_060127_part001.wav",
        "3월 21일 녹음",
        mtime=utc(2026, 4, 1, 0, 0),  # 한참 뒤로 바뀐 mtime
    )

    build_pipeline().run_daily(KST_MARCH_21)

    assert len(store.recordings_for_date(KST_MARCH_21)) == 1


def test_no_recordings_produces_no_report(build_pipeline, recordings_dir, store):
    publisher = RecordingPublisher("notion")
    result = build_pipeline(publishers=[publisher]).run_daily(KST_MARCH_21)

    assert result.discovered == 0
    assert result.analyzed is False
    assert result.published == []
    assert store.daily_report(KST_MARCH_21) is None
    assert publisher.calls == []


def test_skip_publish_still_stores_report(build_pipeline, recordings_dir, store):
    add_recording(recordings_dir, "업무녹음_20260321_060127_part001.wav", "내용")
    publisher = RecordingPublisher("notion")

    result = build_pipeline(publishers=[publisher]).run_daily(KST_MARCH_21, skip_publish=True)

    assert result.analyzed is True
    assert publisher.calls == []
    assert store.daily_report(KST_MARCH_21) is not None


def test_long_transcript_is_truncated_with_notice(build_pipeline, recordings_dir, settings):
    settings.max_transcript_chars = 300
    add_recording(recordings_dir, "업무녹음_20260321_060127_part001.wav", "가" * 500)
    add_recording(recordings_dir, "업무녹음_20260321_063127_part002.wav", "나" * 500)

    captured = {}

    class CapturingAnalyzer:
        name = "capturing"

        def analyze(self, label, combined):
            captured["combined"] = combined
            return DailyAnalysis(daily_title="긴 하루")

    result = build_pipeline(analyzer=CapturingAnalyzer()).run_daily(KST_MARCH_21)

    assert result.truncated is True
    assert "생략되었습니다" in captured["combined"]
    assert len(captured["combined"]) < 700


def test_downloads_are_cleaned_up_by_default(build_pipeline, recordings_dir, settings):
    add_recording(recordings_dir, "업무녹음_20260321_060127_part001.wav", "내용")
    build_pipeline().run_daily(KST_MARCH_21)
    assert not (settings.work_dir / KST_MARCH_21.isoformat()).exists()
