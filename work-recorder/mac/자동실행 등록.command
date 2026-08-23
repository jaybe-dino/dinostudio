#!/bin/bash
# 로그인할 때 서버가 자동으로 뜨도록 LaunchAgent를 등록한다.
# 해제하려면 mac/자동실행 해제.command 를 실행한다.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$HOME/.work-recorder/venv"
PLIST="$HOME/Library/LaunchAgents/com.work-recorder.server.plist"
LOG_DIR="$HOME/.work-recorder"

if [ ! -x "$VENV_DIR/bin/work-recorder" ]; then
    echo "✗ 아직 설치되지 않았습니다. mac/설치.command 를 먼저 더블클릭하세요."
    read -r -p "  엔터를 누르면 창이 닫힙니다..."
    exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.work-recorder.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>$VENV_DIR/bin/work-recorder</string>
        <string>--env-file</string>
        <string>$PROJECT_DIR/.env</string>
        <string>serve</string>
        <string>--with-worker</string>
        <string>--with-scheduler</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$PROJECT_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/server.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/server.error.log</string>
    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
PLISTEOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "✓ 자동 실행 등록 완료"
echo "  로그: $LOG_DIR/server.log"
echo "  이제 로그인할 때마다 서버가 자동으로 뜹니다."
echo ""
sleep 2
if curl -sf "http://127.0.0.1:8787/healthz" >/dev/null 2>&1; then
    echo "✓ 서버 응답 확인"
else
    echo "! 아직 응답이 없습니다. 몇 초 뒤 로그를 확인하세요:"
    echo "    tail -f $LOG_DIR/server.error.log"
fi

read -r -p "  엔터를 누르면 창이 닫힙니다..."
