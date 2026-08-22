"""업무일(business date) 경계 계산.

기존 구현은 Google Drive의 UTC `createdTime`을 로컬 날짜와 그대로 비교해서
자정 전후 파일이 다른 날짜로 묶이는 문제가 있었다. 여기서는

1. 녹음 파일 이름이나 업로드 메타데이터에 담긴 업무일 힌트를 최우선으로 쓰고,
2. 힌트가 없을 때만 생성 시각을 설정된 시간대(기본 Asia/Seoul)로 변환해서 계산한다.

`cutoff_hour`를 두면 "새벽 N시 이전은 전날 업무"로 묶을 수 있다. 기본값 0은
자정 경계를 그대로 쓰는 기존 동작이다.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

# 업로드 파일 이름에 직접 박아 넣은 업무일: `bd=2026-03-21` 또는 `bd-20260321`
_EXPLICIT_RE = re.compile(r"bd[=_-](\d{4})-?(\d{2})-?(\d{2})")
# 기존 Mac 앱의 파일명: 업무녹음_20260321_060127_part001.wav
_COMPACT_RE = re.compile(r"(?<!\d)(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})(?!\d)")
# ISO 날짜가 들어간 일반적인 이름: recording-2026-03-21T06-01.m4a
_ISO_RE = re.compile(r"(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)")


def as_utc(value: datetime) -> datetime:
    """naive datetime은 UTC로 간주하고, aware datetime은 UTC로 변환한다."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def business_date_of(moment: datetime, tz: str = "Asia/Seoul", cutoff_hour: int = 0) -> date:
    """생성 시각으로부터 업무일을 계산한다."""
    if not 0 <= cutoff_hour <= 23:
        raise ValueError(f"cutoff_hour는 0~23이어야 합니다: {cutoff_hour}")
    local = as_utc(moment).astimezone(ZoneInfo(tz))
    if local.hour < cutoff_hour:
        local -= timedelta(days=1)
    return local.date()


def day_bounds(
    business_day: date, tz: str = "Asia/Seoul", cutoff_hour: int = 0
) -> tuple[datetime, datetime]:
    """업무일에 해당하는 [시작, 끝) UTC 구간을 돌려준다."""
    zone = ZoneInfo(tz)
    start_local = datetime(
        business_day.year, business_day.month, business_day.day, cutoff_hour, tzinfo=zone
    )
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def today(tz: str = "Asia/Seoul", cutoff_hour: int = 0, now: datetime | None = None) -> date:
    return business_date_of(now or datetime.now(timezone.utc), tz, cutoff_hour)


def yesterday(tz: str = "Asia/Seoul", cutoff_hour: int = 0, now: datetime | None = None) -> date:
    return today(tz, cutoff_hour, now) - timedelta(days=1)


def resolve_business_date(
    value: str | date | None,
    tz: str = "Asia/Seoul",
    cutoff_hour: int = 0,
    now: datetime | None = None,
) -> date:
    """`today` / `yesterday` / `YYYY-MM-DD` / date 를 업무일로 해석한다."""
    if value is None or value == "":
        return yesterday(tz, cutoff_hour, now)
    if isinstance(value, date):
        return value
    text = value.strip().lower()
    if text in ("today", "오늘"):
        return today(tz, cutoff_hour, now)
    if text in ("yesterday", "어제", "전날"):
        return yesterday(tz, cutoff_hour, now)
    try:
        return date.fromisoformat(text)
    except ValueError as exc:
        raise ValueError(f"업무일 형식이 잘못되었습니다: {value!r}") from exc


def hint_from_name(file_name: str, tz: str = "Asia/Seoul", cutoff_hour: int = 0) -> date | None:
    """파일 이름에서 업무일 힌트를 뽑는다. 없으면 None."""
    explicit = _EXPLICIT_RE.search(file_name)
    if explicit:
        try:
            return date(int(explicit.group(1)), int(explicit.group(2)), int(explicit.group(3)))
        except ValueError:
            return None

    compact = _COMPACT_RE.search(file_name)
    if compact:
        try:
            stamp = datetime(
                *(int(compact.group(i)) for i in range(1, 7)), tzinfo=ZoneInfo(tz)
            )
        except ValueError:
            return None
        # 파일명 시각은 이미 녹음 기기의 로컬 시각이므로 cutoff만 적용한다.
        return (stamp - timedelta(days=1)).date() if stamp.hour < cutoff_hour else stamp.date()

    iso = _ISO_RE.search(file_name)
    if iso:
        try:
            return date(int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))
        except ValueError:
            return None
    return None
