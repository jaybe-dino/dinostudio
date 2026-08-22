"""작업 API (표준 라이브러리 http.server).

Mac 메뉴바 앱의 `지금 바로 정리하기`가 호출하는 엔드포인트다. 요청은 즉시
`202 Accepted` + `job_id`로 접수되고, 실제 처리는 워커가 한다.

    POST /jobs/daily-summary   {"business_date": "today"|"yesterday"|"YYYY-MM-DD", "source": "mac_menubar"}
    GET  /jobs/{job_id}
    GET  /jobs?limit=20
    GET  /reports/{YYYY-MM-DD}
    GET  /healthz

인증은 `Authorization: Bearer <API_TOKEN>`. 기본 바인딩은 127.0.0.1이다.
외부에 노출하려면 앞단에 TLS 종단을 두는 것을 전제로 한다.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import date
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

from .business_date import resolve_business_date
from .config import Settings
from .jobs import TRIGGER_MANUAL, enqueue_daily_summary, job_to_dict
from .store import Store

logger = logging.getLogger(__name__)

MAX_BODY_BYTES = 64 * 1024
_JOB_PATH = re.compile(r"^/jobs/(?P<job_id>[A-Za-z0-9_-]{1,64})$")
_REPORT_PATH = re.compile(r"^/reports/(?P<business_date>\d{4}-\d{2}-\d{2})$")


class ApiError(Exception):
    def __init__(self, status: HTTPStatus, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class JobApiHandler(BaseHTTPRequestHandler):
    server_version = "work-recorder/1.0"
    settings: Settings
    store: Store

    # ── 라우팅 ────────────────────────────────────────────────────────
    def do_GET(self) -> None:  # noqa: N802 - http.server 규약
        self._handle(self._route_get)

    def do_POST(self) -> None:  # noqa: N802
        self._handle(self._route_post)

    def _route_get(self, path: str, query: dict[str, list[str]]) -> tuple[HTTPStatus, Any]:
        if path == "/healthz":
            return HTTPStatus.OK, {"status": "ok", "timezone": self.settings.timezone}

        self._authorize()

        if path == "/jobs":
            limit = _int_param(query, "limit", 20, maximum=100)
            return HTTPStatus.OK, {
                "jobs": [job_to_dict(row) for row in self.store.recent_jobs(limit)]
            }

        job_match = _JOB_PATH.match(path)
        if job_match:
            row = self.store.job(job_match.group("job_id"))
            if row is None:
                raise ApiError(HTTPStatus.NOT_FOUND, "작업을 찾을 수 없습니다.")
            return HTTPStatus.OK, job_to_dict(row)

        report_match = _REPORT_PATH.match(path)
        if report_match:
            business_date = date.fromisoformat(report_match.group("business_date"))
            row = self.store.daily_report(business_date)
            if row is None:
                raise ApiError(HTTPStatus.NOT_FOUND, "해당 업무일 리포트가 없습니다.")
            return HTTPStatus.OK, {
                "business_date": row["business_date"],
                "version": row["version"],
                "title": row["title"],
                "summary": row["summary"],
                "recording_count": row["recording_count"],
                "transcript_chars": row["transcript_chars"],
                "analysis": json.loads(row["payload"]),
                "updated_at": row["updated_at"],
            }

        raise ApiError(HTTPStatus.NOT_FOUND, "없는 경로입니다.")

    def _route_post(self, path: str, query: dict[str, list[str]]) -> tuple[HTTPStatus, Any]:
        self._authorize()
        if path != "/jobs/daily-summary":
            raise ApiError(HTTPStatus.NOT_FOUND, "없는 경로입니다.")

        payload = self._read_json()
        try:
            business_date = resolve_business_date(
                payload.get("business_date", "today"),
                self.settings.timezone,
                self.settings.business_day_cutoff_hour,
            )
        except ValueError as exc:
            raise ApiError(HTTPStatus.BAD_REQUEST, str(exc)) from exc

        job, created = enqueue_daily_summary(
            self.store,
            business_date,
            trigger_type=str(payload.get("trigger_type") or TRIGGER_MANUAL),
            source=str(payload.get("source") or ""),
            dedupe=bool(payload.get("dedupe", True)),
        )
        job["created"] = created
        logger.info(
            "작업 접수 %s (%s, 신규=%s)", job["job_id"], job["business_date"], created
        )
        return HTTPStatus.ACCEPTED, job

    # ── 공통 처리 ─────────────────────────────────────────────────────
    def _handle(self, route) -> None:
        parsed = urlparse(self.path)
        try:
            status, body = route(parsed.path.rstrip("/") or "/", parse_qs(parsed.query))
        except ApiError as exc:
            self._respond(exc.status, {"error": exc.message})
        except Exception as exc:  # noqa: BLE001 - 500이라도 JSON으로 답한다
            logger.exception("API 처리 실패")
            self._respond(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
        else:
            self._respond(status, body)

    def _authorize(self) -> None:
        expected = self.settings.api_token
        if not expected:
            return  # 토큰 미설정 = 로컬 전용. doctor가 경고한다.
        header = self.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            raise ApiError(HTTPStatus.UNAUTHORIZED, "Authorization 헤더가 필요합니다.")
        import hmac

        if not hmac.compare_digest(header[7:].strip(), expected):
            raise ApiError(HTTPStatus.UNAUTHORIZED, "토큰이 올바르지 않습니다.")

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > MAX_BODY_BYTES:
            raise ApiError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "요청 본문이 너무 큽니다.")
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            raise ApiError(HTTPStatus.BAD_REQUEST, f"JSON 파싱 실패: {exc}") from exc
        if not isinstance(payload, dict):
            raise ApiError(HTTPStatus.BAD_REQUEST, "본문은 JSON 오브젝트여야 합니다.")
        return payload

    def _respond(self, status: HTTPStatus, body: Any) -> None:
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(int(status))
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, fmt: str, *args) -> None:  # noqa: A003 - 표준 로거로 보낸다
        logger.debug("%s - %s", self.address_string(), fmt % args)


def _int_param(query: dict[str, list[str]], name: str, default: int, *, maximum: int) -> int:
    values = query.get(name)
    if not values:
        return default
    try:
        return max(1, min(int(values[0]), maximum))
    except ValueError:
        return default


def create_server(settings: Settings, store: Store) -> ThreadingHTTPServer:
    handler = type(
        "BoundJobApiHandler", (JobApiHandler,), {"settings": settings, "store": store}
    )
    server = ThreadingHTTPServer((settings.api_host, settings.api_port), handler)
    server.daemon_threads = True
    return server
