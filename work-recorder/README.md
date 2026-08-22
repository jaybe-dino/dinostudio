# 업무 녹음 자동화 — 서버 파이프라인 (재구축)

Mac/iPhone에서 업로드된 업무 녹음을 **업무일 단위**로 수집·전사·분석해서 Notion과
Slack으로 정리하는 파이프라인이다. 이관 패키지(`work-recorder-handover`)의 기획·제약
문서를 기준으로 다시 만들었다.

기존 프로토타입 대비 달라진 핵심은 네 가지다.

| 문제 (KNOWN_ISSUES) | 재구축에서의 해결 |
|---|---|
| `지금 바로 정리하기`가 Drive 트리거 파일 방식이라 접수 시점이 불명확 | 인증된 HTTPS 작업 API가 즉시 `job_id`와 `queued` 상태를 돌려주고, 앱이 진행 상태를 폴링 |
| `processed_files.json` 기반 중복 방지 (동시 실행·재업로드에 취약) | SQLite에 파일별 처리 상태·발행 이력을 저장, 작업 큐는 원자적 점유 |
| Drive UTC `createdTime`과 KST 업무일 경계 불일치 | 업로드 메타데이터/파일명의 `business_date`를 우선 사용, 없으면 시간대 변환 + 조정 가능한 경계 시각 |
| STT·LLM 공급자가 코드에 고정 | 저장소·STT·분석·발행을 모두 어댑터로 분리, 설정으로 교체 |

## 설치

코어는 **표준 라이브러리만** 쓴다. 외부 서비스에 붙을 때만 해당 패키지를 설치한다.

```bash
cd work-recorder
pip install -e .                 # 코어만 (로컬 폴더 + mock STT/분석 + 콘솔 출력)
pip install -e ".[claude]"       # + Claude 분석
pip install -e ".[drive]"        # + Google Drive 수집
pip install -e ".[all]"          # 전부 + 테스트 도구
```

## 5분 만에 돌려보기 (키 없이)

```bash
cp .env.example .env
mkdir -p ~/업무녹음
# 아무 오디오 파일이나 넣거나, mock STT용 텍스트 사이드카를 만든다:
#   ~/업무녹음/업무녹음_20260321_060127_part001.wav
#   ~/업무녹음/업무녹음_20260321_060127_part001.txt   ← mock STT가 이 내용을 전사 결과로 쓴다

work-recorder doctor                       # 설정·연결 점검
work-recorder run-daily --date 2026-03-21  # 수집 → 전사 → 분석 → 콘솔 출력
work-recorder status --date 2026-03-21     # 파일별 상태와 발행 이력
```

기본 설정은 `SOURCE_ADAPTER=local`, `STT_ADAPTER=mock`, `ANALYZER_ADAPTER=mock`,
`PUBLISHERS=console`이다. 실제 연결값 없이 파이프라인 전체 흐름을 검증할 수 있다.

## 실제 운영 설정

`.env`에서 어댑터를 바꾸면 된다.

```dotenv
SOURCE_ADAPTER=google_drive
GOOGLE_DRIVE_RECORDINGS_FOLDER_ID=...        # 새 환경에서는 전용 폴더를 새로 만들 것
GOOGLE_OAUTH_CREDENTIALS_PATH=/secure/credentials.json
GOOGLE_OAUTH_TOKEN_PATH=/secure/token.json

STT_ADAPTER=openai_compatible                # OpenAI/Groq/로컬 whisper 서버 공용 규격
STT_BASE_URL=https://api.openai.com/v1
STT_API_KEY=...

ANALYZER_ADAPTER=claude
LLM_MODEL=claude-opus-5

PUBLISHERS=notion,slack
NOTION_TOKEN=...
NOTION_DATABASE_ID=...
SLACK_BOT_TOKEN=...
SLACK_CHANNEL_ID=...

API_TOKEN=<충분히 긴 랜덤 값>
```

Google 최초 인증은 한 번만:

```bash
work-recorder auth-google        # 브라우저 인증 후 token.json 저장 (권한 600)
```

전체 실행:

```bash
work-recorder serve --with-worker --with-scheduler
```

작업 API(수동 요청 접수), 워커(큐 처리), 스케줄러(매일 00:05 KST)가 한 프로세스에서
돈다. 역할을 나누고 싶으면 `serve` / `worker` / `scheduler`를 따로 띄운다.

## 구성

```
저장소(Drive/로컬) ──┐
                     ├─► 수집 ─► 전사(STT) ─► 하루치 병합 ─► 분석(LLM) ─► 발행(Notion/Slack)
Mac 앱 / 스케줄러 ───┘        └─ 파일별 상태·재시도 ─┘        └─ 멱등 발행 ─┘
        │                                    SQLite
        └─ POST /jobs/daily-summary ─► 작업 큐 ─► 워커
```

| 파일 | 책임 |
|---|---|
| `business_date.py` | 업무일 경계 계산, 파일명 힌트 파싱 |
| `store.py` | SQLite 상태 저장 (recordings / transcriptions / daily_reports / publications / jobs) |
| `pipeline.py` | 수집→전사→분석→발행 오케스트레이션, 재시도와 멱등성 |
| `jobs.py` | 작업 큐와 워커 |
| `api.py` | 작업 API (표준 라이브러리 HTTP 서버) |
| `scheduler.py` | KST 기준 정기 실행 |
| `adapters/` | Drive·로컬, STT, Claude, Notion·Slack 구현 |
| `render.py`, `prompts.py` | 출력 포맷과 프롬프트 (코드 배포 없이 조정 가능) |
| `clients/mac/` | 기존 Mac 앱 연결 방법과 API 클라이언트 |

### 파일 처리 상태

`discovered → downloaded → transcribed`, 실패는 `failed` + `retry_count`. 한 파일이
실패해도 나머지는 처리되고, `MAX_RETRY_COUNT`까지 다음 실행에서 자동 재시도한다.
횟수를 넘기면 더 시도하지 않고 `work-recorder status`에 실패 사유가 남는다.

### 멱등성

* 같은 `(저장소, 파일 ID)`는 한 번만 등록된다.
* 전사 내용이 지난번과 같으면 LLM을 다시 호출하지 않고 저장된 분석을 재사용한다.
* Notion은 같은 업무일이면 페이지를 새로 만들지 않고 갱신한다.
* Slack은 분석 내용이 실제로 바뀐 경우에만 다시 보낸다(같은 메시지를 수정).
* 강제로 다시 하려면 `--force`.

## 작업 API

```
POST /jobs/daily-summary   {"business_date": "today"|"yesterday"|"YYYY-MM-DD", "source": "mac_menubar"}
                           → 202 {"job_id": "...", "status": "queued", "created": true}
GET  /jobs/{job_id}        → 200 {"status": "queued|running|succeeded|failed", "result": {...}}
GET  /jobs?limit=20
GET  /reports/2026-03-21
GET  /healthz              (인증 불필요)
```

인증은 `Authorization: Bearer $API_TOKEN`. 기본 바인딩은 `127.0.0.1`이며, 외부에
노출한다면 앞단에 TLS 종단을 두는 것을 전제로 한다.

같은 업무일에 진행 중인 작업이 있으면 새로 만들지 않고 그 작업을 돌려준다
(`created: false`). 버튼 연타로 중복 처리되지 않는다.

## Mac 앱 연결

`clients/mac/README.md`를 보라. `지금 바로 정리하기`를 트리거 파일 대신 작업 API로
바꾸는 코드와, 업로드 시 `appProperties.business_date`를 기록하는 방법이 있다.

## 테스트

```bash
python -m pytest
```

이관 문서의 수용 기준을 테스트로 고정해 두었다.

| 기준 | 테스트 |
|---|---|
| 동일 업무일 재실행 시 Notion·Slack 중복 없음 | `test_rerun_is_idempotent`, `test_new_file_next_day_updates_existing_publication` |
| 자정 전후 파일의 올바른 업무일 분류 | `test_business_date.py`, `test_files_are_grouped_by_business_date_not_utc_date` |
| 실패 파일이 나머지를 막지 않고 재시도됨 | `test_failed_file_does_not_block_the_others`, `test_failed_file_is_retried_on_next_run` |
| 수동 요청의 즉시 접수와 상태 확인 | `test_manual_request_is_accepted_immediately`, `test_job_status_is_queryable` |
| 작업 중복 점유 없음 | `test_claim_job_is_atomic_across_threads` |
| 인증 없이 열리지 않음 | `test_authentication_is_required` |

## 보안

* `.env`, `credentials.json`, `token.json`은 `.gitignore`에 있다. 절대 커밋하지 않는다.
* 소스에 폴더 ID·토큰을 상수로 두지 않는다. 전부 환경 변수로 주입한다.
* `work-recorder doctor`가 `API_TOKEN` 미설정 등 위험한 구성을 경고한다.
* 원본 녹음은 자동으로 지우지 않는다. 보존 기간 정책은 운영에서 별도로 정한다.
* 녹음은 참석자 고지와 사내 정책·법령 준수를 전제로 사용한다.

## 이번 범위 밖

개발 계획의 3단계(Mac 클라이언트 재작성)와 P2 항목은 포함하지 않았다.

* 메뉴바 앱 자체(SwiftUI 전환, 스트리밍 기록, 청크 즉시 업로드, 권한 온보딩)
* 앱 번들 서명·자동 업데이트
* 웹 대시보드, 비용·관측성 대시보드
* 보존 기간이 지난 파일의 자동 정리 작업
