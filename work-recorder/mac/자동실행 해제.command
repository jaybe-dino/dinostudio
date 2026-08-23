#!/bin/bash
set -euo pipefail

PLIST="$HOME/Library/LaunchAgents/com.work-recorder.server.plist"

if [ -f "$PLIST" ]; then
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "✓ 자동 실행 해제 완료"
else
    echo "  등록된 자동 실행이 없습니다."
fi

read -r -p "  엔터를 누르면 창이 닫힙니다..."
