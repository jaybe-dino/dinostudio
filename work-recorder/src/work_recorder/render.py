"""분석 결과 렌더링.

Notion 본문(마크다운 유사 블록 소스), Slack 메시지, 콘솔 출력이 모두 이 모듈의
순수 함수를 쓴다. 네트워크 없이 포맷을 테스트할 수 있게 발행 어댑터와 분리했다.
포맷은 기존 구현의 출력 구조를 그대로 따르되, 신뢰도 표시를 덧붙였다.
"""

from __future__ import annotations

from .models import DailyReport, Todo

PRIORITY_EMOJI = {"높음": "🔴", "중간": "🟡", "낮음": "🟢"}


def todo_line(index: int, todo: Todo) -> str:
    assignee = f" ({todo.assignee})" if todo.assignee else ""
    deadline = f" (마감: {todo.deadline})" if todo.deadline and todo.deadline != "없음" else ""
    low = " ⚠️확인필요" if todo.confidence == "낮음" else ""
    return f"{index}. [{todo.priority}] {todo.task}{assignee}{deadline}{low}"


def notion_body(report: DailyReport) -> str:
    """Notion 페이지 본문 소스. 발행 어댑터가 블록으로 변환한다."""
    analysis = report.analysis
    parts: list[str] = ["## 오늘의 요약", analysis.executive_summary or "요약 없음"]

    if analysis.meetings:
        parts.append("## 회의 및 주요 대화")
        for meeting in analysis.meetings:
            parts.append(f"### {meeting.topic or '주제 미상'}")
            parts.append(meeting.summary)
            if meeting.time_hint:
                parts.append(f"_{meeting.time_hint}_")

    if analysis.todos:
        parts.append("## 할일 목록")
        for todo in analysis.todos:
            assignee = f" @{todo.assignee}" if todo.assignee else ""
            deadline = (
                f" (마감: {todo.deadline})" if todo.deadline and todo.deadline != "없음" else ""
            )
            parts.append(f"- [ ] [{todo.priority}] {todo.task}{assignee}{deadline}")
            if todo.source_excerpt:
                parts.append(f"  > 근거: {todo.source_excerpt}")

    if analysis.key_decisions:
        parts.append("## 주요 결정사항")
        parts.extend(f"- {item}" for item in analysis.key_decisions)

    if analysis.issues:
        parts.append("## 주의 필요 이슈")
        parts.extend(f"- {item}" for item in analysis.issues)

    if analysis.follow_ups:
        parts.append("## 후속 조치 필요")
        parts.extend(f"- {item}" for item in analysis.follow_ups)

    if analysis.participants:
        parts.append("## 참여자")
        parts.append(", ".join(analysis.participants))

    if analysis.quality_notes:
        parts.append("## 품질 경고")
        parts.extend(f"- {item}" for item in analysis.quality_notes)

    parts.append("## 원본 녹음 파일")
    if report.file_links:
        for name, link in zip(report.file_names, report.file_links):
            parts.append(f"- [{name}]({link})" if link else f"- {name}")
    else:
        parts.append(f"- 링크 없음 (파일 {report.recording_count}건)")

    parts.append(
        f"_녹음 {report.recording_count}건 · 전사 {report.transcript_chars:,}자 · "
        f"리포트 v{report.version}_"
    )
    return "\n".join(part for part in parts if part is not None)


def todos_property_text(report: DailyReport) -> str:
    lines = [todo_line(i, todo) for i, todo in enumerate(report.analysis.todos, 1)]
    return "\n".join(lines) if lines else "추출된 할일 없음"


def slack_message(report: DailyReport, *, updated: bool = False) -> str:
    analysis = report.analysis
    label = report.business_date.isoformat()
    header = f"📋 *{label} 업무 녹음 종합 정리*"
    if updated:
        header += f" _(v{report.version} 갱신)_"

    parts = [header, "", f"*오늘의 요약:*\n{analysis.executive_summary or '없음'}", ""]

    if analysis.todos:
        parts.append("*할일 목록:*")
        for index, todo in enumerate(analysis.todos, 1):
            emoji = PRIORITY_EMOJI.get(todo.priority, "⚪")
            assignee = f" ({todo.assignee})" if todo.assignee else ""
            deadline = (
                f" _마감: {todo.deadline}_" if todo.deadline and todo.deadline != "없음" else ""
            )
            low = " ⚠️" if todo.confidence == "낮음" else ""
            parts.append(f"  {emoji} {index}. {todo.task}{assignee}{deadline}{low}")
        parts.append("")

    if analysis.key_decisions:
        parts.append("*주요 결정사항:*")
        parts.extend(f"  • {item}" for item in analysis.key_decisions)
        parts.append("")

    if analysis.issues:
        parts.append("*⚠️ 주의 필요 이슈:*")
        parts.extend(f"  • {item}" for item in analysis.issues)
        parts.append("")

    if analysis.follow_ups:
        parts.append("*내일 후속 조치:*")
        parts.extend(f"  → {item}" for item in analysis.follow_ups)
        parts.append("")

    if analysis.participants:
        parts.append(f"*참여자:* {', '.join(analysis.participants)}")

    if analysis.quality_notes:
        parts.append(f"*품질 경고:* {' / '.join(analysis.quality_notes)}")

    parts.append(f"_녹음 {report.recording_count}건 · 전사 {report.transcript_chars:,}자_")
    return "\n".join(parts).strip()
