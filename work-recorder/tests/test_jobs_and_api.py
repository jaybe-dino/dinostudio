"""작업 접수와 상태 조회.

기존 구현의 `지금 바로 정리하기`는 Drive 트리거 파일 방식이라 접수 시점이
불명확했다. 수용 기준은 "버튼 클릭 10초 안에 접수됨 상태"이므로, 여기서는
API가 즉시 202와 job_id를 돌려주는지, 워커가 그 작업을 처리하는지를 고정한다.
"""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from datetime import date

import pytest

from work_recorder.api import create_server
from work_recorder.jobs import TRIGGER_MANUAL, Worker, enqueue_daily_summary, wait_for_job
from work_recorder.store import JOB_FAILED, JOB_QUEUED, JOB_RUNNING, JOB_SUCCEEDED

from helpers import KST_MARCH_21, add_recording


# ── 큐 ────────────────────────────────────────────────────────────────
def test_enqueue_returns_queued_job_immediately(store):
    job, created = enqueue_daily_summary(store, KST_MARCH_21, trigger_type=TRIGGER_MANUAL)

    assert created is True
    assert job["status"] == JOB_QUEUED
    assert job["business_date"] == "2026-03-21"
    assert len(job["job_id"]) > 0


def test_enqueue_dedupes_active_jobs(store):
    first, created_first = enqueue_daily_summary(store, KST_MARCH_21)
    second, created_second = enqueue_daily_summary(store, KST_MARCH_21)

    assert created_first is True
    assert created_second is False
    assert first["job_id"] == second["job_id"]
    assert len(store.recent_jobs(10)) == 1


def test_enqueue_can_skip_dedupe(store):
    enqueue_daily_summary(store, KST_MARCH_21)
    _, created = enqueue_daily_summary(store, KST_MARCH_21, dedupe=False)

    assert created is True
    assert len(store.recent_jobs(10)) == 2


def test_claim_job_is_atomic_across_threads(store):
    for _ in range(5):
        enqueue_daily_summary(store, KST_MARCH_21, dedupe=False)

    claimed: list[str] = []
    lock = threading.Lock()

    def worker():
        while True:
            job = store.claim_job()
            if job is None:
                return
            with lock:
                claimed.append(job["id"])

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(claimed) == 5
    assert len(set(claimed)) == 5  # 같은 작업을 두 워커가 집지 않는다


# ── 워커 ──────────────────────────────────────────────────────────────
def test_worker_runs_pipeline_and_records_result(settings, store, build_pipeline, recordings_dir):
    add_recording(recordings_dir, "업무녹음_20260321_060127_part001.wav", "킥오프")
    job, _ = enqueue_daily_summary(store, KST_MARCH_21)

    worker = Worker(settings, store, pipeline_factory=build_pipeline)
    processed = worker.run_once()

    assert processed["job_id"] == job["job_id"]
    assert processed["status"] == JOB_SUCCEEDED
    assert processed["result"]["transcribed"] == 1
    assert processed["result"]["analyzed"] is True
    assert processed["attempts"] == 1


def test_worker_returns_none_when_queue_empty(settings, store, build_pipeline):
    worker = Worker(settings, store, pipeline_factory=build_pipeline)
    assert worker.run_once() is None


def test_worker_records_failure_without_dying(settings, store):
    enqueue_daily_summary(store, KST_MARCH_21)

    class BrokenPipeline:
        def run_daily(self, *args, **kwargs):
            raise RuntimeError("저장소 폭발")

    worker = Worker(settings, store, pipeline_factory=BrokenPipeline)
    processed = worker.run_once()

    assert processed["status"] == JOB_FAILED
    assert "저장소 폭발" in processed["error"]
    # 워커는 계속 살아서 다음 작업을 받는다
    assert worker.run_once() is None


def test_wait_for_job_times_out_on_stuck_job(store):
    job, _ = enqueue_daily_summary(store, KST_MARCH_21)
    store.claim_job()  # running 상태로 두고 끝내지 않는다

    with pytest.raises(TimeoutError):
        wait_for_job(store, job["job_id"], timeout=0.3, interval=0.05)

    assert store.job(job["job_id"])["status"] == JOB_RUNNING


# ── API ───────────────────────────────────────────────────────────────
@pytest.fixture
def api(settings, store):
    settings.api_host = "127.0.0.1"
    settings.api_port = 0  # 빈 포트 자동 할당
    server = create_server(settings, store)
    settings.api_port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)


def call(url: str, *, method: str = "GET", payload=None, token: str | None = "test-token"):
    body = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(url, data=body, method=method)
    request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode())


def test_healthz_needs_no_token(api):
    status, body = call(f"{api}/healthz", token=None)
    assert status == 200
    assert body["status"] == "ok"


def test_manual_request_is_accepted_immediately(api, store):
    status, body = call(
        f"{api}/jobs/daily-summary",
        method="POST",
        payload={"business_date": "2026-03-21", "source": "mac_menubar"},
    )

    assert status == 202
    assert body["status"] == JOB_QUEUED
    assert body["created"] is True
    assert body["source"] == "mac_menubar"
    assert store.job(body["job_id"]) is not None


def test_manual_request_defaults_to_today(api, settings):
    from work_recorder.business_date import today

    status, body = call(f"{api}/jobs/daily-summary", method="POST", payload={})
    assert status == 202
    assert body["business_date"] == today(settings.timezone).isoformat()


def test_repeated_button_press_returns_same_job(api):
    _, first = call(f"{api}/jobs/daily-summary", method="POST", payload={"business_date": "today"})
    _, second = call(f"{api}/jobs/daily-summary", method="POST", payload={"business_date": "today"})

    assert first["job_id"] == second["job_id"]
    assert second["created"] is False


def test_job_status_is_queryable(api, settings, store, build_pipeline, recordings_dir):
    add_recording(recordings_dir, "업무녹음_20260321_060127_part001.wav", "킥오프")
    _, accepted = call(
        f"{api}/jobs/daily-summary", method="POST", payload={"business_date": "2026-03-21"}
    )

    status, pending = call(f"{api}/jobs/{accepted['job_id']}")
    assert status == 200
    assert pending["status"] == JOB_QUEUED

    Worker(settings, store, pipeline_factory=build_pipeline).run_once()

    status, done = call(f"{api}/jobs/{accepted['job_id']}")
    assert done["status"] == JOB_SUCCEEDED
    assert done["result"]["transcribed"] == 1


def test_report_endpoint_returns_analysis(
    api, settings, store, build_pipeline, recordings_dir
):
    add_recording(recordings_dir, "업무녹음_20260321_060127_part001.wav", "킥오프")
    build_pipeline().run_daily(KST_MARCH_21)

    status, body = call(f"{api}/reports/2026-03-21")
    assert status == 200
    assert body["title"] == "3/21 킥오프"
    assert body["analysis"]["todos"][0]["task"] == "견적서 초안 작성"


def test_missing_report_is_404(api):
    status, _ = call(f"{api}/reports/2026-01-01")
    assert status == 404


def test_authentication_is_required(api):
    status, body = call(f"{api}/jobs", token=None)
    assert status == 401
    assert "Authorization" in body["error"]

    status, _ = call(f"{api}/jobs", token="wrong-token")
    assert status == 401


def test_bad_date_is_rejected(api):
    status, body = call(
        f"{api}/jobs/daily-summary", method="POST", payload={"business_date": "언젠가"}
    )
    assert status == 400
    assert "업무일" in body["error"]


def test_unknown_path_is_404(api):
    status, _ = call(f"{api}/nope")
    assert status == 404


def test_jobs_listing_respects_limit(api, store):
    for _ in range(3):
        enqueue_daily_summary(store, date(2026, 3, 21), dedupe=False)

    status, body = call(f"{api}/jobs?limit=2")
    assert status == 200
    assert len(body["jobs"]) == 2
