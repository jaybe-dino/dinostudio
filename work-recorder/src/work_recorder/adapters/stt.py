"""음성 → 텍스트 어댑터.

* `OpenAICompatibleSTT` — `/audio/transcriptions` 규격을 따르는 모든 공급자
  (OpenAI Whisper, Groq, 로컬 whisper 서버 등)를 `STT_BASE_URL`로 갈아끼울 수 있다.
* `MockSTT` — 키 없이 파이프라인 전체를 돌려보기 위한 구현. 오디오 옆에 같은 이름의
  `.txt` 파일이 있으면 그 내용을 전사 결과로 쓴다.

기존 구현은 `manus-speech-to-text` CLI에 묶여 있었는데, 이관 문서가 지적한 대로
공급자 교체가 가능해야 해서 어댑터로 분리했다.
"""

from __future__ import annotations

import wave
from pathlib import Path

from ..http import HttpError, post_multipart
from ..models import Transcript
from .base import AdapterError

# 대부분의 호스팅 STT가 25MB 업로드 제한을 둔다. 녹음 앱이 30분 청크로 나누므로
# 보통은 걸리지 않지만, 넘어가면 원인을 분명히 알려 준다.
DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024


class OpenAICompatibleSTT:
    name = "openai_compatible"

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str = "whisper-1",
        language: str = "ko",
        timeout_seconds: int = 600,
        max_upload_bytes: int = DEFAULT_MAX_UPLOAD_BYTES,
    ):
        if not api_key:
            raise AdapterError("STT_API_KEY가 필요합니다.")
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.language = language
        self.timeout_seconds = timeout_seconds
        self.max_upload_bytes = max_upload_bytes

    def transcribe(self, audio_path: Path) -> Transcript:
        size = audio_path.stat().st_size
        if size > self.max_upload_bytes:
            raise AdapterError(
                f"파일이 STT 업로드 한도를 넘습니다 ({size / 1024 / 1024:.1f}MB > "
                f"{self.max_upload_bytes / 1024 / 1024:.0f}MB): {audio_path.name}. "
                "녹음 앱의 청크 길이를 줄이거나 사전 분할이 필요합니다."
            )

        fields = {"model": self.model, "response_format": "verbose_json"}
        if self.language:
            fields["language"] = self.language

        try:
            data = post_multipart(
                f"{self.base_url}/audio/transcriptions",
                file_path=audio_path,
                fields=fields,
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=self.timeout_seconds,
            )
        except HttpError as exc:
            raise AdapterError(f"STT 실패 ({audio_path.name}): {exc}") from exc
        except OSError as exc:
            raise AdapterError(f"STT 네트워크 실패 ({audio_path.name}): {exc}") from exc

        text = str(data.get("text", "")).strip()
        if not text:
            raise AdapterError(f"STT 결과가 비어 있습니다: {audio_path.name}")

        duration = data.get("duration")
        return Transcript(
            text=text,
            language=str(data.get("language") or self.language or ""),
            duration_seconds=float(duration) if duration is not None else _wav_duration(audio_path),
            model=self.model,
        )


class MockSTT:
    """키 없이 쓰는 개발·테스트용 STT."""

    name = "mock"

    def __init__(self, *, fallback_text: str = ""):
        self.fallback_text = fallback_text

    def transcribe(self, audio_path: Path) -> Transcript:
        sidecar = audio_path.with_suffix(".txt")
        if sidecar.exists():
            text = sidecar.read_text(encoding="utf-8").strip()
        elif self.fallback_text:
            text = self.fallback_text
        else:
            text = f"[mock 전사] {audio_path.name}"
        return Transcript(
            text=text,
            language="ko",
            duration_seconds=_wav_duration(audio_path),
            model="mock",
        )


def _wav_duration(audio_path: Path) -> float | None:
    """WAV면 길이를 읽는다. 다른 포맷이면 None (외부 도구를 쓰지 않는다)."""
    if audio_path.suffix.lower() != ".wav":
        return None
    try:
        with wave.open(str(audio_path), "rb") as handle:
            frames = handle.getnframes()
            rate = handle.getframerate()
            return frames / rate if rate else None
    except (wave.Error, OSError):
        return None
