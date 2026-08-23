#!/bin/bash
# 진짜 단일 실행 파일(.app이 아닌 CLI 바이너리)을 만든다.
#
#   bash mac/build-binary.sh
#
# 결과: dist/work-recorder — 파이썬이 없는 맥에서도 실행되는 단일 파일.
#
# 주의: Apple 개발자 서명을 하지 않으면 Gatekeeper가 실행을 막는다.
#   해제:  xattr -d com.apple.quarantine dist/work-recorder
#   또는 Finder에서 우클릭 → 열기
# 서명·공증을 하려면 Apple Developer 계정(연 $99)과 아래 절차가 필요하다:
#   codesign --force --options runtime --sign "Developer ID Application: 이름 (팀ID)" dist/work-recorder
#   xcrun notarytool submit ... --wait

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$HOME/.work-recorder/venv"

cd "$PROJECT_DIR"

if [ "$(uname)" != "Darwin" ]; then
    echo "✗ 이 스크립트는 맥에서 실행해야 합니다. (크로스 빌드 불가)"
    exit 1
fi

if [ ! -x "$VENV_DIR/bin/python" ]; then
    echo "✗ 먼저 mac/설치.command 를 실행하세요."
    exit 1
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"
python -m pip install --quiet --upgrade pyinstaller

cat > /tmp/work-recorder-entry.py <<'PY'
import sys
from work_recorder.cli import main

if __name__ == "__main__":
    sys.exit(main())
PY

pyinstaller \
    --onefile \
    --name work-recorder \
    --clean \
    --noconfirm \
    --collect-submodules work_recorder \
    --collect-all anthropic \
    --collect-all googleapiclient \
    --collect-all google_auth_oauthlib \
    /tmp/work-recorder-entry.py

echo ""
echo "✓ 빌드 완료: $PROJECT_DIR/dist/work-recorder"
echo ""
echo "  확인:"
echo "    ./dist/work-recorder --env-file .env doctor"
echo ""
echo "  다른 맥으로 옮겨서 쓸 때는 받는 쪽에서 한 번:"
echo "    xattr -d com.apple.quarantine work-recorder"
