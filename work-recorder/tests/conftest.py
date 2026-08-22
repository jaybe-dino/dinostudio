"""pytest 픽스처."""

from __future__ import annotations

from pathlib import Path

import pytest

from work_recorder.adapters.analyzer import MockAnalyzer
from work_recorder.adapters.source_local import LocalDirectorySource
from work_recorder.config import Settings
from work_recorder.models import DailyAnalysis, Todo
from work_recorder.pipeline import Pipeline
from work_recorder.store import Store

from helpers import RecordingPublisher, SidecarSTT


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        timezone="Asia/Seoul",
        business_day_cutoff_hour=0,
        home=tmp_path,
        database_path=tmp_path / "state.db",
        work_dir=tmp_path / "work",
        source_adapter="local",
        stt_adapter="mock",
        analyzer_adapter="mock",
        publishers=("console",),
        local_source_dir=tmp_path / "recordings",
        max_retry_count=3,
        api_token="test-token",
    )


@pytest.fixture
def store(settings: Settings):
    store = Store(settings.database_path)
    yield store
    store.close()


@pytest.fixture
def analysis() -> DailyAnalysis:
    return DailyAnalysis(
        daily_title="3/21 킥오프",
        executive_summary="신규 프로젝트 킥오프를 진행했다.",
        todos=[
            Todo(
                task="견적서 초안 작성",
                assignee="지훈",
                priority="높음",
                deadline="2026-03-24",
                confidence="높음",
                source_excerpt="견적서는 월요일까지 부탁드립니다",
            )
        ],
        key_decisions=["3월 말 베타 오픈"],
        issues=["디자인 리소스 부족"],
        participants=["지훈", "수민"],
        follow_ups=["디자인팀 일정 확인"],
    )


@pytest.fixture
def recordings_dir(settings: Settings) -> Path:
    settings.local_source_dir.mkdir(parents=True, exist_ok=True)
    return settings.local_source_dir


@pytest.fixture
def build_pipeline(settings: Settings, store: Store, analysis: DailyAnalysis):
    def _build(*, publishers=None, stt=None, analyzer=None) -> Pipeline:
        return Pipeline(
            settings=settings,
            store=store,
            source=LocalDirectorySource(
                settings.local_source_dir,
                timezone_name=settings.timezone,
                cutoff_hour=settings.business_day_cutoff_hour,
            ),
            stt=stt or SidecarSTT(settings.local_source_dir),
            analyzer=analyzer or MockAnalyzer(result=analysis),
            publishers=publishers if publishers is not None else [RecordingPublisher()],
        )

    return _build
