"""하루치 전사 → 구조화된 분석 결과.

기본 구현은 Anthropic Claude이며, 응답은 `output_config.format`의 JSON 스키마로
제약한다. 기존 구현처럼 프롬프트로만 JSON을 부탁하고 파싱이 깨지면 빈 결과를
반환하는 대신, API가 스키마를 강제하도록 했다.

프롬프트는 코드에서 분리해 두었다(`prompts.py`). 개발 계획이 요구한 대로 결과
포맷을 코드 배포 없이 조정할 수 있게 하기 위해서다.
"""

from __future__ import annotations

import json
from pathlib import Path

from ..models import ANALYSIS_JSON_SCHEMA, DailyAnalysis
from ..prompts import ANALYSIS_SYSTEM_PROMPT, build_analysis_user_message
from .base import AdapterError

# Claude Opus 5는 정책 거절 시 서버측 폴백을 켤 수 있다. 업무 요약에서 거절이 날 일은
# 드물지만, 하루치 리포트가 통째로 비는 것보다 폴백으로라도 나오는 편이 낫다.
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class ClaudeAnalyzer:
    name = "claude"

    def __init__(
        self,
        *,
        api_key: str = "",
        model: str = "claude-opus-5",
        effort: str = "high",
        max_tokens: int = 16000,
        enable_fallbacks: bool = True,
        system_prompt: str | None = None,
        client=None,
    ):
        self.model = model
        self.effort = effort
        self.max_tokens = max_tokens
        self.enable_fallbacks = enable_fallbacks
        self.system_prompt = system_prompt or ANALYSIS_SYSTEM_PROMPT
        self._client = client
        self._api_key = api_key

    @property
    def client(self):
        if self._client is None:
            try:
                import anthropic
            except ImportError as exc:  # pragma: no cover
                raise AdapterError(
                    'Claude 분석기에는 anthropic 패키지가 필요합니다: pip install "work-recorder[claude]"'
                ) from exc
            # api_key가 비어 있으면 SDK가 환경 변수나 `ant auth login` 프로필을 찾는다.
            self._client = (
                anthropic.Anthropic(api_key=self._api_key)
                if self._api_key
                else anthropic.Anthropic()
            )
        return self._client

    def analyze(self, business_date_label: str, combined_transcript: str) -> DailyAnalysis:
        if not combined_transcript.strip():
            raise AdapterError("분석할 전사 텍스트가 비어 있습니다.")

        messages = [
            {
                "role": "user",
                "content": build_analysis_user_message(business_date_label, combined_transcript),
            }
        ]
        request = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "system": self.system_prompt,
            "messages": messages,
            "thinking": {"type": "adaptive"},
            "output_config": {
                "effort": self.effort,
                "format": {"type": "json_schema", "schema": ANALYSIS_JSON_SCHEMA},
            },
        }

        text = self._call(request)
        try:
            payload = json.loads(text)
        except json.JSONDecodeError as exc:
            raise AdapterError(f"분석 응답이 JSON이 아닙니다: {exc}") from exc
        return DailyAnalysis.from_dict(payload)

    def _call(self, request: dict) -> str:
        """긴 전사를 다루므로 스트리밍으로 호출한다 (HTTP 타임아웃 방지)."""
        if self.enable_fallbacks:
            try:
                return self._stream(
                    self.client.beta.messages,
                    dict(request, betas=[FALLBACK_BETA], fallbacks="default"),
                )
            except Exception as exc:  # noqa: BLE001 - 폴백 미지원 환경이면 기본 경로로 재시도
                if not _is_unsupported_parameter(exc):
                    raise AdapterError(f"Claude 분석 실패: {exc}") from exc

        try:
            return self._stream(self.client.messages, request)
        except Exception as exc:  # noqa: BLE001
            raise AdapterError(f"Claude 분석 실패: {exc}") from exc

    @staticmethod
    def _stream(messages_api, request: dict) -> str:
        with messages_api.stream(**request) as stream:
            message = stream.get_final_message()

        if getattr(message, "stop_reason", None) == "refusal":
            details = getattr(message, "stop_details", None)
            raise AdapterError(f"모델이 응답을 거절했습니다: {getattr(details, 'category', None)}")

        for block in message.content:
            if getattr(block, "type", None) == "text":
                return block.text
        raise AdapterError("응답에 텍스트 블록이 없습니다.")


def _is_unsupported_parameter(exc: Exception) -> bool:
    """베타 파라미터를 지원하지 않는 SDK/엔드포인트인지 판별한다."""
    if isinstance(exc, TypeError):
        return True
    message = str(exc).lower()
    return "fallbacks" in message or "beta" in message or "unexpected keyword" in message


class MockAnalyzer:
    """키 없이 파이프라인을 검증하기 위한 분석기."""

    name = "mock"

    def __init__(self, *, result: DailyAnalysis | None = None, fixture: Path | None = None):
        self._result = result
        self._fixture = fixture

    def analyze(self, business_date_label: str, combined_transcript: str) -> DailyAnalysis:
        if self._result is not None:
            return self._result
        if self._fixture is not None and self._fixture.exists():
            return DailyAnalysis.from_dict(json.loads(self._fixture.read_text(encoding="utf-8")))

        head = combined_transcript.strip().splitlines()
        preview = next((line for line in head if line and not line.startswith("---")), "")
        return DailyAnalysis(
            daily_title=f"{business_date_label} 업무 녹음 (mock)",
            executive_summary=preview[:300],
            quality_notes=["mock 분석기 결과입니다. 실제 분석은 ANALYZER_ADAPTER=claude로 전환하세요."],
        )
