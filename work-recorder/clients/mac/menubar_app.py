#!/usr/bin/env python3
"""맥 메뉴바 녹음 앱.

상단 상태바 아이콘 하나로 전부 제어한다 — 녹음 시작·종료, 오늘 녹음 정리,
매일 자정 자동 정리까지. 별도로 서버를 띄울 필요가 없다.

기존 앱에서 고친 것:

* **아이콘이 안 보이던 문제** — LaunchAgent로 파이썬 스크립트를 띄우는 대신
  `~/Applications/업무녹음.app` 번들로 실행한다(`LSUIElement`라 Dock에는 안 뜬다).
  마이크 권한도 이 앱 하나에만 물으므로 실행 주체가 바뀌어 권한이 꼬이지 않는다.
* **메모리에 쌓다가 저장** — 받는 즉시 디스크에 기록한다(work_recorder.recorder).
* **종료 후 일괄 업로드** — 30분 청크가 닫히는 즉시 업로드하고, 실패하면 재시도
  큐에 남는다. 네트워크가 끊겨도 로컬 원본은 그대로다.
* **`지금 바로 정리하기`의 불확실함** — Drive 트리거 파일 대신 작업 큐에 직접
  넣고, 접수·진행·완료를 메뉴에 표시한다.
* **자정 실행이 외부 스케줄러에 의존하던 문제** — 앱이 켜져 있으면 워커와
  스케줄러가 함께 돈다.

실행: ~/Applications/업무녹음.app (mac/setup.sh가 만들어 준다)
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

# 앱 번들에서 실행될 때를 대비해 패키지 경로를 잡아 준다.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from work_recorder.business_date import today as business_today  # noqa: E402
from work_recorder.config import Settings  # noqa: E402
from work_recorder.jobs import (  # noqa: E402
    TRIGGER_MANUAL,
    Worker,
    describe_job,
    enqueue_daily_summary,
    job_to_dict,
)
from work_recorder.recorder import ChunkInfo, RecordingSession, UploadQueue  # noqa: E402
from work_recorder.scheduler import Scheduler  # noqa: E402
from work_recorder.store import Store  # noqa: E402

logger = logging.getLogger("menubar")

IDLE_ICON = "🎙"
RECORDING_ICON = "🔴"
WARNING_ICON = "⚠️"

MIC_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"

def _open(*args: str) -> None:
    """Finder/설정 앱 열기. 실패해도 앱이 죽지 않는다."""
    try:
        subprocess.run(["open", *args], check=False)
    except OSError:
        logger.warning("open 명령을 실행하지 못했습니다: %s", args)


def _require_rumps():
    try:
        import rumps
    except ImportError:  # pragma: no cover - 맥 전용
        print(
            "rumps가 설치되지 않았습니다. 다음을 실행하세요:\n"
            '  pip install "work-recorder[mac]"',
            file=sys.stderr,
        )
        raise SystemExit(1)
    return rumps


rumps = _require_rumps()


class WorkRecorderApp(rumps.App):
    def __init__(self, settings: Settings, env_file: Path):
        super().__init__(IDLE_ICON, quit_button=None)
        self.settings = settings
        self.env_file = env_file

        self.store = Store(settings.database_path)
        self.session: RecordingSession | None = None
        self._stream = None
        self._job_id: str | None = None

        self.uploads = UploadQueue(
            self._upload_chunk,
            state_path=settings.home / "uploads.json",
            on_change=self._refresh,
        )

        # ── 메뉴 ──────────────────────────────────────────────────────
        self.record_item = rumps.MenuItem("● 녹음 시작", callback=self.toggle_recording)
        self.status_item = self._label("대기 중")
        self.summarize_item = rumps.MenuItem("오늘 녹음 정리하기", callback=self.summarize_now)
        self.job_item = self._label("")
        self.schedule_item = self._label(
            f"자동 정리: 매일 {settings.daily_summary_time} ({settings.timezone})"
        )

        self.menu = [
            self.record_item,
            self.status_item,
            None,
            self.summarize_item,
            self.job_item,
            self.schedule_item,
            None,
            rumps.MenuItem("녹음 폴더 열기", callback=self.open_folder),
            rumps.MenuItem("설정 열기", callback=self.open_settings),
            rumps.MenuItem("점검하기", callback=self.check_health),
            None,
            rumps.MenuItem("종료", callback=self.quit_app),
        ]

        # ── 백그라운드 ────────────────────────────────────────────────
        self.uploads.start()
        requeued = self.uploads.requeue_pending()
        if requeued:
            logger.info("이전에 못 올린 파일 %d건을 다시 업로드합니다.", requeued)

        self.worker = Worker(settings, self.store)
        self.worker.start_thread()
        self.scheduler = Scheduler(settings, self.store)
        self.scheduler.start_thread()
        logger.info("워커·스케줄러 시작 (업무일 오늘: %s)", business_today(settings.timezone))

        rumps.Timer(self._tick, 2).start()
        self._refresh()

    # ── 녹음 ──────────────────────────────────────────────────────────
    def toggle_recording(self, _=None) -> None:
        if self.session is None:
            self.start_recording()
        else:
            self.stop_recording()

    def start_recording(self) -> None:
        try:
            import sounddevice
        except (ImportError, OSError) as exc:
            self._alert(
                "녹음을 시작할 수 없습니다",
                f"오디오 라이브러리를 불러오지 못했습니다.\n\n{exc}\n\n"
                'mac/setup.sh 를 다시 실행하면 필요한 패키지가 설치됩니다.',
            )
            return

        started = datetime.now(timezone.utc)
        try:
            session = RecordingSession(
                self.settings.local_source_dir,
                started_at=started,
                chunk_minutes=self._chunk_minutes(),
                timezone_name=self.settings.timezone,
                cutoff_hour=self.settings.business_day_cutoff_hour,
                on_chunk_complete=self._on_chunk_complete,
            )

            def callback(indata, _frames, _time_info, status):
                if status:
                    logger.warning("오디오 상태: %s", status)
                session.write(bytes(indata))

            stream = sounddevice.RawInputStream(
                samplerate=session.sample_rate,
                channels=session.channels,
                dtype="int16",
                callback=callback,
            )
            stream.start()
        except Exception as exc:  # noqa: BLE001 - 장치·권한 오류를 사용자에게 보여준다
            logger.exception("녹음 시작 실패")
            self._alert(
                "마이크를 열 수 없습니다",
                f"{exc}\n\n마이크 권한이 필요할 수 있습니다.\n"
                "시스템 설정 → 개인정보 보호 및 보안 → 마이크 에서 '업무녹음'을 켜주세요.",
                open_mic_settings=True,
            )
            return

        self.session = session
        self._stream = stream
        logger.info("녹음 시작 (업무일 %s)", session.business_date)
        self._refresh()

    def stop_recording(self) -> None:
        stream, session = self._stream, self.session
        self._stream, self.session = None, None

        if stream is not None:
            try:
                stream.stop()
                stream.close()
            except Exception:  # noqa: BLE001
                logger.exception("오디오 스트림 종료 실패")

        if session is not None:
            chunks = session.stop()
            logger.info("녹음 종료 — 청크 %d개", len(chunks))
            rumps.notification(
                "업무녹음",
                "녹음이 끝났습니다",
                f"{len(chunks)}개 파일 · {self._format_duration(session.elapsed_seconds)}",
            )
        self._refresh()

    def _on_chunk_complete(self, chunk: ChunkInfo) -> None:
        """청크가 닫히는 즉시 호출된다. 세션 종료를 기다리지 않는다."""
        if self.settings.source_adapter == "google_drive":
            self.uploads.add(chunk.path, chunk.business_date)

    def _upload_chunk(self, path: Path, business_date) -> None:
        from work_recorder.factory import build_source

        source = build_source(self.settings)
        upload = getattr(source, "upload", None)
        if upload is None:
            raise RuntimeError(f"{source.name} 저장소는 업로드를 지원하지 않습니다.")
        upload(path, business_date)

    # ── 정리 ──────────────────────────────────────────────────────────
    def summarize_now(self, _=None) -> None:
        if self.session is not None:
            # 녹음 중이면 지금까지의 청크가 아직 열려 있다. 먼저 닫아야 그날 분석에 들어간다.
            response = rumps.alert(
                "녹음 중입니다",
                "지금 정리하려면 녹음을 먼저 끝내야 진행 중인 파일까지 포함됩니다.\n"
                "녹음을 끝내고 정리할까요?",
                ok="끝내고 정리",
                cancel="취소",
            )
            if response != 1:
                return
            self.stop_recording()

        target = business_today(
            self.settings.timezone, self.settings.business_day_cutoff_hour
        )
        job, created = enqueue_daily_summary(
            self.store, target, trigger_type=TRIGGER_MANUAL, source="mac_menubar"
        )
        self._job_id = job["job_id"]
        self.job_item.title = f"  {describe_job(job)}"
        logger.info("작업 접수 %s (신규=%s)", self._job_id, created)
        threading.Thread(target=self._poll_job, args=(self._job_id,), daemon=True).start()

    def _poll_job(self, job_id: str) -> None:
        while True:
            row = self.store.job(job_id)
            if row is None:
                return
            job = job_to_dict(row)
            self.job_item.title = f"  {describe_job(job)}"
            if job["status"] in ("succeeded", "failed"):
                rumps.notification("업무녹음", "정리 결과", describe_job(job))
                return
            time.sleep(1.5)

    # ── 메뉴 동작 ─────────────────────────────────────────────────────
    def open_folder(self, _=None) -> None:
        self.settings.local_source_dir.mkdir(parents=True, exist_ok=True)
        _open(str(self.settings.local_source_dir))

    def open_settings(self, _=None) -> None:
        _open("-t", str(self.env_file))

    def check_health(self, _=None) -> None:
        lines = [
            f"녹음 폴더: {self.settings.local_source_dir}",
            f"저장소: {self.settings.source_adapter}",
            f"전사: {self.settings.stt_adapter} · 분석: {self.settings.analyzer_adapter}",
            f"발행: {', '.join(self.settings.publishers)}",
        ]

        try:
            import sounddevice

            lines.append(f"마이크: {sounddevice.query_devices(kind='input')['name']}")
        except Exception as exc:  # noqa: BLE001
            lines.append(f"마이크: 사용할 수 없음 ({exc})")

        if self.uploads.pending_count:
            lines.append(f"업로드 대기: {self.uploads.pending_count}건")
        failed = self.uploads.failed_files
        if failed:
            lines.append(f"업로드 실패: {', '.join(failed[:3])}")

        recent = self.store.recent_jobs(3)
        if recent:
            lines.append("")
            lines.append("최근 정리:")
            for row in recent:
                lines.append(f"  {row['business_date']} — {row['status']}")

        problems = self.settings.check()
        if problems:
            lines.append("")
            lines.extend(f"! {problem}" for problem in problems)

        self._alert("점검 결과", "\n".join(lines))

    def quit_app(self, _=None) -> None:
        if self.session is not None:
            self.stop_recording()
        self.scheduler.stop()
        self.worker.stop()
        self.uploads.stop()
        self.store.close()
        rumps.quit_application()

    # ── 표시 ──────────────────────────────────────────────────────────
    def _tick(self, _timer) -> None:
        if self.session is not None:
            self._refresh()

    def _refresh(self) -> None:
        if self.session is not None:
            self.title = RECORDING_ICON
            self.record_item.title = "■ 녹음 종료"
            self.status_item.title = (
                f"녹음 중 {self._format_duration(self.session.elapsed_seconds)}"
                f" · {self.session.chunk_count}개 파일"
            )
            return

        failed = len(self.uploads.failed_files)
        pending = self.uploads.pending_count
        self.title = WARNING_ICON if failed else IDLE_ICON
        self.record_item.title = "● 녹음 시작"
        if failed:
            self.status_item.title = f"업로드 실패 {failed}건 — 점검이 필요합니다"
        elif pending:
            self.status_item.title = f"업로드 중 {pending}건"
        else:
            self.status_item.title = "대기 중"

    # ── 보조 ──────────────────────────────────────────────────────────
    def _label(self, title: str):
        """클릭할 수 없는 표시 전용 메뉴 항목."""
        item = rumps.MenuItem(title)
        item.set_callback(None)
        return item

    def _chunk_minutes(self) -> int:
        try:
            return max(1, int(os.environ.get("RECORDING_CHUNK_MINUTES", "30")))
        except ValueError:
            return 30

    @staticmethod
    def _format_duration(seconds: float) -> str:
        total = int(seconds)
        return f"{total // 3600:02d}:{(total % 3600) // 60:02d}:{total % 60:02d}"

    def _alert(self, title: str, message: str, *, open_mic_settings: bool = False) -> None:
        if open_mic_settings:
            if rumps.alert(title, message, ok="마이크 설정 열기", cancel="닫기") == 1:
                _open(MIC_SETTINGS_URL)
            return
        rumps.alert(title, message)


def main() -> None:
    env_file = Path(os.environ.get("WORK_RECORDER_ENV_FILE", ".env")).expanduser()
    settings = Settings.from_env(env_file)
    settings.ensure_dirs()
    settings.local_source_dir.mkdir(parents=True, exist_ok=True)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s — %(message)s",
        handlers=[
            logging.FileHandler(settings.home / "menubar.log", encoding="utf-8"),
            logging.StreamHandler(),
        ],
    )
    WorkRecorderApp(settings, env_file).run()


if __name__ == "__main__":
    main()
