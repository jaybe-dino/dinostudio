"""작업 큐와 워커.

기존 구현에서 `지금 바로 정리하기`는 Drive에 트리거 파일을 올리고, 별도 감지 작업이
언젠가 그것을 발견하는 구조였다. 버튼을 눌러도 접수됐는지 알 수 없었다.

여기서는 API가 DB에 작업을 넣고 즉시 `queued` 상태와 job_id를 돌려준다. 워커가
작업을 원자적으로 점유해 실행하고, 클라이언트는 `GET /jobs/{id}`로 진행 상태를 본다.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import date
from typing import Callable

from .config import Settings
from .factory import build_pipeline
from .pipeline import Pipeline
from .store import JOB_FAILED, JOB_SUCCEEDED, Store

logger = logging.getLogger(__name__)

TRIGGER_MANUAL = "manual"
TRIGGER_SCHEDULED = "scheduled"
TRIGGER_CLI = "cli"


def enqueue_daily_summary(
    store: Store,
    business_date: date,
    *,
    trigger_type: str = TRIGGER_MANUAL,
    source: str = "",
    dedupe: bool = True,
) -> tuple[dict, bool]:
    """작업을 큐에 넣는다. (작업 정보, 새로 만들었는지)

    같은 업무일에 이미 대기·실행 중인 작업이 있으면 그것을 그대로 돌려준다.
    버튼을 연타해도 같은 날짜가 중복 처리되지 않는다.
    """
    if dedupe:
        active = store.has_active_job(business_date)
        if active is not None:
            return job_to_dict(active), False

    row = store.enqueue_job(
        trigger_type=trigger_type, business_date=business_date, source=source
    )
    return job_to_dict(row), True


def job_to_dict(row) -> dict:
    import json

    return {
        "job_id": row["id"],
        "status": row["status"],
        "trigger_type": row["trigger_type"],
        "business_date": row["business_date"],
        "source": row["source"],
        "requested_at": row["requested_at"],
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
        "attempts": row["attempts"],
        "error": row["error"],
        "result": json.loads(row["result"]) if row["result"] else None,
    }


class Worker:
    """큐를 소비하는 워커. 단일 프로세스에서 스레드로도, 별도 프로세스로도 돌릴 수 있다."""

    def __init__(
        self,
        settings: Settings,
        store: Store,
        *,
        pipeline_factory: Callable[[], Pipeline] | None = None,
    ):
        self.settings = settings
        self.store = store
        self._pipeline_factory = pipeline_factory or (lambda: build_pipeline(settings, store))
        self._pipeline: Pipeline | None = None
        self._stop = threading.Event()

    @property
    def pipeline(self) -> Pipeline:
        if self._pipeline is None:
            self._pipeline = self._pipeline_factory()
        return self._pipeline

    def run_once(self) -> dict | None:
        """대기 중인 작업 하나를 처리한다. 없으면 None."""
        job = self.store.claim_job()
        if job is None:
            return None

        business_date = date.fromisoformat(job["business_date"])
        logger.info("작업 시작 %s (%s, %s)", job["id"], job["trigger_type"], business_date)
        try:
            result = self.pipeline.run_daily(business_date)
        except Exception as exc:  # noqa: BLE001 - 워커는 어떤 예외에도 살아 있어야 한다
            logger.exception("작업 실패 %s", job["id"])
            self.store.finish_job(job["id"], status=JOB_FAILED, error=str(exc))
            return job_to_dict(self.store.job(job["id"]))

        self.store.finish_job(job["id"], status=JOB_SUCCEEDED, result=result.to_dict())
        logger.info("작업 완료 %s — %s", job["id"], result.to_dict())
        return job_to_dict(self.store.job(job["id"]))

    def run_forever(self, poll_seconds: int | None = None) -> None:
        interval = poll_seconds or self.settings.worker_poll_seconds
        logger.info("워커 시작 (폴링 %ds)", interval)
        while not self._stop.is_set():
            try:
                processed = self.run_once()
            except Exception:  # noqa: BLE001 - 큐 접근 실패도 워커를 죽이지 않는다
                logger.exception("워커 루프 오류")
                processed = None
            if processed is None:
                self._stop.wait(interval)

    def stop(self) -> None:
        self._stop.set()

    def start_thread(self, poll_seconds: int | None = None) -> threading.Thread:
        thread = threading.Thread(
            target=self.run_forever, args=(poll_seconds,), name="work-recorder-worker", daemon=True
        )
        thread.start()
        return thread


def wait_for_job(store: Store, job_id: str, timeout: float = 300.0, interval: float = 1.0) -> dict:
    """작업이 끝날 때까지 기다린다. CLI가 동기 실행을 흉내 낼 때 쓴다."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        row = store.job(job_id)
        if row is None:
            raise KeyError(f"작업을 찾을 수 없습니다: {job_id}")
        if row["status"] in (JOB_SUCCEEDED, JOB_FAILED):
            return job_to_dict(row)
        time.sleep(interval)
    raise TimeoutError(f"작업이 {timeout}초 안에 끝나지 않았습니다: {job_id}")
