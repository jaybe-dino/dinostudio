#!/usr/bin/env python3
"""Mac 메뉴바 앱에서 쓰는 작업 API 클라이언트.

기존 `work_recorder.py`의 `지금 바로 정리하기`는 Google Drive에 트리거 파일을
올리고 누군가 그것을 발견해 주기를 기다렸다. 사용자 입장에서는 접수됐는지,
처리 중인지, 실패했는지 알 수 없었다.

이 모듈은 그 자리를 대신한다. 요청은 즉시 job_id와 함께 접수되고, 앱은 폴링으로
`대기 → 실행 → 완료/실패`를 메뉴바에 표시할 수 있다.

의존성은 표준 라이브러리뿐이라 기존 앱에 파일 하나만 복사해 넣으면 된다.
사용법은 이 폴더의 README.md를 보라.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

DEFAULT_BASE_URL = os.environ.get("API_BASE_URL", "http://127.0.0.1:8787")
DEFAULT_TOKEN = os.environ.get("API_TOKEN", "")

STATUS_LABELS = {
    "queued": "접수됨 — 대기 중",
    "running": "정리하는 중…",
    "succeeded": "정리 완료",
    "failed": "정리 실패",
}


class JobApiError(RuntimeError):
    """API 호출 실패. 앱은 이 메시지를 사용자에게 그대로 보여주면 된다."""


class WorkRecorderClient:
    def __init__(self, base_url: str = DEFAULT_BASE_URL, token: str = DEFAULT_TOKEN, timeout: float = 10.0):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout

    # ── 요청 ──────────────────────────────────────────────────────────
    def request_daily_summary(self, business_date: str = "today") -> dict:
        """`지금 바로 정리하기`. 즉시 접수되고 job 정보를 돌려준다.

        같은 업무일에 이미 진행 중인 작업이 있으면 그 작업을 그대로 돌려주므로,
        버튼을 여러 번 눌러도 중복 처리되지 않는다.
        """
        return self._call(
            "POST",
            "/jobs/daily-summary",
            {"business_date": business_date, "source": "mac_menubar"},
        )

    def job_status(self, job_id: str) -> dict:
        return self._call("GET", f"/jobs/{job_id}")

    def health(self) -> dict:
        return self._call("GET", "/healthz")

    def is_available(self) -> bool:
        """서버가 떠 있는지. 메뉴바에서 상태 점으로 보여줄 때 쓴다."""
        try:
            self.health()
            return True
        except JobApiError:
            return False

    # ── 표시용 ────────────────────────────────────────────────────────
    @staticmethod
    def describe(job: dict) -> str:
        label = STATUS_LABELS.get(job.get("status", ""), job.get("status", "알 수 없음"))
        if job.get("status") == "failed" and job.get("error"):
            return f"{label}: {job['error']}"
        result = job.get("result") or {}
        if job.get("status") == "succeeded":
            published = ", ".join(result.get("published") or []) or "발행 없음"
            return (
                f"{label} — 녹음 {result.get('transcribed', 0)}건 정리, {published}"
                if result
                else label
            )
        return label

    @staticmethod
    def is_finished(job: dict) -> bool:
        return job.get("status") in ("succeeded", "failed")

    # ── 내부 ──────────────────────────────────────────────────────────
    def _call(self, method: str, path: str, payload: dict | None = None) -> dict:
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(f"{self.base_url}{path}", data=body, method=method)
        request.add_header("Accept", "application/json")
        if body is not None:
            request.add_header("Content-Type", "application/json; charset=utf-8")
        if self.token:
            request.add_header("Authorization", f"Bearer {self.token}")

        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
                return json.loads(raw) if raw.strip() else {}
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            try:
                message = json.loads(detail).get("error", detail)
            except json.JSONDecodeError:
                message = detail
            raise JobApiError(f"정리 서버 오류 ({exc.code}): {message}") from exc
        except urllib.error.URLError as exc:
            raise JobApiError(
                f"정리 서버에 연결할 수 없습니다 ({self.base_url}). "
                "`work-recorder serve --with-worker`가 실행 중인지 확인하세요."
            ) from exc


if __name__ == "__main__":
    import sys
    import time

    client = WorkRecorderClient()
    target = sys.argv[1] if len(sys.argv) > 1 else "today"
    accepted = client.request_daily_summary(target)
    print(f"접수: {accepted['job_id']} ({accepted['business_date']})")

    while True:
        current = client.job_status(accepted["job_id"])
        print(f"  {WorkRecorderClient.describe(current)}")
        if WorkRecorderClient.is_finished(current):
            break
        time.sleep(2)
