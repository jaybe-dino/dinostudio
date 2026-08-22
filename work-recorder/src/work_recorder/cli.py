"""명령줄 인터페이스.

    work-recorder doctor                     설정·연결 점검
    work-recorder run-daily [--date ...]      즉시 한 업무일 처리 (동기)
    work-recorder enqueue [--date ...]        작업만 큐에 넣기
    work-recorder worker                      큐 소비 워커
    work-recorder serve [--with-worker ...]   작업 API 서버 (로컬 올인원 실행 가능)
    work-recorder scheduler                   정기 실행만
    work-recorder status [--date ...]         업무일 처리 현황
    work-recorder auth-google                 Google OAuth 최초 인증
"""

from __future__ import annotations

import argparse
import json
import logging
import signal
import sys
import threading
from datetime import date
from pathlib import Path

from .business_date import resolve_business_date
from .config import Settings
from .factory import build_pipeline, build_source
from .jobs import TRIGGER_CLI, Worker, enqueue_daily_summary
from .scheduler import Scheduler
from .store import Store


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="work-recorder", description="업무 녹음 자동화 — 서버 파이프라인"
    )
    parser.add_argument("--env-file", type=Path, default=Path(".env"), help="설정 파일 경로")
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        help="로그 레벨",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("doctor", help="설정과 연결 상태를 점검한다")

    run_daily = subparsers.add_parser("run-daily", help="한 업무일을 즉시 처리한다")
    run_daily.add_argument("--date", default="yesterday", help="today | yesterday | YYYY-MM-DD")
    run_daily.add_argument("--force", action="store_true", help="변경이 없어도 재분석·재발행")
    run_daily.add_argument("--skip-publish", action="store_true", help="Notion/Slack 발행 생략")

    enqueue = subparsers.add_parser("enqueue", help="작업만 큐에 넣는다")
    enqueue.add_argument("--date", default="today", help="today | yesterday | YYYY-MM-DD")
    enqueue.add_argument("--source", default="cli")

    worker = subparsers.add_parser("worker", help="큐를 소비하는 워커를 실행한다")
    worker.add_argument("--once", action="store_true", help="대기 작업 하나만 처리하고 종료")

    serve = subparsers.add_parser("serve", help="작업 API 서버를 실행한다")
    serve.add_argument("--with-worker", action="store_true", help="워커를 같은 프로세스에서 실행")
    serve.add_argument("--with-scheduler", action="store_true", help="정기 실행도 함께")

    subparsers.add_parser("scheduler", help="정기 실행만 담당한다")

    status = subparsers.add_parser("status", help="업무일 처리 현황을 본다")
    status.add_argument("--date", default="today", help="today | yesterday | YYYY-MM-DD")
    status.add_argument("--jobs", type=int, default=5, help="최근 작업 표시 개수")

    subparsers.add_parser("auth-google", help="Google OAuth 최초 인증을 수행한다")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(levelname)-7s %(name)s — %(message)s",
    )

    settings = Settings.from_env(args.env_file)
    settings.ensure_dirs()

    handlers = {
        "doctor": _doctor,
        "run-daily": _run_daily,
        "enqueue": _enqueue,
        "worker": _worker,
        "serve": _serve,
        "scheduler": _scheduler,
        "status": _status,
        "auth-google": _auth_google,
    }
    return handlers[args.command](args, settings)


# ── 명령 구현 ────────────────────────────────────────────────────────
def _doctor(args, settings: Settings) -> int:
    print("설정 요약")
    print(f"  시간대            : {settings.timezone} (업무일 경계 {settings.business_day_cutoff_hour}시)")
    print(f"  정기 실행         : 매일 {settings.daily_summary_time}")
    print(f"  DB                : {settings.database_path}")
    print(f"  저장소 어댑터     : {settings.source_adapter}")
    print(f"  STT 어댑터        : {settings.stt_adapter}")
    print(f"  분석 어댑터       : {settings.analyzer_adapter} ({settings.llm_model})")
    print(f"  발행 대상         : {', '.join(settings.publishers)}")
    print(f"  작업 API          : http://{settings.api_host}:{settings.api_port}")

    problems = settings.check()
    if problems:
        print("\n확인이 필요한 항목:")
        for problem in problems:
            print(f"  ! {problem}")
    else:
        print("\n설정 점검 통과.")

    try:
        source = build_source(settings)
        from .business_date import day_bounds, today

        since, until = day_bounds(
            today(settings.timezone, settings.business_day_cutoff_hour),
            settings.timezone,
            settings.business_day_cutoff_hour,
        )
        found = source.list_recordings(since, until)
        print(f"\n저장소 연결 OK — 오늘 업무일 파일 {len(found)}건")
    except Exception as exc:  # noqa: BLE001 - 진단 명령이므로 원인만 보여준다
        print(f"\n저장소 연결 실패: {exc}")
        return 1
    return 1 if problems else 0


def _run_daily(args, settings: Settings) -> int:
    business_date = _resolve(args.date, settings)
    with Store(settings.database_path) as store:
        pipeline = build_pipeline(settings, store)
        result = pipeline.run_daily(
            business_date, force=args.force, skip_publish=args.skip_publish
        )
    print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
    return 1 if result.errors and not result.analyzed else 0


def _enqueue(args, settings: Settings) -> int:
    business_date = _resolve(args.date, settings)
    with Store(settings.database_path) as store:
        job, created = enqueue_daily_summary(
            store, business_date, trigger_type=TRIGGER_CLI, source=args.source
        )
    job["created"] = created
    print(json.dumps(job, ensure_ascii=False, indent=2))
    return 0


def _worker(args, settings: Settings) -> int:
    with Store(settings.database_path) as store:
        worker = Worker(settings, store)
        if args.once:
            processed = worker.run_once()
            print(json.dumps(processed, ensure_ascii=False, indent=2) if processed else "대기 중인 작업 없음")
            return 0
        _install_signal_handlers(worker.stop)
        worker.run_forever()
    return 0


def _serve(args, settings: Settings) -> int:
    from .api import create_server

    with Store(settings.database_path) as store:
        stoppers = []
        if args.with_worker:
            worker = Worker(settings, store)
            worker.start_thread()
            stoppers.append(worker.stop)
        if args.with_scheduler:
            scheduler = Scheduler(settings, store)
            scheduler.start_thread()
            stoppers.append(scheduler.stop)

        server = create_server(settings, store)
        print(f"작업 API 대기 중: http://{settings.api_host}:{settings.api_port}")
        if not settings.api_token:
            print("경고: API_TOKEN이 없어 인증 없이 열려 있습니다.")

        def shutdown() -> None:
            for stop in stoppers:
                stop()
            server.shutdown()

        _install_signal_handlers(shutdown)
        try:
            server.serve_forever()
        finally:
            server.server_close()
    return 0


def _scheduler(args, settings: Settings) -> int:
    with Store(settings.database_path) as store:
        scheduler = Scheduler(settings, store)
        _install_signal_handlers(scheduler.stop)
        scheduler.run_forever()
    return 0


def _status(args, settings: Settings) -> int:
    business_date = _resolve(args.date, settings)
    with Store(settings.database_path) as store:
        recordings = store.recordings_for_date(business_date)
        report = store.daily_report(business_date)
        jobs = store.recent_jobs(args.jobs)

        print(f"업무일 {business_date} — 녹음 {len(recordings)}건")
        for row in recordings:
            note = f" ({row['error']})" if row["error"] else ""
            print(
                f"  [{row['status']:<12}] {row['file_name']} "
                f"재시도 {row['retry_count']}{note}"
            )

        if report:
            print(
                f"\n리포트 v{report['version']} — {report['title']} "
                f"(전사 {report['transcript_chars']:,}자, 갱신 {report['updated_at']})"
            )
            for channel in ("notion", "slack", "console"):
                publication = store.publication(business_date, channel)
                if publication:
                    print(f"  발행 {channel}: {publication['url'] or publication['external_id']}")
        else:
            print("\n아직 생성된 리포트가 없습니다.")

        if jobs:
            print("\n최근 작업")
            for row in jobs:
                print(
                    f"  {row['id'][:8]} {row['status']:<9} {row['business_date']} "
                    f"{row['trigger_type']:<9} {row['requested_at']}"
                )
    return 0


def _auth_google(args, settings: Settings) -> int:
    from .adapters.source_google_drive import GoogleDriveSource

    if settings.source_adapter != "google_drive":
        print("SOURCE_ADAPTER=google_drive 로 설정한 뒤 실행하세요.")
        return 1
    source = GoogleDriveSource(
        settings.drive_folder_id,
        credentials_path=settings.google_credentials_path,
        token_path=settings.google_token_path,
        timezone_name=settings.timezone,
        cutoff_hour=settings.business_day_cutoff_hour,
    )
    source.service  # 인증 플로우 실행 및 토큰 저장  # noqa: B018
    print(f"인증 완료. 토큰: {settings.google_token_path}")
    return 0


# ── 보조 ──────────────────────────────────────────────────────────────
def _resolve(value: str, settings: Settings) -> date:
    return resolve_business_date(
        value, settings.timezone, settings.business_day_cutoff_hour
    )


def _install_signal_handlers(stop) -> None:
    def handler(signum, _frame):  # pragma: no cover - 신호 처리
        logging.getLogger(__name__).info("종료 신호 수신 (%s)", signum)
        # serve_forever()가 메인 스레드를 붙잡고 있으므로 별도 스레드에서 멈춘다.
        threading.Thread(target=stop, daemon=True).start()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, handler)
        except ValueError:  # pragma: no cover - 메인 스레드가 아닐 때
            pass


if __name__ == "__main__":
    sys.exit(main())
