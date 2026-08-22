"""SQLite 상태 저장소.

기존 구현은 처리한 Drive 파일 ID만 `processed_files.json`에 쌓았기 때문에
동시 실행·재업로드·특정 날짜 재분석에 취약했다. 여기서는 파일별 처리 상태와
작업 이력, 발행 이력을 DB에 두고 다음을 보장한다.

* 같은 (source, source_file_id)는 한 번만 등록된다.
* 파일은 discovered → downloaded → transcribed 로 전이하며 실패는 재시도 카운트로 남는다.
* 같은 업무일을 다시 분석해도 Notion 페이지는 갱신되고 Slack은 내용이 바뀔 때만 나간다.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .business_date import as_utc

SCHEMA = """
CREATE TABLE IF NOT EXISTS recordings (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    source            TEXT NOT NULL,
    source_file_id    TEXT NOT NULL,
    file_name         TEXT NOT NULL,
    created_at        TEXT NOT NULL,
    business_date     TEXT NOT NULL,
    size_bytes        INTEGER,
    checksum          TEXT,
    web_link          TEXT,
    status            TEXT NOT NULL DEFAULT 'discovered',
    retry_count       INTEGER NOT NULL DEFAULT 0,
    error             TEXT,
    discovered_at     TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    UNIQUE (source, source_file_id)
);
CREATE INDEX IF NOT EXISTS idx_recordings_business_date
    ON recordings (business_date, created_at);

CREATE TABLE IF NOT EXISTS transcriptions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    recording_id  INTEGER NOT NULL UNIQUE REFERENCES recordings (id) ON DELETE CASCADE,
    text          TEXT NOT NULL,
    language      TEXT,
    duration_seconds REAL,
    model         TEXT,
    char_count    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_reports (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    business_date     TEXT NOT NULL UNIQUE,
    version           INTEGER NOT NULL DEFAULT 1,
    title             TEXT NOT NULL DEFAULT '',
    summary           TEXT NOT NULL DEFAULT '',
    payload           TEXT NOT NULL,
    recording_count   INTEGER NOT NULL DEFAULT 0,
    transcript_chars  INTEGER NOT NULL DEFAULT 0,
    content_hash      TEXT NOT NULL DEFAULT '',
    transcript_hash   TEXT NOT NULL DEFAULT '',
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS publications (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    business_date  TEXT NOT NULL,
    channel        TEXT NOT NULL,
    external_id    TEXT,
    url            TEXT,
    content_hash   TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    UNIQUE (business_date, channel)
);

CREATE TABLE IF NOT EXISTS jobs (
    id             TEXT PRIMARY KEY,
    trigger_type   TEXT NOT NULL,
    business_date  TEXT NOT NULL,
    source         TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'queued',
    requested_at   TEXT NOT NULL,
    started_at     TEXT,
    finished_at    TEXT,
    attempts       INTEGER NOT NULL DEFAULT 0,
    error          TEXT,
    result         TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status, requested_at);
"""

RECORDING_STATUS_DISCOVERED = "discovered"
RECORDING_STATUS_DOWNLOADED = "downloaded"
RECORDING_STATUS_TRANSCRIBED = "transcribed"
RECORDING_STATUS_FAILED = "failed"

JOB_QUEUED = "queued"
JOB_RUNNING = "running"
JOB_SUCCEEDED = "succeeded"
JOB_FAILED = "failed"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _iso(value: datetime) -> str:
    return as_utc(value).isoformat(timespec="seconds")


class Store:
    """스레드마다 별도 연결을 쓴다.

    API 서버(스레드 풀)와 워커 스레드가 같은 Store를 공유하기 때문이다. SQLite는
    WAL 모드에서 다중 연결 읽기를 허용하고, 쓰기 충돌은 busy_timeout이 흡수한다.
    """

    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self._connections: list[sqlite3.Connection] = []
        self._lock = threading.Lock()
        self._conn.executescript(SCHEMA)
        self._migrate()

    @property
    def _conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(
                str(self.path), isolation_level=None, timeout=30, check_same_thread=False
            )
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA busy_timeout=30000")
            self._local.conn = conn
            with self._lock:
                self._connections.append(conn)
        return conn

    def _migrate(self) -> None:
        """이전 버전 DB에 추가된 컬럼을 채운다."""
        existing = {
            row["name"]
            for row in self._conn.execute("PRAGMA table_info(daily_reports)")
        }
        if "transcript_hash" not in existing:
            self._conn.execute(
                "ALTER TABLE daily_reports ADD COLUMN transcript_hash TEXT NOT NULL DEFAULT ''"
            )

    def close(self) -> None:
        with self._lock:
            connections, self._connections = self._connections, []
        for conn in connections:
            try:
                conn.close()
            except sqlite3.Error:  # pragma: no cover - 이미 닫힌 연결
                pass
        self._local = threading.local()

    def __enter__(self) -> "Store":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            yield self._conn
        except BaseException:
            self._conn.execute("ROLLBACK")
            raise
        else:
            self._conn.execute("COMMIT")

    # ── recordings ────────────────────────────────────────────────────
    def upsert_recording(
        self,
        *,
        source: str,
        source_file_id: str,
        file_name: str,
        created_at: datetime,
        business_date: date,
        size_bytes: int | None = None,
        web_link: str | None = None,
    ) -> sqlite3.Row:
        """이미 있으면 메타데이터만 갱신하고 처리 상태는 건드리지 않는다."""
        now = _now()
        self._conn.execute(
            """
            INSERT INTO recordings
                (source, source_file_id, file_name, created_at, business_date,
                 size_bytes, web_link, status, discovered_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (source, source_file_id) DO UPDATE SET
                file_name = excluded.file_name,
                business_date = excluded.business_date,
                size_bytes = COALESCE(excluded.size_bytes, recordings.size_bytes),
                web_link = COALESCE(excluded.web_link, recordings.web_link),
                updated_at = excluded.updated_at
            """,
            (
                source,
                source_file_id,
                file_name,
                _iso(created_at),
                business_date.isoformat(),
                size_bytes,
                web_link,
                RECORDING_STATUS_DISCOVERED,
                now,
                now,
            ),
        )
        row = self._conn.execute(
            "SELECT * FROM recordings WHERE source = ? AND source_file_id = ?",
            (source, source_file_id),
        ).fetchone()
        assert row is not None
        return row

    def recordings_for_date(self, business_date: date) -> list[sqlite3.Row]:
        return list(
            self._conn.execute(
                "SELECT * FROM recordings WHERE business_date = ? ORDER BY created_at, id",
                (business_date.isoformat(),),
            )
        )

    def pending_recordings(self, business_date: date, max_retry: int) -> list[sqlite3.Row]:
        """아직 전사되지 않았고 재시도 여유가 남은 파일."""
        return list(
            self._conn.execute(
                """
                SELECT * FROM recordings
                 WHERE business_date = ?
                   AND status != ?
                   AND retry_count < ?
                 ORDER BY created_at, id
                """,
                (business_date.isoformat(), RECORDING_STATUS_TRANSCRIBED, max_retry),
            )
        )

    def mark_recording(
        self,
        recording_id: int,
        status: str,
        *,
        error: str | None = None,
        checksum: str | None = None,
        bump_retry: bool = False,
    ) -> None:
        self._conn.execute(
            """
            UPDATE recordings
               SET status = ?,
                   error = ?,
                   checksum = COALESCE(?, checksum),
                   retry_count = retry_count + ?,
                   updated_at = ?
             WHERE id = ?
            """,
            (status, error, checksum, 1 if bump_retry else 0, _now(), recording_id),
        )

    # ── transcriptions ────────────────────────────────────────────────
    def save_transcription(
        self,
        recording_id: int,
        *,
        text: str,
        language: str | None,
        duration_seconds: float | None,
        model: str | None,
    ) -> None:
        self._conn.execute(
            """
            INSERT INTO transcriptions
                (recording_id, text, language, duration_seconds, model, char_count, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (recording_id) DO UPDATE SET
                text = excluded.text,
                language = excluded.language,
                duration_seconds = excluded.duration_seconds,
                model = excluded.model,
                char_count = excluded.char_count,
                created_at = excluded.created_at
            """,
            (
                recording_id,
                text,
                language,
                duration_seconds,
                model,
                len(text),
                _now(),
            ),
        )

    def transcripts_for_date(self, business_date: date) -> list[sqlite3.Row]:
        return list(
            self._conn.execute(
                """
                SELECT r.file_name, r.created_at, r.web_link, t.text, t.char_count
                  FROM recordings r
                  JOIN transcriptions t ON t.recording_id = r.id
                 WHERE r.business_date = ?
                 ORDER BY r.created_at, r.id
                """,
                (business_date.isoformat(),),
            )
        )

    # ── daily reports ─────────────────────────────────────────────────
    def save_daily_report(
        self,
        business_date: date,
        *,
        title: str,
        summary: str,
        payload: dict[str, Any],
        recording_count: int,
        transcript_chars: int,
        content_hash: str,
        transcript_hash: str = "",
    ) -> sqlite3.Row:
        now = _now()
        self._conn.execute(
            """
            INSERT INTO daily_reports
                (business_date, version, title, summary, payload, recording_count,
                 transcript_chars, content_hash, transcript_hash, created_at, updated_at)
            VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (business_date) DO UPDATE SET
                -- 분석 결과가 실제로 달라졌을 때만 버전을 올린다.
                version = daily_reports.version
                    + (CASE WHEN daily_reports.content_hash = excluded.content_hash
                            THEN 0 ELSE 1 END),
                title = excluded.title,
                summary = excluded.summary,
                payload = excluded.payload,
                recording_count = excluded.recording_count,
                transcript_chars = excluded.transcript_chars,
                content_hash = excluded.content_hash,
                transcript_hash = excluded.transcript_hash,
                updated_at = excluded.updated_at
            """,
            (
                business_date.isoformat(),
                title,
                summary,
                json.dumps(payload, ensure_ascii=False),
                recording_count,
                transcript_chars,
                content_hash,
                transcript_hash,
                now,
                now,
            ),
        )
        row = self.daily_report(business_date)
        assert row is not None
        return row

    def daily_report(self, business_date: date) -> sqlite3.Row | None:
        return self._conn.execute(
            "SELECT * FROM daily_reports WHERE business_date = ?",
            (business_date.isoformat(),),
        ).fetchone()

    # ── publications ──────────────────────────────────────────────────
    def publication(self, business_date: date, channel: str) -> sqlite3.Row | None:
        return self._conn.execute(
            "SELECT * FROM publications WHERE business_date = ? AND channel = ?",
            (business_date.isoformat(), channel),
        ).fetchone()

    def record_publication(
        self,
        business_date: date,
        channel: str,
        *,
        external_id: str | None,
        url: str | None,
        content_hash: str,
    ) -> None:
        now = _now()
        self._conn.execute(
            """
            INSERT INTO publications
                (business_date, channel, external_id, url, content_hash, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (business_date, channel) DO UPDATE SET
                external_id = COALESCE(excluded.external_id, publications.external_id),
                url = COALESCE(excluded.url, publications.url),
                content_hash = excluded.content_hash,
                updated_at = excluded.updated_at
            """,
            (business_date.isoformat(), channel, external_id, url, content_hash, now, now),
        )

    # ── jobs ──────────────────────────────────────────────────────────
    def enqueue_job(
        self,
        *,
        trigger_type: str,
        business_date: date,
        source: str = "",
        job_id: str | None = None,
    ) -> sqlite3.Row:
        identifier = job_id or uuid.uuid4().hex
        self._conn.execute(
            """
            INSERT INTO jobs (id, trigger_type, business_date, source, status, requested_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                identifier,
                trigger_type,
                business_date.isoformat(),
                source,
                JOB_QUEUED,
                _now(),
            ),
        )
        row = self.job(identifier)
        assert row is not None
        return row

    def job(self, job_id: str) -> sqlite3.Row | None:
        return self._conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()

    def recent_jobs(self, limit: int = 20) -> list[sqlite3.Row]:
        return list(
            self._conn.execute(
                "SELECT * FROM jobs ORDER BY requested_at DESC, rowid DESC LIMIT ?",
                (limit,),
            )
        )

    def claim_job(self) -> sqlite3.Row | None:
        """대기 중인 작업 하나를 원자적으로 점유한다. 워커가 여러 개여도 안전하다."""
        with self.transaction() as conn:
            row = conn.execute(
                "SELECT id FROM jobs WHERE status = ? ORDER BY requested_at, rowid LIMIT 1",
                (JOB_QUEUED,),
            ).fetchone()
            if row is None:
                return None
            updated = conn.execute(
                """
                UPDATE jobs
                   SET status = ?, started_at = ?, attempts = attempts + 1
                 WHERE id = ? AND status = ?
                """,
                (JOB_RUNNING, _now(), row["id"], JOB_QUEUED),
            )
            if updated.rowcount == 0:
                return None
            return conn.execute("SELECT * FROM jobs WHERE id = ?", (row["id"],)).fetchone()

    def finish_job(
        self,
        job_id: str,
        *,
        status: str,
        result: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> None:
        self._conn.execute(
            """
            UPDATE jobs
               SET status = ?, finished_at = ?, result = ?, error = ?
             WHERE id = ?
            """,
            (
                status,
                _now(),
                json.dumps(result, ensure_ascii=False) if result is not None else None,
                error,
                job_id,
            ),
        )

    def has_active_job(self, business_date: date) -> sqlite3.Row | None:
        """같은 업무일에 대기/실행 중인 작업이 있으면 그 작업을 돌려준다."""
        return self._conn.execute(
            """
            SELECT * FROM jobs
             WHERE business_date = ? AND status IN (?, ?)
             ORDER BY requested_at LIMIT 1
            """,
            (business_date.isoformat(), JOB_QUEUED, JOB_RUNNING),
        ).fetchone()
