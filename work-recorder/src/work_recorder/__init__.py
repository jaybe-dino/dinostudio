"""업무 녹음 자동화 시스템 — 서버 파이프라인.

Mac/iPhone에서 업로드된 녹음 파일을 업무일(business date) 단위로 수집·전사·분석하고
Notion과 Slack으로 발행한다. 코어는 표준 라이브러리만 사용하며, 외부 서비스는
adapters 패키지의 어댑터에서만 지연 import 한다.
"""

__version__ = "0.1.0"
