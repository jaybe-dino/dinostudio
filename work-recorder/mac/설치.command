#!/bin/bash
# 업무 녹음 자동화 — 설치 (Finder에서 더블클릭)
#
# 전용 가상환경을 만들고 패키지를 설치한 뒤 .env를 준비한다.
# 시스템 파이썬을 건드리지 않으므로 다른 도구와 충돌하지 않는다.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$HOME/.work-recorder/venv"
ENV_FILE="$PROJECT_DIR/.env"

cd "$PROJECT_DIR"

echo "══════════════════════════════════════════════"
echo "  업무 녹음 자동화 — 설치"
echo "══════════════════════════════════════════════"
echo "  설치 위치: $PROJECT_DIR"
echo ""

# ── 1. 파이썬 확인 (3.11 이상 필요) ─────────────────────────
PYTHON=""
for candidate in python3.13 python3.12 python3.11 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
        if "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
            PYTHON="$candidate"
            break
        fi
    fi
done

if [ -z "$PYTHON" ]; then
    echo "✗ Python 3.11 이상이 필요합니다."
    echo ""
    echo "  설치 방법 (둘 중 하나):"
    echo "    1) https://www.python.org/downloads/macos/ 에서 최신 버전 설치"
    echo "    2) Homebrew 사용:  brew install python@3.12"
    echo ""
    echo "  설치 후 이 파일을 다시 더블클릭하세요."
    read -r -p "  엔터를 누르면 창이 닫힙니다..."
    exit 1
fi
echo "✓ 파이썬: $("$PYTHON" --version) ($(command -v "$PYTHON"))"

# ── 2. 가상환경 ─────────────────────────────────────────────
if [ ! -d "$VENV_DIR" ]; then
    echo "  가상환경 생성 중… ($VENV_DIR)"
    "$PYTHON" -m venv "$VENV_DIR"
fi
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"
echo "✓ 가상환경 준비 완료"

# ── 3. 패키지 설치 ──────────────────────────────────────────
echo "  패키지 설치 중… (1~2분 걸릴 수 있습니다)"
python -m pip install --quiet --upgrade pip
python -m pip install --quiet -e ".[all]"
echo "✓ work-recorder 설치 완료"

# ── 4. 설정 파일 ────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
    cp "$PROJECT_DIR/.env.example" "$ENV_FILE"
    # API 토큰은 자동으로 안전한 값을 넣어 둔다.
    TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
    python - "$ENV_FILE" "$TOKEN" <<'PY'
import sys, pathlib
path, token = pathlib.Path(sys.argv[1]), sys.argv[2]
path.write_text(
    path.read_text(encoding="utf-8").replace("API_TOKEN=CHANGE_ME", f"API_TOKEN={token}"),
    encoding="utf-8",
)
PY
    chmod 600 "$ENV_FILE"
    echo "✓ .env 생성 (API_TOKEN 자동 생성됨)"
else
    echo "✓ .env 이미 있음 — 그대로 둡니다"
fi

mkdir -p "$HOME/업무녹음"

# ── 5. 점검 ─────────────────────────────────────────────────
echo ""
work-recorder --env-file "$ENV_FILE" doctor || true

echo ""
echo "══════════════════════════════════════════════"
echo "  설치 완료"
echo "══════════════════════════════════════════════"
echo ""
echo "  다음 단계:"
echo "   1. mac/설정 열기.command  → Google·Notion·Slack 키 입력"
echo "   2. mac/서버 시작.command  → 상시 실행"
echo "   3. mac/지금 정리.command  → 수동으로 오늘치 정리"
echo ""
echo "  키 없이 먼저 테스트해보려면 mac/테스트 실행.command 를 더블클릭하세요."
echo ""
read -r -p "  엔터를 누르면 창이 닫힙니다..."
