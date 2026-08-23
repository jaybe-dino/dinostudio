#!/bin/bash
# 작업 API + 워커 + 정기 실행(매일 00:05 KST)을 한 프로세스로 띄운다.
# 이 창을 닫으면 서버도 멈춘다. 로그인 시 자동 실행은 mac/자동실행 등록.command 참고.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$HOME/.work-recorder/venv"

if [ ! -x "$VENV_DIR/bin/work-recorder" ]; then
    echo "✗ 아직 설치되지 않았습니다. mac/설치.command 를 먼저 더블클릭하세요."
    read -r -p "  엔터를 누르면 창이 닫힙니다..."
    exit 1
fi

cd "$PROJECT_DIR"
echo "══════════════════════════════════════════════"
echo "  업무 녹음 자동화 서버"
echo "══════════════════════════════════════════════"
echo "  멈추려면 이 창에서 Control + C 를 누르세요."
echo ""

exec "$VENV_DIR/bin/work-recorder" --env-file "$PROJECT_DIR/.env" \
    serve --with-worker --with-scheduler
