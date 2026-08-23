#!/bin/bash
# 키 없이 파이프라인 전체를 확인한다.
# 가짜 녹음 2건을 만들고 수집 → 전사(mock) → 분석(mock) → 콘솔 출력까지 돌린다.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$HOME/.work-recorder/venv"
DEMO_DIR="$HOME/.work-recorder/demo"

if [ ! -x "$VENV_DIR/bin/work-recorder" ]; then
    echo "✗ 아직 설치되지 않았습니다. mac/설치.command 를 먼저 더블클릭하세요."
    read -r -p "  엔터를 누르면 창이 닫힙니다..."
    exit 1
fi

rm -rf "$DEMO_DIR"
mkdir -p "$DEMO_DIR/recordings" "$DEMO_DIR/home"

cat > "$DEMO_DIR/.env" <<'ENVFILE'
TIMEZONE=Asia/Seoul
SOURCE_ADAPTER=local
STT_ADAPTER=mock
ANALYZER_ADAPTER=mock
PUBLISHERS=console
API_TOKEN=demo-token
ENVFILE
{
    echo "WORK_RECORDER_HOME=$DEMO_DIR/home"
    echo "LOCAL_SOURCE_DIR=$DEMO_DIR/recordings"
} >> "$DEMO_DIR/.env"

"$VENV_DIR/bin/python" - "$DEMO_DIR/recordings" <<'PY'
import sys, wave, pathlib

target = pathlib.Path(sys.argv[1])
samples = {
    "업무녹음_20260321_060127_part001": "오늘 신규 프로젝트 킥오프 회의를 했습니다. 견적서는 다음 주 월요일까지 준비하기로 했습니다.",
    "업무녹음_20260321_063127_part002": "디자인 리소스가 부족해서 3월 말 베타 오픈 일정이 빠듯하다는 이야기가 나왔습니다.",
}
for stem, text in samples.items():
    with wave.open(str(target / f"{stem}.wav"), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(8000)
        handle.writeframes(b"\x00\x00" * 8000)
    (target / f"{stem}.txt").write_text(text, encoding="utf-8")
print("가짜 녹음 2건 생성 완료")
PY

echo ""
echo "── 1회차 실행 ────────────────────────────────"
"$VENV_DIR/bin/work-recorder" --env-file "$DEMO_DIR/.env" --log-level WARNING \
    run-daily --date 2026-03-21

echo ""
echo "── 2회차 실행 (중복 방지 확인) ───────────────"
echo "   transcribed: 0, analyzed: false 로 나오면 정상입니다."
"$VENV_DIR/bin/work-recorder" --env-file "$DEMO_DIR/.env" --log-level WARNING \
    run-daily --date 2026-03-21

echo ""
echo "── 처리 현황 ─────────────────────────────────"
"$VENV_DIR/bin/work-recorder" --env-file "$DEMO_DIR/.env" status --date 2026-03-21

echo ""
echo "테스트 데이터는 $DEMO_DIR 에 있습니다. 지워도 됩니다."
read -r -p "  엔터를 누르면 창이 닫힙니다..."
