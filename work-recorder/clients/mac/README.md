# Mac 앱 연결 가이드

이번 재구축의 범위는 서버 파이프라인이다. Mac 메뉴바 앱(`work_recorder.py`)은
기존 소스를 그대로 쓰되, 아래 두 곳만 바꾸면 새 서버와 연결된다.

## 1. `지금 바로 정리하기` — 트리거 파일 → 작업 API

기존 코드는 Drive에 `_TRIGGER_PROCESS_*.json`을 올리고 별도 감지 작업을 기다렸다.
접수 여부를 사용자가 알 수 없다는 것이 알려진 문제였다. `process_now_client.py`를
앱 폴더에 복사하고 아래처럼 교체한다.

```python
from process_now_client import JobApiError, WorkRecorderClient

client = WorkRecorderClient()  # API_BASE_URL / API_TOKEN 환경 변수 사용

def process_now(self, _):
    try:
        job = client.request_daily_summary("today")
    except JobApiError as exc:
        rumps.alert("정리 요청 실패", str(exc))
        return

    self.status_item.title = f"접수됨 ({job['job_id'][:8]})"
    self._poll_job(job["job_id"])          # 아래 3번

def _poll_job(self, job_id):
    """2초 간격으로 상태를 확인해 메뉴바에 표시한다."""
    def loop():
        while True:
            try:
                job = client.job_status(job_id)
            except JobApiError as exc:
                self.status_item.title = f"상태 확인 실패: {exc}"
                return
            self.status_item.title = WorkRecorderClient.describe(job)
            if WorkRecorderClient.is_finished(job):
                return
            time.sleep(2)

    threading.Thread(target=loop, daemon=True).start()
```

기존의 `_trigger_processing`, `_upload_trigger_file`, `_wait_upload_and_process`와
`MANUS_TRIGGER_URL` 상수는 지운다. 서버 쪽 Drive 어댑터는 남아 있는 트리거 파일을
무시하므로, 이전에 올라간 파일이 있어도 분석에 섞이지 않는다.

## 2. 업로드할 때 업무일을 함께 기록

자정 전후 파일이 다른 날짜로 묶이는 문제를 근본적으로 없애려면, 녹음한 기기가
업무일을 직접 알려 주는 것이 가장 확실하다. Drive 업로드 메타데이터에
`appProperties.business_date`를 넣는다.

```python
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

BUSINESS_DAY_CUTOFF_HOUR = 0   # 서버 설정과 같은 값을 쓴다

def business_date_for(started_at: datetime) -> str:
    local = started_at.astimezone(ZoneInfo("Asia/Seoul"))
    if local.hour < BUSINESS_DAY_CUTOFF_HOUR:
        local -= timedelta(days=1)
    return local.date().isoformat()

file_metadata = {
    "name": chunk_path.name,
    "parents": [GOOGLE_DRIVE_FOLDER_ID],
    "appProperties": {
        "business_date": business_date_for(self.recording_started_at),
        "source": "mac_menubar",
    },
}
```

기준 시각은 **청크가 끝난 시각이 아니라 녹음 세션이 시작된 시각**을 쓴다. 자정을
넘겨 이어진 녹음이 두 날짜로 쪼개지지 않는다.

메타데이터를 넣지 못하는 경로(iPhone 음성 메모 등)라면 파일 이름에 업무일을 넣어도
된다. 서버는 `업무녹음_YYYYMMDD_HHMMSS_partNNN.wav`, `bd=YYYY-MM-DD`, ISO 날짜를
인식하고, 그것도 없으면 생성 시각을 KST로 변환해서 판단한다.

## 3. 서버 실행

Mac에서 로컬로 다 돌리는 구성:

```bash
work-recorder serve --with-worker --with-scheduler
```

앱보다 서버가 먼저 떠 있어야 한다. `launchd`로 로그인 시 자동 실행하려면
`deploy/com.work-recorder.server.plist.example`을 참고한다.

## 아직 손대지 않은 것

이번 범위 밖이라 기존 앱에 그대로 남아 있는 항목이다. 개발 계획의 3단계에서
다룰 내용이다.

| 항목 | 현재 상태 | 다음 작업 |
|---|---|---|
| 메뉴바 표시 | LaunchAgent 실행 시 아이콘이 안 보이는 경우가 있음 | SwiftUI `MenuBarExtra` 또는 서명된 `.app` 번들 |
| 장시간 메모리 | 청크 프레임을 메모리에 쌓은 뒤 파일 저장 | 디스크 스트리밍 기록 |
| 업로드 시점 | 세션 종료 후 일괄 업로드 | 청크 완료 즉시 업로드 + 재시도 큐 |
| 권한 온보딩 | 오류 메시지 중심 | 첫 실행 시 마이크·손쉬운 사용·입력 모니터링 점검 UI |
