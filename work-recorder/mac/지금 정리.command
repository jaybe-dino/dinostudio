#!/bin/bash
# `지금 바로 정리하기` — 오늘 업무일을 즉시 정리 요청하고 진행 상태를 보여준다.
# 서버(서버 시작.command)가 떠 있어야 한다.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$HOME/.work-recorder/venv"

if [ ! -x "$VENV_DIR/bin/python" ]; then
    echo "✗ 아직 설치되지 않았습니다. mac/설치.command 를 먼저 더블클릭하세요."
    read -r -p "  엔터를 누르면 창이 닫힙니다..."
    exit 1
fi

cd "$PROJECT_DIR"

# .env의 API_BASE_URL / API_TOKEN을 읽어 클라이언트에 넘긴다.
set -a
# shellcheck disable=SC1091
[ -f .env ] && source .env
set +a

"$VENV_DIR/bin/python" clients/mac/process_now_client.py "${1:-today}" || {
    echo ""
    echo "  서버가 꺼져 있으면 mac/서버 시작.command 를 먼저 실행하세요."
}

echo ""
read -r -p "  엔터를 누르면 창이 닫힙니다..."
