"""정기 실행 스케줄러.

기존 구현은 외부 스케줄러 설정에 의존해서 소스만으로는 자정 실행이 보장되지 않았다.
여기서는 프로세스 안에서 KST 기준 지정 시각에 작업을 큐에 넣고, 실행 이력을 DB의
jobs 테이블에 남긴다. launchd/cron을 쓰고 싶다면 `work-recorder run-daily`를
그대로 호출해도 된다.

기본값은 00:05 KST다. 자정 정각은 마지막 청크 업로드가 아직 안 끝났을 수 있어
개발 계획이 5~15분의 여유를 권장한다.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from .business_date import yesterday
from .config import Settings
from .jobs import TRIGGER_SCHEDULED, enqueue_daily_summary
from .store import Store

logger = logging.getLogger(__name__)


def parse_time(value: str) -> tuple[int, int]:
    try:
        hour_text, minute_text = value.strip().split(":", 1)
        hour, minute = int(hour_text), int(minute_text)
    except (ValueError, AttributeError) as exc:
        raise ValueError(f"DAILY_SUMMARY_TIME 형식이 잘못되었습니다(HH:MM): {value!r}") from exc
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ValueError(f"DAILY_SUMMARY_TIME 범위가 잘못되었습니다: {value!r}")
    return hour, minute


def next_run_at(now: datetime, daily_time: str, tz: str) -> datetime:
    """`now` 이후 가장 가까운 실행 시각(해당 시간대 기준)."""
    hour, minute = parse_time(daily_time)
    zone = ZoneInfo(tz)
    local = now.astimezone(zone)
    candidate = local.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate <= local:
        candidate += timedelta(days=1)
    return candidate


class Scheduler:
    def __init__(self, settings: Settings, store: Store):
        self.settings = settings
        self.store = store
        self._stop = threading.Event()

    def enqueue_now(self) -> dict:
        """정기 실행이 처리할 업무일(직전 업무일) 작업을 큐에 넣는다."""
        target = yesterday(self.settings.timezone, self.settings.business_day_cutoff_hour)
        job, created = enqueue_daily_summary(
            self.store, target, trigger_type=TRIGGER_SCHEDULED, source="scheduler"
        )
        logger.info("정기 작업 접수 %s (%s, 신규=%s)", job["job_id"], target, created)
        return job

    def run_forever(self) -> None:
        zone = ZoneInfo(self.settings.timezone)
        logger.info(
            "스케줄러 시작 — 매일 %s (%s)", self.settings.daily_summary_time, self.settings.timezone
        )
        while not self._stop.is_set():
            now = datetime.now(zone)
            target = next_run_at(now, self.settings.daily_summary_time, self.settings.timezone)
            wait_seconds = (target - now).total_seconds()
            logger.info("다음 정기 실행: %s (%.0f초 후)", target.isoformat(), wait_seconds)
            # 시스템 잠자기·시간 변경에 대비해 짧게 끊어서 기다린다.
            while wait_seconds > 0 and not self._stop.is_set():
                slice_seconds = min(wait_seconds, 60.0)
                self._stop.wait(slice_seconds)
                now = datetime.now(zone)
                wait_seconds = (target - now).total_seconds()
            if self._stop.is_set():
                return
            try:
                self.enqueue_now()
            except Exception:  # noqa: BLE001 - 스케줄러는 죽지 않는다
                logger.exception("정기 작업 접수 실패")
            self._stop.wait(60)  # 같은 분에 두 번 접수되지 않게

    def stop(self) -> None:
        self._stop.set()

    def start_thread(self) -> threading.Thread:
        thread = threading.Thread(
            target=self.run_forever, name="work-recorder-scheduler", daemon=True
        )
        thread.start()
        return thread
