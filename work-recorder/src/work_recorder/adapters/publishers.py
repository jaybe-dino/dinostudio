"""발행 어댑터 — Notion, Slack, 콘솔.

멱등성은 파이프라인이 `publications` 테이블로 판단하고, 여기서는 "이미 발행된 것이
있으면 갱신, 없으면 생성"만 담당한다. 같은 업무일을 다시 분석해도 Notion 페이지는
새로 쌓이지 않고 갱신되며, Slack은 내용이 실제로 바뀐 경우에만 다시 나간다.
"""

from __future__ import annotations

import re
from typing import Any

from ..http import HttpError, request_json
from ..models import DailyReport, PublishResult
from ..render import notion_body, slack_message, todos_property_text
from .base import AdapterError

NOTION_API = "https://api.notion.com/v1"
# data_source 기반 부모를 쓰려면 2025-09-03 이상이 필요하다.
NOTION_VERSION_DATABASE = "2022-06-28"
NOTION_VERSION_DATA_SOURCE = "2025-09-03"

# Notion 블록 하나에 들어가는 rich_text는 2000자 제한이 있다.
NOTION_TEXT_LIMIT = 1900
NOTION_BLOCKS_PER_REQUEST = 100
TRANSCRIPT_PROPERTY_LIMIT = 2000


class ConsolePublisher:
    """토큰 없이 결과를 확인하는 용도. 기본 발행 대상이다."""

    name = "console"

    def __init__(self, stream=None):
        self.stream = stream

    def publish(self, report: DailyReport, previous_external_id: str | None) -> PublishResult:
        import sys

        target = self.stream or sys.stdout
        target.write(slack_message(report, updated=previous_external_id is not None) + "\n")
        target.flush()
        return PublishResult(channel=self.name, external_id=report.business_date.isoformat())


class SlackPublisher:
    name = "slack"

    def __init__(self, *, bot_token: str, channel_id: str):
        if not bot_token or not channel_id:
            raise AdapterError("SLACK_BOT_TOKEN과 SLACK_CHANNEL_ID가 필요합니다.")
        self.bot_token = bot_token
        self.channel_id = channel_id

    def publish(self, report: DailyReport, previous_external_id: str | None) -> PublishResult:
        text = slack_message(report, updated=previous_external_id is not None)
        if previous_external_id:
            # 같은 스레드를 갱신해서 DM이 중복 알림으로 쌓이지 않게 한다.
            data = self._call(
                "chat.update",
                {"channel": self.channel_id, "ts": previous_external_id, "text": text},
                allow_failure=True,
            )
            if data.get("ok"):
                return PublishResult(
                    channel=self.name, external_id=previous_external_id, detail="updated"
                )
            # 메시지가 지워졌거나 수정 불가면 새로 보낸다.

        data = self._call("chat.postMessage", {"channel": self.channel_id, "text": text})
        return PublishResult(channel=self.name, external_id=str(data.get("ts", "")))

    def _call(self, method: str, payload: dict[str, Any], *, allow_failure: bool = False) -> dict:
        try:
            data = request_json(
                f"https://slack.com/api/{method}",
                method="POST",
                headers={"Authorization": f"Bearer {self.bot_token}"},
                payload=payload,
            )
        except (HttpError, OSError) as exc:
            if allow_failure:
                return {"ok": False, "error": str(exc)}
            raise AdapterError(f"Slack {method} 실패: {exc}") from exc

        if not data.get("ok") and not allow_failure:
            raise AdapterError(f"Slack {method} 실패: {data.get('error', data)}")
        return data


class NotionPublisher:
    name = "notion"

    def __init__(
        self,
        *,
        token: str,
        database_id: str = "",
        data_source_id: str = "",
        properties: dict[str, str] | None = None,
    ):
        if not token:
            raise AdapterError("NOTION_TOKEN이 필요합니다.")
        if not database_id and not data_source_id:
            raise AdapterError("NOTION_DATABASE_ID 또는 NOTION_DATA_SOURCE_ID가 필요합니다.")
        self.token = token
        self.database_id = database_id
        self.data_source_id = data_source_id
        self.properties = properties or {}

    @property
    def _headers(self) -> dict[str, str]:
        version = NOTION_VERSION_DATA_SOURCE if self.data_source_id else NOTION_VERSION_DATABASE
        return {"Authorization": f"Bearer {self.token}", "Notion-Version": version}

    def publish(self, report: DailyReport, previous_external_id: str | None) -> PublishResult:
        blocks = markdown_to_blocks(notion_body(report))

        if previous_external_id:
            page_id = previous_external_id
            self._request(f"{NOTION_API}/pages/{page_id}", "PATCH", {
                "properties": self._page_properties(report),
            })
            self._replace_children(page_id, blocks)
            return PublishResult(
                channel=self.name,
                external_id=page_id,
                url=_page_url(page_id),
                detail="updated",
            )

        parent = (
            {"type": "data_source_id", "data_source_id": self.data_source_id}
            if self.data_source_id
            else {"type": "database_id", "database_id": self.database_id}
        )
        page = self._request(
            f"{NOTION_API}/pages",
            "POST",
            {
                "parent": parent,
                "icon": {"type": "emoji", "emoji": "📋"},
                "properties": self._page_properties(report),
                "children": blocks[:NOTION_BLOCKS_PER_REQUEST],
            },
        )
        page_id = str(page.get("id", ""))
        if len(blocks) > NOTION_BLOCKS_PER_REQUEST:
            self._append_children(page_id, blocks[NOTION_BLOCKS_PER_REQUEST:])
        return PublishResult(
            channel=self.name, external_id=page_id, url=str(page.get("url") or _page_url(page_id))
        )

    # ── 내부 ──────────────────────────────────────────────────────────
    def _page_properties(self, report: DailyReport) -> dict[str, Any]:
        names = self.properties
        analysis = report.analysis
        title = analysis.daily_title or f"{report.business_date.isoformat()} 업무 녹음"

        props: dict[str, Any] = {
            names.get("title", "제목"): {"title": [_text(title)]},
        }
        if names.get("status"):
            props[names["status"]] = {"select": {"name": "완료"}}
        if names.get("summary"):
            props[names["summary"]] = {
                "rich_text": [_text(analysis.executive_summary[:TRANSCRIPT_PROPERTY_LIMIT])]
            }
        if names.get("todos"):
            props[names["todos"]] = {
                "rich_text": [_text(todos_property_text(report)[:TRANSCRIPT_PROPERTY_LIMIT])]
            }
        if names.get("transcript"):
            props[names["transcript"]] = {
                "rich_text": [_text(report.transcript_text[:TRANSCRIPT_PROPERTY_LIMIT])]
            }
        if names.get("recording_link") and report.file_links:
            props[names["recording_link"]] = {"url": report.file_links[0]}
        if names.get("date"):
            props[names["date"]] = {"date": {"start": report.business_date.isoformat()}}
        return props

    def _replace_children(self, page_id: str, blocks: list[dict]) -> None:
        """기존 본문을 지우고 새 본문으로 바꾼다 (같은 날짜 재분석 시 중복 방지)."""
        existing = self._request(f"{NOTION_API}/blocks/{page_id}/children?page_size=100", "GET")
        for block in existing.get("results", []):
            self._request(f"{NOTION_API}/blocks/{block['id']}", "DELETE")
        self._append_children(page_id, blocks)

    def _append_children(self, page_id: str, blocks: list[dict]) -> None:
        for start in range(0, len(blocks), NOTION_BLOCKS_PER_REQUEST):
            chunk = blocks[start : start + NOTION_BLOCKS_PER_REQUEST]
            self._request(f"{NOTION_API}/blocks/{page_id}/children", "PATCH", {"children": chunk})

    def _request(self, url: str, method: str, payload: dict | None = None) -> dict:
        try:
            return request_json(url, method=method, headers=self._headers, payload=payload)
        except (HttpError, OSError) as exc:
            raise AdapterError(f"Notion {method} {url} 실패: {exc}") from exc


# ── 마크다운 → Notion 블록 ────────────────────────────────────────────
_LINK_RE = re.compile(r"^\[(?P<label>[^\]]+)\]\((?P<url>[^)]+)\)$")


def markdown_to_blocks(body: str) -> list[dict]:
    """렌더러가 만든 제한된 마크다운을 Notion 블록으로 변환한다."""
    blocks: list[dict] = []
    for raw in body.splitlines():
        line = raw.rstrip()
        if not line.strip():
            continue

        if line.startswith("### "):
            blocks.append(_block("heading_3", line[4:]))
        elif line.startswith("## "):
            blocks.append(_block("heading_2", line[3:]))
        elif line.startswith("- [ ] "):
            blocks.append(_block("to_do", line[6:], checked=False))
        elif line.strip().startswith("> 근거: "):
            blocks.append(_block("quote", line.strip()[6:]))
        elif line.startswith("- "):
            blocks.append(_block("bulleted_list_item", line[2:]))
        else:
            blocks.append(_block("paragraph", line))
    return blocks


def _block(block_type: str, content: str, *, checked: bool | None = None) -> dict:
    payload: dict[str, Any] = {"rich_text": _rich_text(content)}
    if checked is not None:
        payload["checked"] = checked
    return {"object": "block", "type": block_type, block_type: payload}


def _rich_text(content: str) -> list[dict]:
    text = content.strip()
    link_match = _LINK_RE.match(text)
    if link_match:
        return [_text(link_match.group("label"), link=link_match.group("url"))]
    return [_text(text[:NOTION_TEXT_LIMIT])]


def _text(content: str, *, link: str | None = None) -> dict:
    payload: dict[str, Any] = {"type": "text", "text": {"content": content[:NOTION_TEXT_LIMIT]}}
    if link:
        payload["text"]["link"] = {"url": link}
    return payload


def _page_url(page_id: str) -> str:
    return f"https://www.notion.so/{page_id.replace('-', '')}"
