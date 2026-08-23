#!/bin/bash
# 업무 녹음 자동화 — 한 번만 실행하는 설치 스크립트
#
#   터미널에 `bash ` 를 친 뒤 이 파일을 터미널 창으로 드래그하고 엔터.
#
# 하는 일:
#   1. macOS 격리 속성 제거 (인터넷에서 받은 파일이 실행되지 않는 원인)
#   2. 전용 가상환경에 설치 (시스템 파이썬은 건드리지 않음)
#   3. 설정 파일 생성 (API 토큰 자동 생성)
#   4. 바탕화면에 실행 아이콘 2개 생성 — 여기서 만든 파일이라 격리가 걸리지 않는다
#   5. 가짜 녹음으로 전체 흐름을 한 번 돌려서 눈으로 확인

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$HOME/.work-recorder/venv"
ENV_FILE="$PROJECT_DIR/.env"
DESKTOP="$HOME/Desktop"

echo ""
echo "  업무 녹음 자동화 설치"
echo "  ─────────────────────────────────────────"
echo "  위치: $PROJECT_DIR"
echo ""

# ── 1. 격리 속성 제거 ────────────────────────────────────────
if command -v xattr >/dev/null 2>&1; then
    xattr -cr "$PROJECT_DIR" 2>/dev/null || true
fi

# ── 2. 파이썬 ────────────────────────────────────────────────
PYTHON=""
for candidate in python3.13 python3.12 python3.11 python3; do
    if command -v "$candidate" >/dev/null 2>&1 &&
       "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
        PYTHON="$candidate"
        break
    fi
done

if [ -z "$PYTHON" ]; then
    echo "  ✗ Python 3.11 이상이 필요합니다."
    echo ""
    echo "    아래를 복사해서 터미널에 붙여넣어 설치한 뒤 다시 시도하세요:"
    echo ""
    echo "      /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\" && brew install python@3.12"
    echo ""
    echo "    또는 https://www.python.org/downloads/macos/ 에서 설치."
    exit 1
fi
echo "  ✓ 파이썬 $("$PYTHON" -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')"

# ── 3. 설치 ──────────────────────────────────────────────────
echo "  · 설치 중… (처음에는 1~2분 걸립니다)"
"$PYTHON" -m venv "$VENV_DIR" 2>/dev/null || true
"$VENV_DIR/bin/python" -m pip install --quiet --upgrade pip
if [ "$(uname)" = "Darwin" ]; then
    EXTRAS="[all,mac]"   # 메뉴바 앱(rumps)과 녹음(sounddevice) 포함
else
    EXTRAS="[all]"
fi
"$VENV_DIR/bin/python" -m pip install --quiet -e "$PROJECT_DIR$EXTRAS"
echo "  ✓ 설치 완료"

# ── 4. 설정 파일 ─────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
    cp "$PROJECT_DIR/.env.example" "$ENV_FILE"
    TOKEN="$("$VENV_DIR/bin/python" -c 'import secrets; print(secrets.token_urlsafe(32))')"
    "$VENV_DIR/bin/python" - "$ENV_FILE" "$TOKEN" <<'PY'
import pathlib, sys
path, token = pathlib.Path(sys.argv[1]), sys.argv[2]
path.write_text(
    path.read_text(encoding="utf-8").replace("API_TOKEN=CHANGE_ME", f"API_TOKEN={token}"),
    encoding="utf-8",
)
PY
    chmod 600 "$ENV_FILE"
    echo "  ✓ 설정 파일 생성"
else
    echo "  ✓ 설정 파일 이미 있음 (그대로 둡니다)"
fi

mkdir -p "$HOME/업무녹음"

# ── 5. 메뉴바 앱 만들기 ──────────────────────────────────────
# 이 컴퓨터에서 직접 만든 앱이라 Gatekeeper가 막지 않는다.
# LSUIElement=1 이라 Dock에는 안 뜨고 상단 상태바에만 아이콘이 생긴다.
APP_DIR="$HOME/Applications/업무녹음.app"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS"

cat > "$APP_DIR/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>            <string>업무녹음</string>
    <key>CFBundleDisplayName</key>     <string>업무녹음</string>
    <key>CFBundleIdentifier</key>      <string>kr.dinostudio.work-recorder</string>
    <key>CFBundleVersion</key>         <string>0.1.0</string>
    <key>CFBundleShortVersionString</key> <string>0.1.0</string>
    <key>CFBundleExecutable</key>      <string>run</string>
    <key>CFBundlePackageType</key>     <string>APPL</string>
    <key>LSUIElement</key>             <true/>
    <key>NSMicrophoneUsageDescription</key>
    <string>업무 회의와 메모를 녹음해 자동으로 정리하기 위해 마이크를 사용합니다.</string>
</dict>
</plist>
PLIST

cat > "$APP_DIR/Contents/MacOS/run" <<RUNNER
#!/bin/bash
export WORK_RECORDER_ENV_FILE="$ENV_FILE"
cd "$PROJECT_DIR"
exec "$VENV_DIR/bin/python" "$PROJECT_DIR/clients/mac/menubar_app.py"
RUNNER
chmod +x "$APP_DIR/Contents/MacOS/run"

echo "  ✓ 메뉴바 앱 생성 (~/Applications/업무녹음.app)"

# 로그인할 때 자동으로 뜨도록 등록 (시스템 설정 → 일반 → 로그인 항목에서 해제 가능)
if [ "$(uname)" = "Darwin" ]; then
    osascript -e "tell application \"System Events\" to delete every login item whose name is \"업무녹음\"" >/dev/null 2>&1 || true
    if osascript -e "tell application \"System Events\" to make login item at end with properties {path:\"$APP_DIR\", hidden:true}" >/dev/null 2>&1; then
        echo "  ✓ 로그인 시 자동 실행 등록"
    else
        echo "  ! 로그인 항목 등록은 건너뜁니다 (시스템 설정 → 일반 → 로그인 항목에서 직접 추가 가능)"
    fi
fi

# ── 6. 동작 확인 ─────────────────────────────────────────────
DEMO="$HOME/.work-recorder/demo"
rm -rf "$DEMO"
mkdir -p "$DEMO/recordings" "$DEMO/home"

{
    echo "TIMEZONE=Asia/Seoul"
    echo "SOURCE_ADAPTER=local"
    echo "STT_ADAPTER=mock"
    echo "ANALYZER_ADAPTER=mock"
    echo "PUBLISHERS=console"
    echo "API_TOKEN=demo"
    echo "WORK_RECORDER_HOME=$DEMO/home"
    echo "LOCAL_SOURCE_DIR=$DEMO/recordings"
} > "$DEMO/.env"

"$VENV_DIR/bin/python" - "$DEMO/recordings" <<'PY'
import pathlib, sys, wave

target = pathlib.Path(sys.argv[1])
stem = "업무녹음_20260321_060127_part001"
with wave.open(str(target / f"{stem}.wav"), "wb") as handle:
    handle.setnchannels(1)
    handle.setsampwidth(2)
    handle.setframerate(8000)
    handle.writeframes(b"\x00\x00" * 8000)
(target / f"{stem}.txt").write_text(
    "오늘 신규 프로젝트 킥오프 회의를 했습니다. 견적서는 다음 주 월요일까지 준비하기로 했습니다.",
    encoding="utf-8",
)
PY

echo ""
echo "  ─────────────────────────────────────────"
echo "  동작 확인 (가짜 녹음 1건)"
echo "  ─────────────────────────────────────────"
"$VENV_DIR/bin/work-recorder" --env-file "$DEMO/.env" --log-level ERROR \
    run-daily --date 2026-03-21 >/dev/null
"$VENV_DIR/bin/work-recorder" --env-file "$DEMO/.env" status --date 2026-03-21
rm -rf "$DEMO"

echo ""
echo "  ═════════════════════════════════════════"
echo "   설치 완료"
echo "  ═════════════════════════════════════════"
echo ""
echo "   ~/Applications 폴더의 '업무녹음' 앱을 실행하세요."
echo "   화면 맨 위 상태바에 🎙 아이콘이 생깁니다."
echo ""
echo "   아이콘을 누르면:"
echo "     ● 녹음 시작 / ■ 녹음 종료"
echo "     오늘 녹음 정리하기"
echo "     설정 열기 · 녹음 폴더 열기 · 점검하기"
echo ""
echo "   매일 $(grep -E '^DAILY_SUMMARY_TIME=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 || echo 00:05) 에 자동 정리도 앱이 켜져 있으면 함께 돕니다."
echo ""
