"""업무일 경계 — 기존 구현에서 가장 자주 틀렸던 부분."""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from work_recorder.business_date import (
    business_date_of,
    day_bounds,
    hint_from_name,
    resolve_business_date,
    today,
    yesterday,
)


def test_utc_evening_is_next_korean_day():
    """UTC 2026-03-20 15:30 == KST 2026-03-21 00:30 → 업무일은 21일."""
    moment = datetime(2026, 3, 20, 15, 30, tzinfo=timezone.utc)
    assert business_date_of(moment, "Asia/Seoul") == date(2026, 3, 21)


def test_just_before_korean_midnight_stays_previous_day():
    moment = datetime(2026, 3, 20, 14, 59, tzinfo=timezone.utc)  # KST 23:59
    assert business_date_of(moment, "Asia/Seoul") == date(2026, 3, 20)


def test_cutoff_hour_moves_late_night_work_to_previous_day():
    moment = datetime(2026, 3, 20, 18, 0, tzinfo=timezone.utc)  # KST 03:00 (21일)
    assert business_date_of(moment, "Asia/Seoul", cutoff_hour=0) == date(2026, 3, 21)
    assert business_date_of(moment, "Asia/Seoul", cutoff_hour=4) == date(2026, 3, 20)


def test_naive_datetime_is_treated_as_utc():
    assert business_date_of(datetime(2026, 3, 20, 15, 30), "Asia/Seoul") == date(2026, 3, 21)


def test_day_bounds_covers_exactly_24_hours():
    start, end = day_bounds(date(2026, 3, 21), "Asia/Seoul")
    assert start == datetime(2026, 3, 20, 15, 0, tzinfo=timezone.utc)
    assert end == datetime(2026, 3, 21, 15, 0, tzinfo=timezone.utc)
    assert (end - start).total_seconds() == 24 * 3600


def test_day_bounds_respects_cutoff():
    start, end = day_bounds(date(2026, 3, 21), "Asia/Seoul", cutoff_hour=4)
    assert start == datetime(2026, 3, 20, 19, 0, tzinfo=timezone.utc)
    assert end == datetime(2026, 3, 21, 19, 0, tzinfo=timezone.utc)


def test_boundary_moment_belongs_to_the_day_it_starts():
    start, end = day_bounds(date(2026, 3, 21), "Asia/Seoul")
    assert business_date_of(start, "Asia/Seoul") == date(2026, 3, 21)
    assert business_date_of(end, "Asia/Seoul") == date(2026, 3, 22)


@pytest.mark.parametrize(
    ("file_name", "expected"),
    [
        ("업무녹음_20260321_060127_part001.wav", date(2026, 3, 21)),
        ("업무녹음_20260321_010000_part001.wav", date(2026, 3, 21)),
        ("recording-2026-03-21T06-01.m4a", date(2026, 3, 21)),
        ("bd=2026-03-21_meeting.wav", date(2026, 3, 21)),
        ("bd-20260321_meeting.wav", date(2026, 3, 21)),
        ("random-name.wav", None),
        ("업무녹음_20261332_060127.wav", None),  # 잘못된 날짜
    ],
)
def test_hint_from_name(file_name: str, expected: date | None):
    assert hint_from_name(file_name, "Asia/Seoul") == expected


def test_hint_respects_cutoff_for_early_morning_recordings():
    # 파일명 시각이 새벽 1시. cutoff 4시면 전날 업무로 묶인다.
    name = "업무녹음_20260321_010000_part001.wav"
    assert hint_from_name(name, "Asia/Seoul", cutoff_hour=4) == date(2026, 3, 20)


def test_resolve_business_date_keywords():
    now = datetime(2026, 3, 21, 5, 0, tzinfo=timezone.utc)  # KST 14:00
    assert resolve_business_date("today", "Asia/Seoul", now=now) == date(2026, 3, 21)
    assert resolve_business_date("yesterday", "Asia/Seoul", now=now) == date(2026, 3, 20)
    assert resolve_business_date("2026-01-02", "Asia/Seoul", now=now) == date(2026, 1, 2)
    assert resolve_business_date(None, "Asia/Seoul", now=now) == date(2026, 3, 20)
    assert today("Asia/Seoul", now=now) == date(2026, 3, 21)
    assert yesterday("Asia/Seoul", now=now) == date(2026, 3, 20)


def test_resolve_business_date_rejects_garbage():
    with pytest.raises(ValueError):
        resolve_business_date("어제쯤", "Asia/Seoul")


def test_cutoff_hour_is_validated():
    with pytest.raises(ValueError):
        business_date_of(datetime.now(timezone.utc), "Asia/Seoul", cutoff_hour=24)
