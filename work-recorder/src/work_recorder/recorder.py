"""녹음 세션 코어 — 오디오 장치와 UI에서 분리한 부분.

메뉴바 앱(clients/mac/menubar_app.py)이 마이크에서 읽은 바이트를 여기로 넘기면,
이 모듈이 WAV 파일로 디스크에 바로 기록하고 청크를 나눈다. 장치도 UI도 모르기
때문에 오디오 하드웨어 없이 테스트할 수 있다.

기존 구현 대비 고친 점:

* **스트리밍 기록** — 청크 프레임을 메모리에 모았다가 저장하지 않고 받는 즉시
  파일에 쓴다. 8시간 녹음에도 메모리 사용량이 일정하다.
* **청크 완료 즉시 알림** — 30분 청크가 닫히는 순간 콜백이 불린다. 세션이 끝날
  때까지 기다리지 않고 바로 업로드할 수 있다.
* **업무일 고정** — 파일명의 업무일은 세션 시작 시각 기준이다. 자정을 넘겨
  이어진 녹음이 두 날짜로 쪼개지지 않는다.
* **무음 파일도 보존** — RMS 임계값으로 파일을 버리지 않는다. 품질 경고는
  분석 단계에서 남긴다.
"""

from __future__ import annotations

import json
import logging
import queue
import threading
import time
import wave
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Callable
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

DEFAULT_SAMPLE_RATE = 44100
DEFAULT_CHANNELS = 1
DEFAULT_SAMPLE_WIDTH = 2  # int16
DEFAULT_CHUNK_MINUTES = 30


def business_date_for(started_at: datetime, tz: str = "Asia/Seoul", cutoff_hour: int = 0) -> date:
    """녹음 세션의 업무일. 서버의 business_date 계산과 같은 규칙."""
    local = started_at.astimezone(ZoneInfo(tz))
    if local.hour < cutoff_hour:
        local -= timedelta(days=1)
    return local.date()


def chunk_file_name(started_at: datetime, part: int, tz: str = "Asia/Seoul") -> str:
    """기존 Mac 앱과 같은 파일명 규칙: 업무녹음_YYYYMMDD_HHMMSS_partNNN.wav"""
    local = started_at.astimezone(ZoneInfo(tz))
    return f"업무녹음_{local:%Y%m%d_%H%M%S}_part{part:03d}.wav"


@dataclass
class ChunkInfo:
    path: Path
    part: int
    business_date: date
    seconds: float
    started_at: datetime


class RecordingSession:
    """한 번의 녹음 세션. 받은 오디오 바이트를 청크 WAV 파일들로 기록한다.

    스레드 안전하다 — `write()`는 오디오 콜백 스레드에서, `stop()`은 UI
    스레드에서 불릴 수 있다.
    """

    def __init__(
        self,
        output_dir: Path,
        *,
        started_at: datetime,
        sample_rate: int = DEFAULT_SAMPLE_RATE,
        channels: int = DEFAULT_CHANNELS,
        sample_width: int = DEFAULT_SAMPLE_WIDTH,
        chunk_minutes: int = DEFAULT_CHUNK_MINUTES,
        timezone_name: str = "Asia/Seoul",
        cutoff_hour: int = 0,
        on_chunk_complete: Callable[[ChunkInfo], None] | None = None,
    ):
        self.output_dir = Path(output_dir).expanduser()
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.started_at = started_at
        self.sample_rate = sample_rate
        self.channels = channels
        self.sample_width = sample_width
        self.chunk_frames = int(chunk_minutes * 60 * sample_rate)
        self.timezone_name = timezone_name
        self.business_date = business_date_for(started_at, timezone_name, cutoff_hour)
        self.on_chunk_complete = on_chunk_complete

        self._lock = threading.Lock()
        self._part = 0
        self._writer: wave.Wave_write | None = None
        self._current_path: Path | None = None
        self._frames_in_chunk = 0
        self._total_frames = 0
        self._closed = False
        self.chunks: list[ChunkInfo] = []

        self._open_next_chunk()

    # ── 상태 ──────────────────────────────────────────────────────────
    @property
    def elapsed_seconds(self) -> float:
        return self._total_frames / self.sample_rate if self.sample_rate else 0.0

    @property
    def chunk_count(self) -> int:
        return self._part

    # ── 기록 ──────────────────────────────────────────────────────────
    def write(self, data: bytes) -> None:
        """오디오 콜백에서 호출. 받은 즉시 디스크에 쓴다."""
        if not data:
            return
        frame_size = self.sample_width * self.channels

        with self._lock:
            if self._closed:
                return
            offset = 0
            while offset < len(data):
                room_frames = self.chunk_frames - self._frames_in_chunk
                room_bytes = max(room_frames, 0) * frame_size
                if room_bytes <= 0:
                    self._rotate()
                    continue

                piece = data[offset : offset + room_bytes]
                assert self._writer is not None
                self._writer.writeframes(piece)
                written_frames = len(piece) // frame_size
                self._frames_in_chunk += written_frames
                self._total_frames += written_frames
                offset += len(piece)

                if self._frames_in_chunk >= self.chunk_frames:
                    self._rotate()

    def stop(self) -> list[ChunkInfo]:
        """녹음을 끝내고 완성된 청크 목록을 돌려준다."""
        with self._lock:
            if self._closed:
                return list(self.chunks)
            self._close_current(discard_if_empty=True)
            self._closed = True
            return list(self.chunks)

    # ── 내부 ──────────────────────────────────────────────────────────
    def _open_next_chunk(self) -> None:
        self._part += 1
        name = chunk_file_name(self.started_at, self._part, self.timezone_name)
        self._current_path = self.output_dir / name
        writer = wave.open(str(self._current_path), "wb")
        writer.setnchannels(self.channels)
        writer.setsampwidth(self.sample_width)
        writer.setframerate(self.sample_rate)
        self._writer = writer
        self._frames_in_chunk = 0
        logger.info("청크 시작: %s", name)

    def _rotate(self) -> None:
        self._close_current(discard_if_empty=False)
        self._open_next_chunk()

    def _close_current(self, *, discard_if_empty: bool) -> None:
        if self._writer is None or self._current_path is None:
            return

        writer, path = self._writer, self._current_path
        frames = self._frames_in_chunk
        self._writer = None
        self._current_path = None
        writer.close()

        if frames == 0:
            # 아직 아무것도 안 들어온 마지막 청크는 빈 파일이 남지 않게 지운다.
            # (무음이라서가 아니라 프레임이 0이라서 지우는 것이다.)
            if discard_if_empty:
                path.unlink(missing_ok=True)
                self._part -= 1
                logger.info("빈 청크 삭제: %s", path.name)
                return

        info = ChunkInfo(
            path=path,
            part=self._part,
            business_date=self.business_date,
            seconds=frames / self.sample_rate if self.sample_rate else 0.0,
            started_at=self.started_at,
        )
        self.chunks.append(info)
        logger.info("청크 완료: %s (%.1f초)", path.name, info.seconds)

        if self.on_chunk_complete is not None:
            # 콜백이 오래 걸리거나 실패해도 녹음은 계속돼야 한다.
            try:
                self.on_chunk_complete(info)
            except Exception:  # noqa: BLE001
                logger.exception("청크 완료 콜백 실패: %s", path.name)


class UploadQueue:
    """청크가 완성되는 즉시 업로드하고, 실패하면 재시도한다.

    대기 목록을 파일에 남기므로 앱이 꺼졌다 켜져도 못 올린 파일을 다시 찾는다.
    네트워크가 끊겨도 로컬 원본은 그대로 남는다.
    """

    def __init__(
        self,
        upload: Callable[[Path, date], None],
        *,
        state_path: Path,
        max_attempts: int = 5,
        retry_seconds: float = 20.0,
        on_change: Callable[[], None] | None = None,
        sleep=time.sleep,
    ):
        self._upload = upload
        self.state_path = Path(state_path).expanduser()
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        self.max_attempts = max_attempts
        self.retry_seconds = retry_seconds
        self.on_change = on_change
        self._sleep = sleep

        self._queue: queue.Queue[tuple[Path, date, int] | None] = queue.Queue()
        self._lock = threading.Lock()
        self._pending: dict[str, str] = {}  # path -> business_date
        self._failed: list[str] = []
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

        self._load_state()

    # ── 상태 ──────────────────────────────────────────────────────────
    @property
    def pending_count(self) -> int:
        with self._lock:
            return len(self._pending)

    @property
    def failed_files(self) -> list[str]:
        with self._lock:
            return list(self._failed)

    # ── 제어 ──────────────────────────────────────────────────────────
    def start(self) -> None:
        if self._thread is not None:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="upload-queue", daemon=True)
        self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        self._queue.put(None)
        if self._thread is not None:
            self._thread.join(timeout=timeout)
            self._thread = None

    def add(self, path: Path, business_date: date) -> None:
        with self._lock:
            self._pending[str(path)] = business_date.isoformat()
            self._save_state()
        self._queue.put((Path(path), business_date, 0))
        self._notify()

    def requeue_pending(self) -> int:
        """앱 시작 시 못 올린 파일을 다시 큐에 넣는다. 넣은 개수를 돌려준다."""
        with self._lock:
            items = [
                (Path(path), date.fromisoformat(value))
                for path, value in self._pending.items()
            ]
        for path, business_date in items:
            if path.exists():
                self._queue.put((path, business_date, 0))
            else:
                self._discard(path)
        return len(items)

    def process_once(self, timeout: float = 0.1) -> bool:
        """큐에서 하나를 꺼내 처리한다. 테스트용 동기 실행 경로."""
        try:
            item = self._queue.get(timeout=timeout)
        except queue.Empty:
            return False
        if item is None:
            return False
        self._handle(*item)
        return True

    # ── 내부 ──────────────────────────────────────────────────────────
    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                item = self._queue.get(timeout=0.5)
            except queue.Empty:
                continue
            if item is None:
                return
            self._handle(*item)

    def _handle(self, path: Path, business_date: date, attempt: int) -> None:
        if not path.exists():
            self._discard(path)
            return
        try:
            self._upload(path, business_date)
        except Exception as exc:  # noqa: BLE001 - 업로드 실패로 앱이 죽으면 안 된다
            if attempt + 1 >= self.max_attempts:
                logger.error("업로드 포기 (%d회 실패): %s — %s", attempt + 1, path.name, exc)
                with self._lock:
                    self._pending.pop(str(path), None)
                    if path.name not in self._failed:
                        self._failed.append(path.name)
                    self._save_state()
                self._notify()
                return
            logger.warning("업로드 실패, 재시도 예정: %s — %s", path.name, exc)
            self._sleep(min(self.retry_seconds * (2**attempt), 300))
            self._queue.put((path, business_date, attempt + 1))
            return

        logger.info("업로드 완료: %s", path.name)
        self._discard(path)

    def _discard(self, path: Path) -> None:
        with self._lock:
            self._pending.pop(str(path), None)
            self._save_state()
        self._notify()

    def _notify(self) -> None:
        if self.on_change is not None:
            try:
                self.on_change()
            except Exception:  # noqa: BLE001
                logger.exception("업로드 상태 콜백 실패")

    def _load_state(self) -> None:
        if not self.state_path.exists():
            return
        try:
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            logger.warning("업로드 대기 목록을 읽지 못했습니다: %s", self.state_path)
            return
        self._pending = {str(k): str(v) for k, v in (data.get("pending") or {}).items()}
        self._failed = [str(name) for name in (data.get("failed") or [])]

    def _save_state(self) -> None:
        """호출자가 self._lock을 잡은 상태에서 부른다."""
        payload = {"pending": self._pending, "failed": self._failed}
        try:
            self.state_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        except OSError:
            logger.warning("업로드 대기 목록을 저장하지 못했습니다: %s", self.state_path)
