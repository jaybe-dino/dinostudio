"""Google Drive 저장소 어댑터.

기존 구현은 `gws` CLI를 subprocess로 호출했고, 폴더 ID가 소스에 상수로 박혀
있었다. 여기서는 공식 `google-api-python-client`를 지연 import 해서 쓰고, 폴더 ID와
자격 증명 경로는 설정에서 받는다.

Mac 앱이 업로드할 때 `appProperties.business_date`를 채워 두면 그 값을 업무일로
쓴다. UTC `createdTime`과 KST 업무일 경계가 어긋나는 문제를 근본적으로 없애는
방법이라 개발 계획에서도 이 방식을 권장하고 있다.

설치:
    pip install "work-recorder[drive]"
"""

from __future__ import annotations

import io
from datetime import date, datetime
from pathlib import Path

from ..business_date import as_utc, hint_from_name
from ..config import AUDIO_EXTENSIONS
from ..models import SourceRecording
from .base import AdapterError

SCOPES = ["https://www.googleapis.com/auth/drive"]
TRIGGER_PREFIX = "_TRIGGER_PROCESS_"


class GoogleDriveSource:
    name = "google_drive"

    def __init__(
        self,
        folder_id: str,
        *,
        credentials_path: Path | None = None,
        token_path: Path | None = None,
        timezone_name: str = "Asia/Seoul",
        cutoff_hour: int = 0,
        service=None,
    ):
        if not folder_id:
            raise AdapterError("GOOGLE_DRIVE_RECORDINGS_FOLDER_ID가 필요합니다.")
        self.folder_id = folder_id
        self.credentials_path = credentials_path
        self.token_path = token_path
        self.timezone_name = timezone_name
        self.cutoff_hour = cutoff_hour
        self._service = service

    # ── 인증 ──────────────────────────────────────────────────────────
    @property
    def service(self):
        if self._service is None:
            self._service = self._build_service()
        return self._service

    def _build_service(self):
        try:
            from google.auth.transport.requests import Request
            from google.oauth2.credentials import Credentials
            from google_auth_oauthlib.flow import InstalledAppFlow
            from googleapiclient.discovery import build
        except ImportError as exc:  # pragma: no cover - 설치 환경에 따라 다름
            raise AdapterError(
                "Google Drive 어댑터에는 추가 패키지가 필요합니다: "
                'pip install "work-recorder[drive]"'
            ) from exc

        creds = None
        if self.token_path and self.token_path.exists():
            creds = Credentials.from_authorized_user_file(str(self.token_path), SCOPES)

        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        elif not creds or not creds.valid:
            if not self.credentials_path or not self.credentials_path.exists():
                raise AdapterError(
                    "Google OAuth 자격 증명이 없습니다. GOOGLE_OAUTH_CREDENTIALS_PATH를 "
                    "설정하고 최초 1회 `work-recorder auth-google`을 실행하세요."
                )
            flow = InstalledAppFlow.from_client_secrets_file(str(self.credentials_path), SCOPES)
            creds = flow.run_local_server(port=0)

        if self.token_path:
            self.token_path.parent.mkdir(parents=True, exist_ok=True)
            self.token_path.write_text(creds.to_json(), encoding="utf-8")
            self.token_path.chmod(0o600)

        return build("drive", "v3", credentials=creds, cache_discovery=False)

    # ── 조회 ──────────────────────────────────────────────────────────
    def list_recordings(self, since: datetime, until: datetime) -> list[SourceRecording]:
        query = (
            f"'{self.folder_id}' in parents and trashed = false "
            f"and createdTime >= '{_rfc3339(since)}' and createdTime < '{_rfc3339(until)}'"
        )
        fields = (
            "nextPageToken, files(id, name, createdTime, size, webViewLink, "
            "mimeType, appProperties)"
        )

        found: list[SourceRecording] = []
        page_token: str | None = None
        while True:
            try:
                response = (
                    self.service.files()
                    .list(
                        q=query,
                        fields=fields,
                        orderBy="createdTime",
                        pageSize=100,
                        pageToken=page_token,
                        supportsAllDrives=True,
                        includeItemsFromAllDrives=True,
                    )
                    .execute()
                )
            except Exception as exc:  # noqa: BLE001 - 구글 SDK 예외를 통일해서 올린다
                raise AdapterError(f"Drive 파일 목록 조회 실패: {exc}") from exc

            for item in response.get("files", []):
                recording = self._to_recording(item)
                if recording is not None:
                    found.append(recording)

            page_token = response.get("nextPageToken")
            if not page_token:
                return found

    def _to_recording(self, item: dict) -> SourceRecording | None:
        name = item.get("name", "")
        if name.startswith(TRIGGER_PREFIX):
            # 기존 방식의 잔여 트리거 파일. 이제는 API로 작업을 접수하므로 무시한다.
            return None
        if Path(name).suffix.lower() not in AUDIO_EXTENSIONS:
            return None

        created = datetime.fromisoformat(item["createdTime"].replace("Z", "+00:00"))
        hint = _parse_hint(item.get("appProperties") or {}) or hint_from_name(
            name, self.timezone_name, self.cutoff_hour
        )
        size = item.get("size")
        return SourceRecording(
            source_file_id=item["id"],
            file_name=name,
            created_at=created,
            size_bytes=int(size) if size is not None else None,
            web_link=item.get("webViewLink"),
            mime_type=item.get("mimeType"),
            business_date_hint=hint,
        )

    # ── 다운로드 ──────────────────────────────────────────────────────
    def download(self, recording: SourceRecording, dest_dir: Path) -> Path:
        try:
            from googleapiclient.http import MediaIoBaseDownload
        except ImportError as exc:  # pragma: no cover
            raise AdapterError(
                'Google Drive 어댑터에는 추가 패키지가 필요합니다: pip install "work-recorder[drive]"'
            ) from exc

        dest_dir.mkdir(parents=True, exist_ok=True)
        target = dest_dir / recording.file_name
        request = self.service.files().get_media(
            fileId=recording.source_file_id, supportsAllDrives=True
        )
        try:
            with io.FileIO(target, "wb") as handle:
                downloader = MediaIoBaseDownload(handle, request, chunksize=8 * 1024 * 1024)
                done = False
                while not done:
                    _, done = downloader.next_chunk()
        except Exception as exc:  # noqa: BLE001
            target.unlink(missing_ok=True)
            raise AdapterError(f"Drive 다운로드 실패 ({recording.file_name}): {exc}") from exc
        return target


def _parse_hint(app_properties: dict) -> date | None:
    raw = app_properties.get("business_date")
    if not raw:
        return None
    try:
        return date.fromisoformat(str(raw))
    except ValueError:
        return None


def _rfc3339(moment: datetime) -> str:
    """Drive 쿼리용 UTC RFC3339 문자열 (`2026-03-21T00:00:00Z`)."""
    return as_utc(moment).strftime("%Y-%m-%dT%H:%M:%SZ")
