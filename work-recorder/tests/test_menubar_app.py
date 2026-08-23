"""메뉴바 앱 로직 — rumps/sounddevice를 스텁으로 대체해 맥 없이 검증한다.

UI 프레임워크 자체를 테스트하는 것이 아니라, 우리가 쓴 부분(메뉴 구성, 녹음
토글, 정리 요청과 상태 표시, 워커·스케줄러 기동, 종료 정리)이 실제로 이어지는지
확인한다. 맥에서만 확인 가능한 부분은 아이콘 렌더링뿐이다.
"""

from __future__ import annotations

import importlib
import sys
import types
from pathlib import Path

import pytest

from work_recorder.jobs import describe_job

MENUBAR_DIR = Path(__file__).resolve().parents[1] / "clients" / "mac"


# ── rumps 스텁 ────────────────────────────────────────────────────────
class StubMenuItem:
    def __init__(self, title="", callback=None):
        self.title = title
        self.callback = callback

    def set_callback(self, callback):
        self.callback = callback


class StubTimer:
    instances: list["StubTimer"] = []

    def __init__(self, callback, interval):
        self.callback = callback
        self.interval = interval
        self.started = False
        StubTimer.instances.append(self)

    def start(self):
        self.started = True


class StubApp:
    def __init__(self, name, quit_button=None):
        self.title = name
        self.quit_button = quit_button
        self.menu = []

    def run(self):  # pragma: no cover - 테스트에서는 부르지 않는다
        raise AssertionError("테스트에서 이벤트 루프를 돌리면 안 된다")


def make_rumps_stub():
    module = types.ModuleType("rumps")
    module.App = StubApp
    module.MenuItem = StubMenuItem
    module.Timer = StubTimer
    module.notifications = []
    module.alerts = []
    module.quit_called = []
    module.alert_response = 1

    def notification(title, subtitle, message):
        module.notifications.append((title, subtitle, message))

    def alert(title, message="", ok=None, cancel=None):
        module.alerts.append((title, message))
        return module.alert_response

    module.notification = notification
    module.alert = alert
    module.quit_application = lambda: module.quit_called.append(True)
    return module


@pytest.fixture
def menubar(monkeypatch, settings):
    """스텁을 심고 menubar_app 모듈을 새로 불러온다."""
    stub = make_rumps_stub()
    StubTimer.instances.clear()
    monkeypatch.setitem(sys.modules, "rumps", stub)
    monkeypatch.syspath_prepend(str(MENUBAR_DIR))
    sys.modules.pop("menubar_app", None)
    module = importlib.import_module("menubar_app")
    module.rumps = stub
    yield module, stub
    sys.modules.pop("menubar_app", None)


@pytest.fixture
def app(menubar, settings, tmp_path):
    module, stub = menubar
    settings.local_source_dir.mkdir(parents=True, exist_ok=True)
    instance = module.WorkRecorderApp(settings, tmp_path / ".env")
    yield instance, module, stub
    instance.scheduler.stop()
    instance.worker.stop()
    instance.uploads.stop()
    instance.store.close()


# ── 기동 ──────────────────────────────────────────────────────────────
def test_app_starts_idle_with_expected_menu(app):
    instance, module, _stub = app

    assert instance.title == module.IDLE_ICON
    assert instance.record_item.title == "● 녹음 시작"
    assert instance.status_item.title == "대기 중"

    titles = [item.title for item in instance.menu if item is not None]
    assert "오늘 녹음 정리하기" in titles
    assert "녹음 폴더 열기" in titles
    assert "설정 열기" in titles
    assert "점검하기" in titles
    assert "종료" in titles


def test_display_only_items_are_not_clickable(app):
    instance, _module, _stub = app
    # 상태 표시 줄을 눌러도 아무 일이 없어야 한다.
    assert instance.status_item.callback is None
    assert instance.job_item.callback is None
    assert instance.schedule_item.callback is None


def test_schedule_line_shows_configured_time(app):
    instance, _module, _stub = app
    assert "00:05" in instance.schedule_item.title
    assert "Asia/Seoul" in instance.schedule_item.title


def test_worker_and_scheduler_run_in_process(app):
    """별도 서버를 띄우지 않아도 정리가 돌아가야 한다."""
    instance, _module, _stub = app
    assert instance.worker is not None
    assert instance.scheduler is not None
    assert any(timer.started for timer in StubTimer.instances)


# ── 녹음 ──────────────────────────────────────────────────────────────
def test_recording_toggle_updates_icon_and_menu(app, monkeypatch):
    instance, module, _stub = app
    _install_fake_audio(monkeypatch, module)

    instance.toggle_recording()

    assert instance.session is not None
    assert instance.title == module.RECORDING_ICON
    assert instance.record_item.title == "■ 녹음 종료"
    assert "녹음 중" in instance.status_item.title

    instance.toggle_recording()

    assert instance.session is None
    assert instance.title == module.IDLE_ICON
    assert instance.record_item.title == "● 녹음 시작"


def test_recording_writes_files_into_the_watched_folder(app, monkeypatch, settings):
    """녹음 파일이 파이프라인이 읽는 폴더에 그대로 쌓여야 한다."""
    instance, module, _stub = app
    fake = _install_fake_audio(monkeypatch, module)

    instance.start_recording()
    fake.feed(b"\x01\x00" * 4410)  # 0.1초
    instance.stop_recording()

    files = sorted(settings.local_source_dir.glob("*.wav"))
    assert len(files) == 1
    assert files[0].name.startswith("업무녹음_")


def test_microphone_failure_shows_guidance(app, monkeypatch):
    instance, module, stub = app

    class Exploding:
        def RawInputStream(self, **_kwargs):
            raise OSError("Device unavailable")

        def query_devices(self, **_kwargs):
            return {"name": "없음"}

    monkeypatch.setitem(sys.modules, "sounddevice", Exploding())

    instance.start_recording()

    assert instance.session is None
    assert stub.alerts, "권한 안내 알림이 떠야 한다"
    assert "마이크" in stub.alerts[-1][0]


# ── 정리 요청 ─────────────────────────────────────────────────────────
def test_summarize_now_enqueues_a_job(app):
    instance, _module, _stub = app

    instance.summarize_now()

    jobs = instance.store.recent_jobs(5)
    assert len(jobs) == 1
    assert jobs[0]["trigger_type"] == "manual"
    assert jobs[0]["source"] == "mac_menubar"
    assert "접수됨" in instance.job_item.title


def test_repeated_clicks_do_not_pile_up_jobs(app):
    instance, _module, _stub = app

    instance.summarize_now()
    instance.summarize_now()
    instance.summarize_now()

    assert len(instance.store.recent_jobs(10)) == 1


def test_summarize_while_recording_asks_first(app, monkeypatch):
    instance, module, stub = app
    _install_fake_audio(monkeypatch, module)
    instance.start_recording()

    stub.alert_response = 0  # 취소
    instance.summarize_now()

    assert instance.session is not None  # 녹음이 계속된다
    assert instance.store.recent_jobs(5) == []

    stub.alert_response = 1  # 끝내고 정리
    instance.summarize_now()

    assert instance.session is None
    assert len(instance.store.recent_jobs(5)) == 1


# ── 상태 표시 ─────────────────────────────────────────────────────────
def test_upload_failure_surfaces_in_the_menubar(app):
    instance, module, _stub = app

    instance.uploads._failed.append("업무녹음_part001.wav")
    instance._refresh()

    assert instance.title == module.WARNING_ICON
    assert "업로드 실패" in instance.status_item.title


def test_describe_job_covers_each_state():
    assert describe_job({"status": "queued"}) == "접수됨 — 대기 중"
    assert describe_job({"status": "running"}) == "정리하는 중…"
    assert "마이크 없음" in describe_job({"status": "failed", "error": "마이크 없음"})
    assert describe_job(
        {"status": "succeeded", "result": {"transcribed": 2, "published": ["notion"], "analyzed": True}}
    ) == "정리 완료 — 녹음 2건 정리, notion"
    assert describe_job(
        {"status": "succeeded", "result": {"transcribed": 0, "published": [], "analyzed": False}}
    ) == "정리 완료 — 새 녹음 없음"


def test_quit_stops_everything(app, monkeypatch):
    instance, module, stub = app
    _install_fake_audio(monkeypatch, module)
    instance.start_recording()

    instance.quit_app()

    assert instance.session is None
    assert stub.quit_called == [True]


# ── 보조 ──────────────────────────────────────────────────────────────
class FakeAudio:
    """sounddevice.RawInputStream 대역. 콜백을 수동으로 호출할 수 있다."""

    def __init__(self):
        self.callback = None
        self.started = False
        self.closed = False

    def RawInputStream(self, *, callback, **_kwargs):  # noqa: N802 - 실제 API 이름
        self.callback = callback
        return self

    def query_devices(self, **_kwargs):
        return {"name": "테스트 마이크"}

    def start(self):
        self.started = True

    def stop(self):
        self.started = False

    def close(self):
        self.closed = True

    def feed(self, data: bytes) -> None:
        assert self.callback is not None
        self.callback(data, len(data) // 2, None, None)


def _install_fake_audio(monkeypatch, _module) -> FakeAudio:
    fake = FakeAudio()
    monkeypatch.setitem(sys.modules, "sounddevice", fake)
    return fake
