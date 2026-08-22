"""분석 프롬프트.

개발 계획의 권고대로 프롬프트를 코드 로직에서 분리했다. 결과 포맷은 사용자
피드백에 따라 자주 바뀌므로, 여기와 `models.ANALYSIS_JSON_SCHEMA`만 고치면 된다.
`WORK_RECORDER_PROMPT_FILE` 환경 변수로 파일에서 덮어쓸 수도 있다.
"""

from __future__ import annotations

import os
from pathlib import Path

ANALYSIS_SYSTEM_PROMPT = """당신은 하루 종일 녹음된 업무 내용을 종합 분석하는 전문 비서입니다.
여러 파트로 나뉜 하루치 녹음 전사를 읽고 그날의 업무 맥락을 재구성하세요.

작성 규칙:
- 할 일(todos)은 구체적이고 실행 가능한 형태로 씁니다.
- 여러 회의·대화가 섞여 있으면 주제별로 분리합니다.
- 언급되지 않은 담당자·마감일을 추측해서 채우지 않습니다. 없으면 빈 문자열 또는 '없음'을 씁니다.
- 각 할 일에는 근거가 된 전사 원문 일부를 source_excerpt에 담아, 사용자가 원문과 대조할 수 있게 합니다.
- 전사 품질이 나쁜 구간(무음, 잡음, 문장 끊김)이 있으면 그 사실을 quality_notes에 남기고,
  해당 구간에서 뽑은 항목의 confidence를 낮춥니다.
- 확실하지 않은 내용을 단정적으로 요약하지 말고, 불확실하면 그렇게 적습니다."""


def load_system_prompt() -> str:
    override = os.environ.get("WORK_RECORDER_PROMPT_FILE")
    if override:
        path = Path(override).expanduser()
        if path.exists():
            return path.read_text(encoding="utf-8")
    return ANALYSIS_SYSTEM_PROMPT


def build_analysis_user_message(business_date_label: str, combined_transcript: str) -> str:
    return (
        f"다음은 {business_date_label} 업무일에 녹음된 전체 내용의 전사입니다. "
        "파트는 녹음 시각 순서대로 정렬되어 있습니다. 종합적으로 분석해 주세요.\n\n"
        f"{combined_transcript}"
    )


def build_combined_transcript(parts, max_chars: int) -> tuple[str, bool]:
    """파일별 전사를 하나로 합친다.

    각 파트에 파일명과 녹음 시각을 붙여 모델이 시간 순서를 알 수 있게 한다.
    한도를 넘으면 앞에서부터 파트 단위로 자르고, 잘렸다는 사실을 표시한다.
    """
    chunks: list[str] = []
    used = 0
    truncated = False

    for index, part in enumerate(parts, 1):
        header = f"\n\n--- 녹음 파트 {index} ({part.file_name}, {part.created_at:%Y-%m-%d %H:%M}) ---\n"
        block = header + part.text
        if used + len(block) > max_chars:
            remaining = max_chars - used - len(header)
            if remaining > 200:
                chunks.append(header + part.text[:remaining])
            truncated = True
            break
        chunks.append(block)
        used += len(block)

    combined = "".join(chunks).strip()
    if truncated:
        combined += (
            "\n\n...(길이 제한으로 이후 파트는 생략되었습니다. "
            "전체 원문은 Notion의 원본 텍스트와 녹음 파일 링크를 확인하세요.)"
        )
    return combined, truncated
