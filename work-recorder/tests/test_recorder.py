"""녹음 세션과 업로드 큐 — 오디오 장치 없이 검증한다.

이관 문서가 지적한 세 가지를 고정한다.
* 장시간 녹음에서 메모리에 쌓지 않고 디스크에 바로 기록한다.
* 청크는 세션 종료를 기다리지 않고 닫히는 즉시 업로드 대상이 된다.
* 자정을 넘겨 이어진 녹음도 한 업무일로 묶인다.
"""

from __future__ import annotations

import wave
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from work_recorder.recorder import (
    RecordingSession,
    UploadQueue,
    business_date_for,
    chunk_file_name,
)

RATE = 8000
WIDTH = 2


def frames(count: int) -> bytes:
    """int16 모노 프레임 count개 분량의 바이트."""
    return b"\x01\x00" * count


def make_session(tmp_path: Path, *, started_at: datetime, chunk_seconds: float, **kwargs):
    return RecordingSession(
        tmp_path,
        started_at=started_at,
        sample_rate=RATE,
        channels=1,
        sample_width=WIDTH,
        chunk_minutes=chunk_seconds / 60,
        **kwargs,
    )


# ── 파일명·업무일 ─────────────────────────────────────────────────────
def test_chunk_file_name_matches_existing_convention():
    started = datetime(2026, 3, 20, 21, 1, 27, tzinfo=timezone.utc)  # KST 3/21 06:01:27
    assert chunk_file_name(started, 1) == "업무녹음_20260321_060127_part001.wav"
    assert chunk_file_name(started, 12) == "업무녹음_20260321_060127_part012.wav"


def test_business_date_uses_session_start_in_seoul():
    # UTC 3/20 15:30 == KST 3/21 00:30
    assert business_date_for(datetime(2026, 3, 20, 15, 30, tzinfo=timezone.utc)) == date(
        2026, 3, 21
    )


def test_business_date_respects_cutoff():
    moment = datetime(2026, 3, 20, 18, 0, tzinfo=timezone.utc)  # KST 3/21 03:00
    assert business_date_for(moment, cutoff_hour=4) == date(2026, 3, 20)


def test_recording_across_midnight_stays_one_business_day(tmp_path: Path):
    """23:50에 시작해 자정을 넘긴 녹음의 모든 청크가 같은 업무일이어야 한다."""
    started = datetime(2026, 3, 20, 14, 50, tzinfo=timezone.utc)  # KST 3/20 23:50
    session = make_session(tmp_path, started_at=started, chunk_seconds=1)

    session.write(frames(RATE * 3))  # 3초 → 청크 3개 이상
    session.stop()

    assert len(session.chunks) >= 3
    assert {chunk.business_date for chunk in session.chunks} == {date(2026, 3, 20)}
    assert all("20260320_235000" in chunk.path.name for chunk in session.chunks)


# ── 청크 분할 ─────────────────────────────────────────────────────────
def test_audio_is_split_into_chunks_of_the_right_length(tmp_path: Path):
    session = make_session(
        tmp_path, started_at=datetime.now(timezone.utc), chunk_seconds=2
    )

    session.write(frames(RATE * 5))  # 5초
    session.stop()

    lengths = [_wav_seconds(chunk.path) for chunk in session.chunks]
    assert lengths == pytest.approx([2.0, 2.0, 1.0])
    assert [chunk.part for chunk in session.chunks] == [1, 2, 3]


def test_chunk_boundary_is_exact_even_with_large_writes(tmp_path: Path):
    """한 번에 청크 여러 개 분량이 들어와도 경계가 정확해야 한다."""
    session = make_session(
        tmp_path, started_at=datetime.now(timezone.utc), chunk_seconds=1
    )

    session.write(frames(RATE * 4 + 100))  # 4초 + 100프레임을 한 번에
    session.stop()

    assert len(session.chunks) == 5
    for chunk in session.chunks[:4]:
        assert _wav_frames(chunk.path) == RATE
    assert _wav_frames(session.chunks[4].path) == 100


def test_completed_chunks_are_announced_immediately(tmp_path: Path):
    """세션이 끝나기 전에 콜백이 불려야 즉시 업로드가 가능하다."""
    announced: list[str] = []
    session = make_session(
        tmp_path,
        started_at=datetime.now(timezone.utc),
        chunk_seconds=1,
        on_chunk_complete=lambda chunk: announced.append(chunk.path.name),
    )

    session.write(frames(RATE * 2))
    # 아직 stop()을 부르지 않았는데도 완성된 청크 2개가 통보되어 있어야 한다.
    assert len(announced) == 2

    session.stop()
    assert len(announced) == len(session.chunks)


def test_callback_failure_does_not_stop_recording(tmp_path: Path):
    def explode(_chunk):
        raise RuntimeError("업로드 큐 오류")

    session = make_session(
        tmp_path,
        started_at=datetime.now(timezone.utc),
        chunk_seconds=1,
        on_chunk_complete=explode,
    )

    session.write(frames(RATE * 2))
    session.stop()

    assert len(session.chunks) >= 2  # 콜백이 터져도 기록은 계속된다


def test_silent_audio_is_kept(tmp_path: Path):
    """무음이라고 파일을 버리지 않는다 (기존 구현에서 파일이 사라지던 원인)."""
    session = make_session(
        tmp_path, started_at=datetime.now(timezone.utc), chunk_seconds=10
    )

    session.write(b"\x00\x00" * RATE)  # 완전한 무음 1초
    session.stop()

    assert len(session.chunks) == 1
    assert session.chunks[0].path.exists()
    assert _wav_frames(session.chunks[0].path) == RATE


def test_empty_session_leaves_no_file(tmp_path: Path):
    session = make_session(
        tmp_path, started_at=datetime.now(timezone.utc), chunk_seconds=10
    )
    session.stop()

    assert session.chunks == []
    assert list(tmp_path.glob("*.wav")) == []


def test_stop_is_idempotent(tmp_path: Path):
    session = make_session(tmp_path, started_at=datetime.now(timezone.utc), chunk_seconds=10)
    session.write(frames(RATE))

    first = session.stop()
    second = session.stop()

    assert len(first) == len(second) == 1


def test_write_after_stop_is_ignored(tmp_path: Path):
    session = make_session(tmp_path, started_at=datetime.now(timezone.utc), chunk_seconds=10)
    session.write(frames(RATE))
    session.stop()

    session.write(frames(RATE))  # 늦게 도착한 오디오 콜백

    assert _wav_frames(session.chunks[0].path) == RATE


def test_elapsed_time_tracks_written_audio(tmp_path: Path):
    session = make_session(tmp_path, started_at=datetime.now(timezone.utc), chunk_seconds=10)
    session.write(frames(RATE * 3))

    assert session.elapsed_seconds == pytest.approx(3.0)


# ── 업로드 큐 ─────────────────────────────────────────────────────────
def test_upload_queue_uploads_and_clears_pending(tmp_path: Path):
    uploaded: list[tuple[str, date]] = []
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"x")

    queue = UploadQueue(
        lambda path, business_date: uploaded.append((path.name, business_date)),
        state_path=tmp_path / "state.json",
        sleep=lambda _: None,
    )
    queue.add(audio, date(2026, 3, 21))
    assert queue.pending_count == 1

    queue.process_once()

    assert uploaded == [("a.wav", date(2026, 3, 21))]
    assert queue.pending_count == 0


def test_upload_queue_retries_then_succeeds(tmp_path: Path):
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"x")
    attempts = {"count": 0}

    def flaky(_path, _business_date):
        attempts["count"] += 1
        if attempts["count"] < 3:
            raise ConnectionError("네트워크 끊김")

    queue = UploadQueue(
        flaky, state_path=tmp_path / "state.json", sleep=lambda _: None
    )
    queue.add(audio, date(2026, 3, 21))

    while queue.process_once():
        pass

    assert attempts["count"] == 3
    assert queue.pending_count == 0
    assert queue.failed_files == []


def test_upload_queue_gives_up_after_max_attempts(tmp_path: Path):
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"x")

    def always_fail(_path, _business_date):
        raise ConnectionError("계속 끊김")

    queue = UploadQueue(
        always_fail,
        state_path=tmp_path / "state.json",
        max_attempts=2,
        sleep=lambda _: None,
    )
    queue.add(audio, date(2026, 3, 21))

    while queue.process_once():
        pass

    assert queue.failed_files == ["a.wav"]
    assert queue.pending_count == 0
    assert audio.exists()  # 원본은 지우지 않는다


def test_pending_uploads_survive_restart(tmp_path: Path):
    """앱이 꺼졌다 켜져도 못 올린 파일을 다시 찾는다."""
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"x")
    state = tmp_path / "state.json"

    first = UploadQueue(lambda *_: None, state_path=state, sleep=lambda _: None)
    first.add(audio, date(2026, 3, 21))  # 처리하지 않고 종료

    uploaded: list[str] = []
    second = UploadQueue(
        lambda path, _bd: uploaded.append(path.name), state_path=state, sleep=lambda _: None
    )
    assert second.pending_count == 1
    assert second.requeue_pending() == 1

    while second.process_once():
        pass

    assert uploaded == ["a.wav"]


def test_requeue_drops_files_that_no_longer_exist(tmp_path: Path):
    state = tmp_path / "state.json"
    missing = tmp_path / "gone.wav"
    missing.write_bytes(b"x")

    first = UploadQueue(lambda *_: None, state_path=state, sleep=lambda _: None)
    first.add(missing, date(2026, 3, 21))
    missing.unlink()

    second = UploadQueue(lambda *_: None, state_path=state, sleep=lambda _: None)
    second.requeue_pending()

    assert second.pending_count == 0


def test_corrupt_state_file_does_not_crash(tmp_path: Path):
    state = tmp_path / "state.json"
    state.write_text("{not json", encoding="utf-8")

    queue = UploadQueue(lambda *_: None, state_path=state, sleep=lambda _: None)

    assert queue.pending_count == 0


# ── 보조 ──────────────────────────────────────────────────────────────
def _wav_frames(path: Path) -> int:
    with wave.open(str(path), "rb") as handle:
        return handle.getnframes()


def _wav_seconds(path: Path) -> float:
    with wave.open(str(path), "rb") as handle:
        return handle.getnframes() / handle.getframerate()
