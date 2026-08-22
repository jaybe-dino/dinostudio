"""도메인 모델과 AI 분석 결과 스키마.

분석 결과 필드는 기존 구현(process_recordings.py)의 산출물 구조를 그대로 계승하되,
개발 계획에서 요구한 `confidence`와 `source_excerpt`를 할 일에 추가했다.
사용자가 요약을 원문과 대조해서 검증할 수 있어야 하기 때문이다.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import date, datetime
from typing import Any

PRIORITIES = ("높음", "중간", "낮음")


@dataclass(frozen=True)
class SourceRecording:
    """저장소(어댑터)가 발견한 원본 녹음 파일 한 건."""

    source_file_id: str
    file_name: str
    created_at: datetime
    size_bytes: int | None = None
    web_link: str | None = None
    mime_type: str | None = None
    business_date_hint: date | None = None


@dataclass(frozen=True)
class Transcript:
    text: str
    language: str | None = None
    duration_seconds: float | None = None
    model: str | None = None

    @property
    def char_count(self) -> int:
        return len(self.text)


@dataclass(frozen=True)
class TranscriptPart:
    """하루치 분석에 들어가는 파일별 전사 조각."""

    file_name: str
    text: str
    created_at: datetime
    web_link: str | None = None


@dataclass
class Meeting:
    topic: str = ""
    summary: str = ""
    time_hint: str = ""


@dataclass
class Todo:
    task: str = ""
    assignee: str = ""
    priority: str = "중간"
    deadline: str = "없음"
    confidence: str = "중간"
    source_excerpt: str = ""


@dataclass
class DailyAnalysis:
    """하루치 종합 분석 결과."""

    daily_title: str = ""
    executive_summary: str = ""
    meetings: list[Meeting] = field(default_factory=list)
    todos: list[Todo] = field(default_factory=list)
    key_decisions: list[str] = field(default_factory=list)
    issues: list[str] = field(default_factory=list)
    participants: list[str] = field(default_factory=list)
    follow_ups: list[str] = field(default_factory=list)
    quality_notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DailyAnalysis":
        def _strings(key: str) -> list[str]:
            raw = data.get(key) or []
            return [str(item) for item in raw if str(item).strip()]

        meetings = [
            Meeting(
                topic=str(item.get("topic", "")),
                summary=str(item.get("summary", "")),
                time_hint=str(item.get("time_hint", "")),
            )
            for item in (data.get("meetings") or [])
            if isinstance(item, dict)
        ]
        todos = []
        for item in data.get("todos") or []:
            if not isinstance(item, dict):
                continue
            priority = str(item.get("priority", "중간")) or "중간"
            todos.append(
                Todo(
                    task=str(item.get("task", "")),
                    assignee=str(item.get("assignee", "") or ""),
                    priority=priority if priority in PRIORITIES else "중간",
                    deadline=str(item.get("deadline", "없음") or "없음"),
                    confidence=str(item.get("confidence", "중간") or "중간"),
                    source_excerpt=str(item.get("source_excerpt", "") or ""),
                )
            )
        return cls(
            daily_title=str(data.get("daily_title", "")),
            executive_summary=str(data.get("executive_summary", "")),
            meetings=meetings,
            todos=[todo for todo in todos if todo.task.strip()],
            key_decisions=_strings("key_decisions"),
            issues=_strings("issues"),
            participants=_strings("participants"),
            follow_ups=_strings("follow_ups"),
            quality_notes=_strings("quality_notes"),
        )

    def content_hash(self) -> str:
        """발행 멱등성 판단용 해시. 같은 내용이면 다시 알리지 않는다."""
        import hashlib

        blob = json.dumps(self.to_dict(), ensure_ascii=False, sort_keys=True)
        return hashlib.sha256(blob.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class DailyReport:
    """분석 결과 + 그날의 원본 메타데이터."""

    business_date: date
    analysis: DailyAnalysis
    recording_count: int = 0
    transcript_chars: int = 0
    file_links: list[str] = field(default_factory=list)
    file_names: list[str] = field(default_factory=list)
    transcript_text: str = ""
    transcript_hash: str = ""
    version: int = 1


@dataclass(frozen=True)
class PublishResult:
    channel: str
    external_id: str | None = None
    url: str | None = None
    skipped: bool = False
    detail: str = ""


# ── LLM 구조화 출력 스키마 ────────────────────────────────────────────────
# Anthropic `output_config.format` 의 json_schema 로 그대로 사용한다.
# strict 검증을 위해 모든 오브젝트에 additionalProperties: false 와 required 를 둔다.

ANALYSIS_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "daily_title": {
            "type": "string",
            "description": "오늘 하루를 대표하는 제목 (예: '3/21 신규 프로젝트 킥오프 및 마케팅 전략 회의')",
        },
        "executive_summary": {
            "type": "string",
            "description": "오늘 하루 전체를 3-5문장으로 요약",
        },
        "meetings": {
            "type": "array",
            "description": "주제별로 분리한 회의/대화 목록",
            "items": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string"},
                    "summary": {"type": "string", "description": "핵심 내용 2-3문장"},
                    "time_hint": {
                        "type": "string",
                        "description": "대략적인 시간대 또는 녹음 파트 번호. 모르면 빈 문자열",
                    },
                },
                "required": ["topic", "summary", "time_hint"],
                "additionalProperties": False,
            },
        },
        "todos": {
            "type": "array",
            "description": "구체적이고 실행 가능한 할 일",
            "items": {
                "type": "object",
                "properties": {
                    "task": {"type": "string"},
                    "assignee": {"type": "string", "description": "언급되지 않았으면 빈 문자열"},
                    "priority": {"type": "string", "enum": list(PRIORITIES)},
                    "deadline": {"type": "string", "description": "마감일 또는 '없음'"},
                    "confidence": {
                        "type": "string",
                        "enum": list(PRIORITIES),
                        "description": "전사 품질과 문맥을 고려한 이 항목의 신뢰도",
                    },
                    "source_excerpt": {
                        "type": "string",
                        "description": "근거가 된 전사 원문 일부(한 문장 내외). 사용자가 원문과 대조할 수 있게 한다",
                    },
                },
                "required": [
                    "task",
                    "assignee",
                    "priority",
                    "deadline",
                    "confidence",
                    "source_excerpt",
                ],
                "additionalProperties": False,
            },
        },
        "key_decisions": {
            "type": "array",
            "items": {"type": "string"},
            "description": "오늘 내려진 주요 결정사항",
        },
        "issues": {
            "type": "array",
            "items": {"type": "string"},
            "description": "주의가 필요한 이슈나 리스크",
        },
        "participants": {
            "type": "array",
            "items": {"type": "string"},
            "description": "오늘 언급된 참여자/담당자 이름. 없으면 빈 배열",
        },
        "follow_ups": {
            "type": "array",
            "items": {"type": "string"},
            "description": "내일 또는 향후 후속 조치가 필요한 사항",
        },
        "quality_notes": {
            "type": "array",
            "items": {"type": "string"},
            "description": "전사 품질 경고(무음 구간, 잡음, 끊김 등). 문제가 없으면 빈 배열",
        },
    },
    "required": [
        "daily_title",
        "executive_summary",
        "meetings",
        "todos",
        "key_decisions",
        "issues",
        "participants",
        "follow_ups",
        "quality_notes",
    ],
    "additionalProperties": False,
}
