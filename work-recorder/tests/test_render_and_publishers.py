"""렌더링과 발행 페이로드 — 네트워크 없이 포맷을 검증한다."""

from __future__ import annotations

import io
from datetime import date

import pytest

from work_recorder.adapters.publishers import (
    ConsolePublisher,
    NotionPublisher,
    SlackPublisher,
    markdown_to_blocks,
)
from work_recorder.config import DEFAULT_NOTION_PROPERTIES
from work_recorder.models import DailyAnalysis, DailyReport, Meeting, Todo
from work_recorder.render import notion_body, slack_message, todos_property_text


@pytest.fixture
def report(analysis: DailyAnalysis) -> DailyReport:
    analysis.meetings = [
        Meeting(topic="킥오프", summary="범위와 일정을 정했다.", time_hint="오전")
    ]
    analysis.todos.append(
        Todo(task="스펙 확인", priority="낮음", confidence="낮음", source_excerpt="아마도...")
    )
    analysis.quality_notes = ["2번 파트에 잡음이 많음"]
    return DailyReport(
        business_date=date(2026, 3, 21),
        analysis=analysis,
        recording_count=2,
        transcript_chars=12345,
        file_links=["https://drive/1", ""],
        file_names=["part001.wav", "part002.wav"],
        transcript_text="원문" * 100,
        version=2,
    )


# ── 렌더링 ────────────────────────────────────────────────────────────
def test_slack_message_contains_every_section(report):
    message = slack_message(report)

    assert "2026-03-21 업무 녹음 종합 정리" in message
    assert "신규 프로젝트 킥오프" in message
    assert "🔴 1. 견적서 초안 작성 (지훈) _마감: 2026-03-24_" in message
    assert "3월 말 베타 오픈" in message
    assert "디자인 리소스 부족" in message
    assert "디자인팀 일정 확인" in message
    assert "지훈, 수민" in message
    assert "2번 파트에 잡음이 많음" in message
    assert "녹음 2건 · 전사 12,345자" in message


def test_low_confidence_todo_is_flagged(report):
    assert "⚠️" in slack_message(report)
    assert "확인필요" in todos_property_text(report)


def test_updated_report_is_marked(report):
    assert "(v2 갱신)" in slack_message(report, updated=True)
    assert "v2 갱신" not in slack_message(report, updated=False)


def test_notion_body_structure(report):
    body = notion_body(report)

    assert "## 오늘의 요약" in body
    assert "### 킥오프" in body
    assert "- [ ] [높음] 견적서 초안 작성 @지훈 (마감: 2026-03-24)" in body
    assert "> 근거: 견적서는 월요일까지 부탁드립니다" in body
    assert "- [part001.wav](https://drive/1)" in body
    assert "- part002.wav" in body  # 링크가 없으면 이름만
    assert "리포트 v2" in body


def test_empty_analysis_renders_without_error():
    empty = DailyReport(business_date=date(2026, 3, 21), analysis=DailyAnalysis())
    assert "요약 없음" in notion_body(empty)
    assert "추출된 할일 없음" == todos_property_text(empty)
    assert "2026-03-21" in slack_message(empty)


# ── Notion 블록 변환 ──────────────────────────────────────────────────
def test_markdown_to_blocks_maps_each_line_type():
    blocks = markdown_to_blocks(
        "## 제목\n### 소제목\n- [ ] 할 일\n  > 근거: 원문\n- 목록\n문단\n\n"
    )
    types = [block["type"] for block in blocks]

    assert types == [
        "heading_2",
        "heading_3",
        "to_do",
        "quote",
        "bulleted_list_item",
        "paragraph",
    ]
    assert blocks[2]["to_do"]["checked"] is False
    assert blocks[2]["to_do"]["rich_text"][0]["text"]["content"] == "할 일"


def test_markdown_link_becomes_rich_text_link():
    blocks = markdown_to_blocks("- [녹음 파일](https://drive/1)")
    text = blocks[0]["bulleted_list_item"]["rich_text"][0]

    assert text["text"]["content"] == "녹음 파일"
    assert text["text"]["link"] == {"url": "https://drive/1"}


def test_long_line_is_truncated_to_notion_limit():
    blocks = markdown_to_blocks("가" * 5000)
    assert len(blocks[0]["paragraph"]["rich_text"][0]["text"]["content"]) <= 1900


# ── 발행 어댑터 (요청 페이로드만 검증) ─────────────────────────────────
class FakeNotion(NotionPublisher):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.requests: list[tuple[str, str, dict | None]] = []

    def _request(self, url: str, method: str, payload: dict | None = None) -> dict:
        self.requests.append((method, url, payload))
        if method == "GET":
            return {"results": [{"id": "old-block"}]}
        return {"id": "page-123", "url": "https://notion/page-123"}


def test_notion_create_uses_database_parent_and_properties(report):
    publisher = FakeNotion(
        token="t", database_id="db-1", properties=dict(DEFAULT_NOTION_PROPERTIES)
    )
    outcome = publisher.publish(report, None)

    method, url, payload = publisher.requests[0]
    assert (method, url) == ("POST", "https://api.notion.com/v1/pages")
    assert payload["parent"] == {"type": "database_id", "database_id": "db-1"}
    assert payload["properties"]["제목"]["title"][0]["text"]["content"] == "3/21 킥오프"
    assert payload["properties"]["녹음 날짜"]["date"]["start"] == "2026-03-21"
    assert payload["properties"]["녹음 파일"]["url"] == "https://drive/1"
    assert outcome.external_id == "page-123"


def test_notion_uses_data_source_parent_when_configured(report):
    publisher = FakeNotion(token="t", data_source_id="ds-1")
    publisher.publish(report, None)

    _, _, payload = publisher.requests[0]
    assert payload["parent"] == {"type": "data_source_id", "data_source_id": "ds-1"}
    assert publisher._headers["Notion-Version"] == "2025-09-03"


def test_notion_update_replaces_body_instead_of_creating_page(report):
    publisher = FakeNotion(token="t", database_id="db-1")
    publisher.publish(report, "existing-page")

    methods = [(method, url) for method, url, _ in publisher.requests]
    assert methods[0] == ("PATCH", "https://api.notion.com/v1/pages/existing-page")
    assert ("GET", "https://api.notion.com/v1/blocks/existing-page/children?page_size=100") in methods
    assert ("DELETE", "https://api.notion.com/v1/blocks/old-block") in methods
    # 새 페이지를 만들지 않는다
    assert not any(url.endswith("/v1/pages") and method == "POST" for method, url, _ in publisher.requests)


def test_notion_property_map_override(report):
    publisher = FakeNotion(
        token="t", database_id="db-1", properties={"title": "Name", "date": "Date"}
    )
    publisher.publish(report, None)

    _, _, payload = publisher.requests[0]
    assert set(payload["properties"]) == {"Name", "Date"}


class FakeSlack(SlackPublisher):
    def __init__(self, *, update_ok: bool = True, **kwargs):
        super().__init__(**kwargs)
        self.calls: list[tuple[str, dict]] = []
        self.update_ok = update_ok

    def _call(self, method: str, payload: dict, *, allow_failure: bool = False) -> dict:
        self.calls.append((method, payload))
        if method == "chat.update":
            return {"ok": self.update_ok}
        return {"ok": True, "ts": "1710000000.000100"}


def test_slack_posts_new_message_first_time(report):
    publisher = FakeSlack(bot_token="x", channel_id="D1")
    outcome = publisher.publish(report, None)

    assert publisher.calls[0][0] == "chat.postMessage"
    assert publisher.calls[0][1]["channel"] == "D1"
    assert outcome.external_id == "1710000000.000100"


def test_slack_updates_existing_message(report):
    publisher = FakeSlack(bot_token="x", channel_id="D1")
    outcome = publisher.publish(report, "1710000000.000100")

    assert [call[0] for call in publisher.calls] == ["chat.update"]
    assert outcome.detail == "updated"


def test_slack_falls_back_to_new_message_when_update_fails(report):
    publisher = FakeSlack(bot_token="x", channel_id="D1", update_ok=False)
    publisher.publish(report, "deleted-ts")

    assert [call[0] for call in publisher.calls] == ["chat.update", "chat.postMessage"]


def test_console_publisher_writes_report(report):
    stream = io.StringIO()
    ConsolePublisher(stream).publish(report, None)
    assert "2026-03-21 업무 녹음 종합 정리" in stream.getvalue()


def test_publishers_require_credentials():
    from work_recorder.adapters.base import AdapterError

    with pytest.raises(AdapterError):
        SlackPublisher(bot_token="", channel_id="D1")
    with pytest.raises(AdapterError):
        NotionPublisher(token="t")
