"""로컬 폴더 저장소 어댑터.

Mac 앱이 `~/업무녹음/`에 남기는 원본을 그대로 읽는다. Drive를 거치지 않고
로컬에서 전체 파이프라인을 돌려볼 수 있어 초기 검증과 네트워크 장애 복구에 쓴다.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from pathlib import Path

from ..business_date import day_bounds, hint_from_name
from ..config import AUDIO_EXTENSIONS
from ..models import SourceRecording


class LocalDirectorySource:
    name = "local"

    def __init__(
        self,
        directory: Path,
        *,
        timezone_name: str = "Asia/Seoul",
        cutoff_hour: int = 0,
        extensions: set[str] | None = None,
    ):
        self.directory = Path(directory).expanduser()
        self.timezone_name = timezone_name
        self.cutoff_hour = cutoff_hour
        self.extensions = extensions or AUDIO_EXTENSIONS

    def list_recordings(self, since: datetime, until: datetime) -> list[SourceRecording]:
        if not self.directory.exists():
            return []

        found: list[SourceRecording] = []
        for path in sorted(self.directory.rglob("*")):
            if not path.is_file() or path.suffix.lower() not in self.extensions:
                continue
            stat = path.stat()
            created = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
            hint = hint_from_name(path.name, self.timezone_name, self.cutoff_hour)
            if not self._in_window(created, hint, since, until):
                continue
            found.append(
                SourceRecording(
                    source_file_id=str(path.resolve()),
                    file_name=path.name,
                    created_at=created,
                    size_bytes=stat.st_size,
                    web_link=path.resolve().as_uri(),
                    business_date_hint=hint,
                )
            )
        return found

    def _in_window(
        self, created: datetime, hint: date | None, since: datetime, until: datetime
    ) -> bool:
        """파일명에 업무일이 박혀 있으면 그 값을 우선한다.

        복사·이동으로 mtime이 바뀐 파일을 놓치지 않기 위한 처리다.
        """
        if hint is not None:
            hint_start, hint_end = day_bounds(hint, self.timezone_name, self.cutoff_hour)
            return hint_start < until and hint_end > since
        return since <= created < until

    def download(self, recording: SourceRecording, dest_dir: Path) -> Path:
        """이미 로컬에 있으므로 복사하지 않고 원본 경로를 그대로 쓴다.

        장시간 녹음은 파일이 크기 때문에 복사하면 디스크를 두 배로 쓴다. 파이프라인은
        작업 폴더만 정리하므로 원본은 안전하게 남는다(사용자 확인 없이 원본을 지우지
        않는다는 이관 문서의 원칙).
        """
        source_path = Path(recording.source_file_id)
        if not source_path.exists():
            raise FileNotFoundError(f"원본 파일이 없습니다: {source_path}")
        return source_path
