"""분석기 요청 형태, STT, 설정, 스케줄러."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from work_recorder.adapters.analyzer import ClaudeAnalyzer, MockAnalyzer
from work_recorder.adapters.base import AdapterError
from work_recorder.adapters.stt import MockSTT, OpenAICompatibleSTT
from work_recorder.config import Settings, load_dotenv
from work_recorder.models import ANALYSIS_JSON_SCHEMA, DailyAnalysis
from work_recorder.prompts import build_combined_transcript
from work_recorder.scheduler import next_run_at, parse_time

from helpers import write_wav


# ── Claude 분석기 ─────────────────────────────────────────────────────
class FakeStream:
    def __init__(self, message):
        self.message = message

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get_final_message(self):
        return self.message


class FakeBlock:
    def __init__(self, text: str):
        self.type = "text"
        self.text = text


class FakeMessage:
    def __init__(self, text: str, stop_reason: str = "end_turn"):
        self.content = [FakeBlock(text)]
        self.stop_reason = stop_reason
        self.stop_details = None


class FakeMessagesApi:
    def __init__(self, message, *, raises: Exception | None = None):
        self.message = message
        self.raises = raises
        self.requests: list[dict] = []

    def stream(self, **kwargs):
        self.requests.append(kwargs)
        if self.raises is not None:
            raise self.raises
        return FakeStream(self.message)


class FakeClient:
    def __init__(self, message, *, beta_raises: Exception | None = None):
        self.messages = FakeMessagesApi(message)
        self.beta = type(
            "Beta", (), {"messages": FakeMessagesApi(message, raises=beta_raises)}
        )()


ANALYSIS_JSON = json.dumps(
    {
        "daily_title": "3/21 킥오프",
        "executive_summary": "요약",
        "meetings": [{"topic": "킥오프", "summary": "내용", "time_hint": "오전"}],
        "todos": [
            {
                "task": "견적서 작성",
                "assignee": "지훈",
                "priority": "높음",
                "deadline": "2026-03-24",
                "confidence": "높음",
                "source_excerpt": "견적서는 월요일까지",
            }
        ],
        "key_decisions": ["베타 오픈"],
        "issues": [],
        "participants": ["지훈"],
        "follow_ups": [],
        "quality_notes": [],
    },
    ensure_ascii=False,
)


def test_claude_request_uses_schema_thinking_and_effort():
    client = FakeClient(FakeMessage(ANALYSIS_JSON))
    analyzer = ClaudeAnalyzer(client=client, model="claude-opus-5", effort="high")

    result = analyzer.analyze("2026-03-21", "전사 내용")

    request = client.beta.messages.requests[0]
    assert request["model"] == "claude-opus-5"
    assert request["thinking"] == {"type": "adaptive"}
    assert request["output_config"]["effort"] == "high"
    assert request["output_config"]["format"]["schema"] is ANALYSIS_JSON_SCHEMA
    assert request["fallbacks"] == "default"
    assert "2026-03-21" in request["messages"][0]["content"]
    assert result.daily_title == "3/21 킥오프"
    assert result.todos[0].assignee == "지훈"


def test_claude_falls_back_to_plain_endpoint_when_beta_unsupported():
    client = FakeClient(
        FakeMessage(ANALYSIS_JSON), beta_raises=TypeError("unexpected keyword 'fallbacks'")
    )
    analyzer = ClaudeAnalyzer(client=client)

    result = analyzer.analyze("2026-03-21", "전사 내용")

    assert len(client.messages.requests) == 1
    assert "fallbacks" not in client.messages.requests[0]
    assert result.daily_title == "3/21 킥오프"


def test_claude_can_disable_fallbacks():
    client = FakeClient(FakeMessage(ANALYSIS_JSON))
    ClaudeAnalyzer(client=client, enable_fallbacks=False).analyze("2026-03-21", "내용")

    assert client.beta.messages.requests == []
    assert len(client.messages.requests) == 1


def test_claude_refusal_is_reported():
    client = FakeClient(FakeMessage(ANALYSIS_JSON, stop_reason="refusal"))
    with pytest.raises(AdapterError, match="거절"):
        ClaudeAnalyzer(client=client, enable_fallbacks=False).analyze("2026-03-21", "내용")


def test_claude_rejects_non_json_response():
    client = FakeClient(FakeMessage("죄송하지만 JSON이 아닙니다"))
    with pytest.raises(AdapterError, match="JSON"):
        ClaudeAnalyzer(client=client, enable_fallbacks=False).analyze("2026-03-21", "내용")


def test_claude_rejects_empty_transcript():
    with pytest.raises(AdapterError):
        ClaudeAnalyzer(client=FakeClient(FakeMessage(ANALYSIS_JSON))).analyze("2026-03-21", "  ")


def test_analysis_schema_is_strict():
    """구조화 출력은 additionalProperties: false + required 가 있어야 강제된다."""

    def check(node: dict) -> None:
        if node.get("type") == "object":
            assert node.get("additionalProperties") is False
            assert set(node["required"]) == set(node["properties"])
            for child in node["properties"].values():
                check(child)
        if node.get("type") == "array":
            check(node["items"])

    check(ANALYSIS_JSON_SCHEMA)


def test_analysis_from_dict_tolerates_garbage():
    """스키마가 강제되더라도 저장된 옛 payload를 읽을 때 깨지지 않아야 한다."""
    analysis = DailyAnalysis.from_dict(
        {
            "daily_title": "제목",
            "todos": [
                {"task": "정상"},
                {"task": "  "},  # 빈 할 일은 버린다
                "문자열",  # 형식이 다르면 무시
                {"task": "우선순위 이상", "priority": "긴급"},
            ],
            "meetings": None,
            "issues": ["", "실제 이슈"],
        }
    )

    assert [todo.task for todo in analysis.todos] == ["정상", "우선순위 이상"]
    assert analysis.todos[1].priority == "중간"  # 알 수 없는 값은 기본값으로
    assert analysis.issues == ["실제 이슈"]
    assert analysis.meetings == []


def test_content_hash_changes_with_content():
    first = DailyAnalysis(daily_title="A")
    same = DailyAnalysis(daily_title="A")
    other = DailyAnalysis(daily_title="B")

    assert first.content_hash() == same.content_hash()
    assert first.content_hash() != other.content_hash()


def test_mock_analyzer_marks_itself():
    result = MockAnalyzer().analyze("2026-03-21", "회의 내용")
    assert "mock" in result.daily_title
    assert result.quality_notes


# ── 전사 병합 ─────────────────────────────────────────────────────────
def test_combined_transcript_labels_each_part():
    from work_recorder.models import TranscriptPart

    parts = [
        TranscriptPart("a.wav", "첫 파트", datetime(2026, 3, 21, 6, 1)),
        TranscriptPart("b.wav", "둘째 파트", datetime(2026, 3, 21, 6, 31)),
    ]
    combined, truncated = build_combined_transcript(parts, 10_000)

    assert truncated is False
    assert "녹음 파트 1 (a.wav, 2026-03-21 06:01)" in combined
    assert "녹음 파트 2 (b.wav, 2026-03-21 06:31)" in combined
    assert combined.index("첫 파트") < combined.index("둘째 파트")


# ── STT ───────────────────────────────────────────────────────────────
def test_mock_stt_reads_sidecar(tmp_path: Path):
    audio = write_wav(tmp_path / "rec.wav", seconds=0.5)
    audio.with_suffix(".txt").write_text("사이드카 전사", encoding="utf-8")

    transcript = MockSTT().transcribe(audio)

    assert transcript.text == "사이드카 전사"
    assert transcript.duration_seconds == pytest.approx(0.5, abs=0.01)


def test_mock_stt_without_sidecar(tmp_path: Path):
    audio = write_wav(tmp_path / "rec.wav")
    assert "rec.wav" in MockSTT().transcribe(audio).text


def test_openai_compatible_stt_rejects_oversized_file(tmp_path: Path):
    audio = write_wav(tmp_path / "big.wav")
    stt = OpenAICompatibleSTT(
        base_url="https://api.example/v1", api_key="k", max_upload_bytes=10
    )

    with pytest.raises(AdapterError, match="한도"):
        stt.transcribe(audio)


def test_openai_compatible_stt_requires_key():
    with pytest.raises(AdapterError):
        OpenAICompatibleSTT(base_url="https://api.example/v1", api_key="")


# ── 설정 ──────────────────────────────────────────────────────────────
def test_dotenv_parsing(tmp_path: Path):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "# 주석\nTIMEZONE=Asia/Seoul\nAPI_TOKEN='quoted'\nEMPTY=\n잘못된줄\n",
        encoding="utf-8",
    )
    values = load_dotenv(env_file)

    assert values["TIMEZONE"] == "Asia/Seoul"
    assert values["API_TOKEN"] == "quoted"
    assert values["EMPTY"] == ""
    assert "잘못된줄" not in values


def test_settings_from_env_file(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            [
                "TIMEZONE=Asia/Seoul",
                "BUSINESS_DAY_CUTOFF_HOUR=4",
                "PUBLISHERS=notion, slack",
                "SOURCE_ADAPTER=google_drive",
                "GOOGLE_DRIVE_RECORDINGS_FOLDER_ID=folder-1",
                "MAX_RETRY_COUNT=5",
                'NOTION_PROPERTY_MAP={"title":"Name"}',
            ]
        ),
        encoding="utf-8",
    )
    settings = Settings.from_env(env_file)

    assert settings.business_day_cutoff_hour == 4
    assert settings.publishers == ("notion", "slack")
    assert settings.drive_folder_id == "folder-1"
    assert settings.max_retry_count == 5
    assert settings.notion_properties["title"] == "Name"
    assert settings.notion_properties["status"] == "상태"  # 나머지는 기본값 유지


def test_real_environment_wins_over_dotenv(tmp_path: Path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text("API_TOKEN=from-file", encoding="utf-8")
    monkeypatch.setenv("API_TOKEN", "from-env")

    assert Settings.from_env(env_file).api_token == "from-env"


def test_settings_check_reports_missing_connections(tmp_path: Path):
    settings = Settings(
        source_adapter="google_drive",
        publishers=("notion", "slack"),
        analyzer_adapter="claude",
        stt_adapter="openai_compatible",
        home=tmp_path,
        database_path=tmp_path / "db.sqlite",
        work_dir=tmp_path / "work",
    )
    problems = "\n".join(settings.check())

    assert "GOOGLE_DRIVE_RECORDINGS_FOLDER_ID" in problems
    assert "STT_API_KEY" in problems
    assert "ANTHROPIC_API_KEY" in problems
    assert "NOTION_TOKEN" in problems
    assert "SLACK_BOT_TOKEN" in problems
    assert "API_TOKEN" in problems


def test_settings_check_passes_for_local_setup(tmp_path: Path):
    recordings = tmp_path / "recordings"
    recordings.mkdir()
    settings = Settings(
        source_adapter="local",
        local_source_dir=recordings,
        publishers=("console",),
        home=tmp_path,
        database_path=tmp_path / "db.sqlite",
        work_dir=tmp_path / "work",
        api_token="set",
    )
    assert settings.check() == []


# ── 스케줄러 ──────────────────────────────────────────────────────────
def test_parse_time():
    assert parse_time("00:05") == (0, 5)
    with pytest.raises(ValueError):
        parse_time("25:00")
    with pytest.raises(ValueError):
        parse_time("자정")


def test_next_run_at_is_the_upcoming_kst_slot():
    seoul = ZoneInfo("Asia/Seoul")
    now = datetime(2026, 3, 21, 22, 0, tzinfo=seoul)

    target = next_run_at(now, "00:05", "Asia/Seoul")

    assert target == datetime(2026, 3, 22, 0, 5, tzinfo=seoul)


def test_next_run_at_skips_to_tomorrow_when_time_passed():
    seoul = ZoneInfo("Asia/Seoul")
    now = datetime(2026, 3, 21, 0, 30, tzinfo=seoul)

    assert next_run_at(now, "00:05", "Asia/Seoul") == datetime(2026, 3, 22, 0, 5, tzinfo=seoul)


def test_next_run_at_accepts_utc_now():
    now = datetime(2026, 3, 21, 13, 0, tzinfo=timezone.utc)  # KST 22:00
    target = next_run_at(now, "00:05", "Asia/Seoul")

    assert target.astimezone(timezone.utc) == datetime(2026, 3, 21, 15, 5, tzinfo=timezone.utc)


def test_scheduler_enqueues_previous_business_day(settings, store):
    from work_recorder.scheduler import Scheduler
    from work_recorder.business_date import yesterday

    job = Scheduler(settings, store).enqueue_now()

    assert job["business_date"] == yesterday(settings.timezone).isoformat()
    assert job["trigger_type"] == "scheduled"


def test_scheduler_does_not_duplicate_pending_job(settings, store):
    from work_recorder.scheduler import Scheduler

    scheduler = Scheduler(settings, store)
    first = scheduler.enqueue_now()
    second = scheduler.enqueue_now()

    assert first["job_id"] == second["job_id"]
    assert len(store.recent_jobs(10)) == 1
