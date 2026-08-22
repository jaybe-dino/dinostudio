"""테스트 공용 헬퍼."""

from __future__ import annotations

import os
import wave
from datetime import date, datetime, timezone
from pathlib import Path

from work_recorder.models import PublishResult, Transcript

KST_MARCH_21 = date(2026, 3, 21)


class RecordingPublisher:
    """발행 호출을 기록하는 테스트용 퍼블리셔."""

    def __init__(self, name: str = "notion", *, fail: bool = False):
        self.name = name
        self.calls: list[tuple[str, str | None]] = []
        self.fail = fail

    def publish(self, report, previous_external_id):
        if self.fail:
            raise RuntimeError("발행 실패")
        self.calls.append((report.analysis.daily_title, previous_external_id))
        external_id = previous_external_id or f"{self.name}-page-1"
        return PublishResult(
            channel=self.name, external_id=external_id, url=f"https://example/{external_id}"
        )


def write_wav(path: Path, seconds: float = 0.2) -> Path:
    """무음 WAV 파일을 만든다 (길이 계산 테스트용)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    frame_rate = 8000
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(frame_rate)
        handle.writeframes(b"\x00\x00" * int(frame_rate * seconds))
    return path


def add_recording(
    directory: Path,
    file_name: str,
    transcript: str,
    *,
    mtime: datetime | None = None,
) -> Path:
    """녹음 파일 + mock STT가 읽을 사이드카 전사 파일을 만든다."""
    audio = write_wav(directory / file_name)
    audio.with_suffix(".txt").write_text(transcript, encoding="utf-8")
    if mtime is not None:
        stamp = mtime.timestamp()
        os.utime(audio, (stamp, stamp))
    return audio


def utc(year: int, month: int, day: int, hour: int = 0, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


class SidecarSTT:
    """녹음 폴더의 같은 이름 `.txt`를 전사 결과로 쓰는 테스트용 STT.

    파이프라인은 오디오를 작업 폴더로 내려받은 뒤 전사하므로, 사이드카는 원본
    폴더를 기준으로 찾는다.
    """

    name = "sidecar"

    def __init__(self, directory: Path):
        self.directory = Path(directory)

    def transcribe(self, audio_path: Path) -> Transcript:
        sidecar = self.directory / f"{audio_path.stem}.txt"
        text = (
            sidecar.read_text(encoding="utf-8").strip()
            if sidecar.exists()
            else f"[전사] {audio_path.name}"
        )
        return Transcript(text=text, language="ko", model="sidecar")
