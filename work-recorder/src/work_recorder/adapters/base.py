"""어댑터 인터페이스.

파이프라인은 이 네 개의 프로토콜만 알고, 실제 서비스(Drive/S3, Whisper, Claude,
Notion, Slack)는 어댑터 뒤에 있다. 공급자를 바꿀 때 pipeline.py는 손대지 않는다.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Protocol, runtime_checkable

from ..models import DailyAnalysis, DailyReport, PublishResult, SourceRecording, Transcript


class AdapterError(RuntimeError):
    """어댑터가 외부 서비스 호출에 실패했을 때. 파이프라인이 파일 단위로 처리한다."""


@runtime_checkable
class RecordingSource(Protocol):
    """녹음 파일 저장소 (Google Drive, 로컬 폴더, S3 등)."""

    name: str

    def list_recordings(self, since: datetime, until: datetime) -> list[SourceRecording]:
        """[since, until) 구간에 생성된 오디오 파일 목록."""

    def download(self, recording: SourceRecording, dest_dir: Path) -> Path:
        """파일을 로컬로 내려받고 경로를 돌려준다."""


@runtime_checkable
class SpeechToText(Protocol):
    """음성 → 텍스트."""

    name: str

    def transcribe(self, audio_path: Path) -> Transcript: ...


@runtime_checkable
class Analyzer(Protocol):
    """하루치 전사 → 구조화된 분석 결과."""

    name: str

    def analyze(self, business_date_label: str, combined_transcript: str) -> DailyAnalysis: ...


@runtime_checkable
class Publisher(Protocol):
    """분석 결과 발행 (Notion, Slack, 콘솔 등)."""

    name: str

    def publish(self, report: DailyReport, previous_external_id: str | None) -> PublishResult:
        """`previous_external_id`가 있으면 새로 만들지 않고 갱신한다 (Notion 페이지 갱신 등)."""
