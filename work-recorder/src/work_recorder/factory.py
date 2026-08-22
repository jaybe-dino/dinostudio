"""설정 → 어댑터 조립.

여기가 유일하게 "어떤 구현을 쓸지" 아는 곳이다. 파이프라인·API·워커는 프로토콜만 본다.
"""

from __future__ import annotations

from .adapters.analyzer import ClaudeAnalyzer, MockAnalyzer
from .adapters.base import AdapterError, Analyzer, Publisher, RecordingSource, SpeechToText
from .adapters.publishers import ConsolePublisher, NotionPublisher, SlackPublisher
from .adapters.source_google_drive import GoogleDriveSource
from .adapters.source_local import LocalDirectorySource
from .adapters.stt import MockSTT, OpenAICompatibleSTT
from .config import Settings
from .pipeline import Pipeline
from .prompts import load_system_prompt
from .store import Store


def build_source(settings: Settings) -> RecordingSource:
    if settings.source_adapter == "local":
        return LocalDirectorySource(
            settings.local_source_dir,
            timezone_name=settings.timezone,
            cutoff_hour=settings.business_day_cutoff_hour,
        )
    if settings.source_adapter == "google_drive":
        return GoogleDriveSource(
            settings.drive_folder_id,
            credentials_path=settings.google_credentials_path,
            token_path=settings.google_token_path,
            timezone_name=settings.timezone,
            cutoff_hour=settings.business_day_cutoff_hour,
        )
    raise AdapterError(f"알 수 없는 SOURCE_ADAPTER: {settings.source_adapter}")


def build_stt(settings: Settings) -> SpeechToText:
    if settings.stt_adapter == "mock":
        return MockSTT()
    if settings.stt_adapter == "openai_compatible":
        return OpenAICompatibleSTT(
            base_url=settings.stt_base_url,
            api_key=settings.stt_api_key,
            model=settings.stt_model,
            language=settings.stt_language,
            timeout_seconds=settings.stt_timeout_seconds,
        )
    raise AdapterError(f"알 수 없는 STT_ADAPTER: {settings.stt_adapter}")


def build_analyzer(settings: Settings) -> Analyzer:
    if settings.analyzer_adapter == "mock":
        return MockAnalyzer()
    if settings.analyzer_adapter == "claude":
        return ClaudeAnalyzer(
            api_key=settings.anthropic_api_key,
            model=settings.llm_model,
            effort=settings.llm_effort,
            max_tokens=settings.llm_max_tokens,
            enable_fallbacks=settings.llm_enable_fallbacks,
            system_prompt=load_system_prompt(),
        )
    raise AdapterError(f"알 수 없는 ANALYZER_ADAPTER: {settings.analyzer_adapter}")


def build_publishers(settings: Settings) -> list[Publisher]:
    publishers: list[Publisher] = []
    for name in settings.publishers:
        if name == "console":
            publishers.append(ConsolePublisher())
        elif name == "notion":
            publishers.append(
                NotionPublisher(
                    token=settings.notion_token,
                    database_id=settings.notion_database_id,
                    data_source_id=settings.notion_data_source_id,
                    properties=settings.notion_properties,
                )
            )
        elif name == "slack":
            publishers.append(
                SlackPublisher(
                    bot_token=settings.slack_bot_token,
                    channel_id=settings.slack_channel_id,
                )
            )
        else:
            raise AdapterError(f"알 수 없는 PUBLISHERS 항목: {name}")
    return publishers


def build_pipeline(settings: Settings, store: Store) -> Pipeline:
    return Pipeline(
        settings=settings,
        store=store,
        source=build_source(settings),
        stt=build_stt(settings),
        analyzer=build_analyzer(settings),
        publishers=build_publishers(settings),
    )
