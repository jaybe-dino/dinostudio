"""표준 라이브러리만 쓰는 최소 HTTP 클라이언트.

Notion·Slack·STT 어댑터가 공유한다. `requests`를 쓰지 않는 이유는 코어를 의존성
없이 유지해 사용자 Mac에 그대로 올려도 설치 문제가 없게 하기 위해서다.
재시도는 429/5xx/네트워크 오류에만 적용한다.
"""

from __future__ import annotations

import json
import mimetypes
import random
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

RETRY_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}


class HttpError(RuntimeError):
    def __init__(self, status: int, body: str, url: str):
        super().__init__(f"HTTP {status} — {url}\n{body[:800]}")
        self.status = status
        self.body = body
        self.url = url


def request_json(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
    timeout: int = 60,
    max_retries: int = 3,
    sleep=time.sleep,
) -> dict[str, Any]:
    """JSON 요청/응답. 실패 시 HttpError."""
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    all_headers = {"Accept": "application/json", **(headers or {})}
    if body is not None:
        all_headers.setdefault("Content-Type", "application/json; charset=utf-8")
    return _send(
        url,
        method=method,
        headers=all_headers,
        body=body,
        timeout=timeout,
        max_retries=max_retries,
        sleep=sleep,
    )


def post_multipart(
    url: str,
    *,
    file_path: Path,
    file_field: str = "file",
    fields: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 600,
    max_retries: int = 3,
    sleep=time.sleep,
) -> dict[str, Any]:
    """파일 업로드(멀티파트). STT 엔드포인트용."""
    boundary = f"----work-recorder-{uuid.uuid4().hex}"
    mime = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"

    chunks: list[bytes] = []
    for key, value in (fields or {}).items():
        chunks.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n".encode(
                "utf-8"
            )
        )
    chunks.append(
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{file_field}"; filename="{file_path.name}"\r\n'
        f"Content-Type: {mime}\r\n\r\n".encode("utf-8")
    )
    chunks.append(file_path.read_bytes())
    chunks.append(f"\r\n--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(chunks)

    all_headers = {
        "Accept": "application/json",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        **(headers or {}),
    }
    return _send(
        url,
        method="POST",
        headers=all_headers,
        body=body,
        timeout=timeout,
        max_retries=max_retries,
        sleep=sleep,
    )


def _send(
    url: str,
    *,
    method: str,
    headers: dict[str, str],
    body: bytes | None,
    timeout: int,
    max_retries: int,
    sleep,
) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(max_retries + 1):
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read().decode("utf-8", errors="replace")
                return json.loads(raw) if raw.strip() else {}
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            last_error = HttpError(exc.code, detail, url)
            if exc.code not in RETRY_STATUS or attempt == max_retries:
                raise last_error from exc
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            last_error = exc
            if attempt == max_retries:
                raise
        except json.JSONDecodeError as exc:
            raise HttpError(200, f"JSON 파싱 실패: {exc}", url) from exc

        sleep(min(2**attempt, 8) + random.random())

    raise last_error if last_error else RuntimeError("unreachable")
