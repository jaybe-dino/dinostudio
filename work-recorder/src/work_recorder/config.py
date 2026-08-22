"""환경 변수 기반 설정.

기존 구현은 Drive 폴더 ID와 Notion data_source_id가 소스에 상수로 박혀 있었다.
여기서는 모든 연결값을 환경 변수(또는 `.env`)로 분리하고, 비밀은 파일이 아니라
환경/시크릿 저장소에서 주입받는 것을 전제로 한다.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_HOME = Path.home() / ".work-recorder"
AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".webm", ".ogg", ".mp4", ".flac", ".aac"}

# 기존 Notion DB의 속성 이름. 다른 DB를 쓰면 NOTION_PROPERTY_MAP으로 덮어쓴다.
DEFAULT_NOTION_PROPERTIES = {
    "title": "제목",
    "status": "상태",
    "summary": "회의 요약",
    "todos": "할일 목록",
    "transcript": "원본 텍스트",
    "recording_link": "녹음 파일",
    "date": "녹음 날짜",
}


def load_dotenv(path: Path) -> dict[str, str]:
    """의존성 없이 최소한의 `.env` 파서. 이미 설정된 환경 변수를 덮어쓰지 않는다."""
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key] = value
    return values


def _env(name: str, default: str = "", overrides: dict[str, str] | None = None) -> str:
    if name in os.environ and os.environ[name] != "":
        return os.environ[name]
    if overrides and overrides.get(name):
        return overrides[name]
    return default


def _bool(value: str, default: bool = False) -> bool:
    if value == "":
        return default
    return value.strip().lower() in ("1", "true", "yes", "y", "on")


def _int(value: str, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


@dataclass
class Settings:
    # 업무일·스케줄
    timezone: str = "Asia/Seoul"
    business_day_cutoff_hour: int = 0
    daily_summary_time: str = "00:05"

    # 저장 위치
    home: Path = field(default_factory=lambda: DEFAULT_HOME)
    database_path: Path = field(default_factory=lambda: DEFAULT_HOME / "work-recorder.db")
    work_dir: Path = field(default_factory=lambda: DEFAULT_HOME / "work")

    # 어댑터 선택
    source_adapter: str = "local"
    stt_adapter: str = "mock"
    analyzer_adapter: str = "mock"
    publishers: tuple[str, ...] = ("console",)

    # 로컬 저장소
    local_source_dir: Path = field(default_factory=lambda: Path.home() / "업무녹음")

    # Google Drive
    drive_folder_id: str = ""
    google_credentials_path: Path | None = None
    google_token_path: Path | None = None

    # STT (OpenAI 호환 /audio/transcriptions 엔드포인트)
    stt_base_url: str = "https://api.openai.com/v1"
    stt_api_key: str = ""
    stt_model: str = "whisper-1"
    stt_language: str = "ko"
    stt_timeout_seconds: int = 600

    # LLM 분석 (Anthropic)
    anthropic_api_key: str = ""
    llm_model: str = "claude-opus-5"
    llm_effort: str = "high"
    llm_max_tokens: int = 16000
    llm_enable_fallbacks: bool = True
    max_transcript_chars: int = 200_000

    # Notion
    notion_token: str = ""
    notion_database_id: str = ""
    notion_data_source_id: str = ""
    notion_properties: dict[str, str] = field(
        default_factory=lambda: dict(DEFAULT_NOTION_PROPERTIES)
    )

    # Slack
    slack_bot_token: str = ""
    slack_channel_id: str = ""

    # 작업 API
    api_host: str = "127.0.0.1"
    api_port: int = 8787
    api_token: str = ""
    api_base_url: str = "http://127.0.0.1:8787"

    # 처리 정책
    max_retry_count: int = 3
    worker_poll_seconds: int = 5
    keep_downloads: bool = False

    @classmethod
    def from_env(cls, dotenv_path: Path | None = None) -> "Settings":
        overrides = load_dotenv(dotenv_path) if dotenv_path else {}

        def env(name: str, default: str = "") -> str:
            return _env(name, default, overrides)

        home = Path(env("WORK_RECORDER_HOME", str(DEFAULT_HOME))).expanduser()
        database_path = Path(
            env("DATABASE_PATH", str(home / "work-recorder.db"))
        ).expanduser()
        work_dir = Path(env("WORK_DIR", str(home / "work"))).expanduser()

        publishers = tuple(
            item.strip()
            for item in env("PUBLISHERS", "console").split(",")
            if item.strip()
        ) or ("console",)

        properties = dict(DEFAULT_NOTION_PROPERTIES)
        raw_map = env("NOTION_PROPERTY_MAP")
        if raw_map:
            import json

            try:
                properties.update(
                    {str(k): str(v) for k, v in json.loads(raw_map).items()}
                )
            except (ValueError, AttributeError) as exc:
                raise ValueError(f"NOTION_PROPERTY_MAP은 JSON 오브젝트여야 합니다: {exc}") from exc

        credentials = env("GOOGLE_OAUTH_CREDENTIALS_PATH")
        token = env("GOOGLE_OAUTH_TOKEN_PATH")
        api_port = _int(env("API_PORT", "8787"), 8787)

        return cls(
            timezone=env("TIMEZONE", "Asia/Seoul"),
            business_day_cutoff_hour=_int(env("BUSINESS_DAY_CUTOFF_HOUR", "0"), 0),
            daily_summary_time=env("DAILY_SUMMARY_TIME", "00:05"),
            home=home,
            database_path=database_path,
            work_dir=work_dir,
            source_adapter=env("SOURCE_ADAPTER", "local"),
            stt_adapter=env("STT_ADAPTER", "mock"),
            analyzer_adapter=env("ANALYZER_ADAPTER", "mock"),
            publishers=publishers,
            local_source_dir=Path(
                env("LOCAL_SOURCE_DIR", str(Path.home() / "업무녹음"))
            ).expanduser(),
            drive_folder_id=env("GOOGLE_DRIVE_RECORDINGS_FOLDER_ID"),
            google_credentials_path=Path(credentials).expanduser() if credentials else None,
            google_token_path=Path(token).expanduser() if token else None,
            stt_base_url=env("STT_BASE_URL", "https://api.openai.com/v1").rstrip("/"),
            stt_api_key=env("STT_API_KEY"),
            stt_model=env("STT_MODEL", "whisper-1"),
            stt_language=env("STT_LANGUAGE", "ko"),
            stt_timeout_seconds=_int(env("STT_TIMEOUT_SECONDS", "600"), 600),
            anthropic_api_key=env("ANTHROPIC_API_KEY"),
            llm_model=env("LLM_MODEL", "claude-opus-5"),
            llm_effort=env("LLM_EFFORT", "high"),
            llm_max_tokens=_int(env("LLM_MAX_TOKENS", "16000"), 16000),
            llm_enable_fallbacks=_bool(env("LLM_ENABLE_FALLBACKS", "true"), True),
            max_transcript_chars=_int(env("MAX_TRANSCRIPT_CHARS", "200000"), 200_000),
            notion_token=env("NOTION_TOKEN"),
            notion_database_id=env("NOTION_DATABASE_ID"),
            notion_data_source_id=env("NOTION_DATA_SOURCE_ID"),
            notion_properties=properties,
            slack_bot_token=env("SLACK_BOT_TOKEN"),
            slack_channel_id=env("SLACK_CHANNEL_ID") or env("SLACK_USER_ID"),
            api_host=env("API_HOST", "127.0.0.1"),
            api_port=api_port,
            api_token=env("API_TOKEN"),
            api_base_url=env("API_BASE_URL", f"http://{env('API_HOST', '127.0.0.1')}:{api_port}"),
            max_retry_count=_int(env("MAX_RETRY_COUNT", "3"), 3),
            worker_poll_seconds=_int(env("WORKER_POLL_SECONDS", "5"), 5),
            keep_downloads=_bool(env("KEEP_DOWNLOADS", "false"), False),
        )

    def ensure_dirs(self) -> None:
        self.home.mkdir(parents=True, exist_ok=True)
        self.work_dir.mkdir(parents=True, exist_ok=True)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)

    def check(self) -> list[str]:
        """설정 점검. 운영 전환 전에 `work-recorder doctor`가 호출한다."""
        problems: list[str] = []

        if self.source_adapter == "google_drive" and not self.drive_folder_id:
            problems.append("SOURCE_ADAPTER=google_drive 인데 GOOGLE_DRIVE_RECORDINGS_FOLDER_ID가 없습니다.")
        if self.source_adapter == "local" and not self.local_source_dir.exists():
            problems.append(f"LOCAL_SOURCE_DIR가 존재하지 않습니다: {self.local_source_dir}")
        if self.stt_adapter == "openai_compatible" and not self.stt_api_key:
            problems.append("STT_ADAPTER=openai_compatible 인데 STT_API_KEY가 없습니다.")
        if self.analyzer_adapter == "claude" and not self.anthropic_api_key:
            problems.append(
                "ANALYZER_ADAPTER=claude 인데 ANTHROPIC_API_KEY가 없습니다. "
                "(`ant auth login` 프로필을 쓸 경우 무시해도 됩니다)"
            )
        if "notion" in self.publishers:
            if not self.notion_token:
                problems.append("PUBLISHERS에 notion이 있는데 NOTION_TOKEN이 없습니다.")
            if not (self.notion_database_id or self.notion_data_source_id):
                problems.append(
                    "PUBLISHERS에 notion이 있는데 NOTION_DATABASE_ID / NOTION_DATA_SOURCE_ID가 둘 다 없습니다."
                )
        if "slack" in self.publishers:
            if not self.slack_bot_token:
                problems.append("PUBLISHERS에 slack이 있는데 SLACK_BOT_TOKEN이 없습니다.")
            if not self.slack_channel_id:
                problems.append("PUBLISHERS에 slack이 있는데 SLACK_CHANNEL_ID가 없습니다.")
        if not self.api_token:
            problems.append(
                "API_TOKEN이 비어 있습니다. 수동 정리 API가 인증 없이 열립니다 "
                "(로컬 전용이라도 설정을 권장)."
            )
        if self.api_host not in ("127.0.0.1", "localhost") and not self.api_token:
            problems.append(f"API_HOST={self.api_host} 로 외부에 열려 있는데 API_TOKEN이 없습니다.")
        return problems
