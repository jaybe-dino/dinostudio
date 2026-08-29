/**
 * §12 알림
 *
 * 알림이 많아지면 아무도 안 본다. 대표에게 가는 것은 하루 3건이 상한이고 시스템이 강제한다.
 * 도착지가 정해지지 않았으므로(B7) 알림함 적재를 기본으로 하고, 발송 실패도 알림함에는 남긴다 —
 * 도착지가 죽어 있어도 경보가 사라지면 안 된다.
 */
import type { ArReport } from "./ar";
import type { CashPosition } from "./cashPosition";
import type { DebtReport } from "./debt";
import type { Notification, NotificationRule } from "./types";

export const CEO_DAILY_CAP = 3;

/** §12 티어 표를 그대로 옮긴 규칙 마스터 */
export const NOTIFICATION_RULES: NotificationRule[] = [
  rule("R-T3-01", "가용자금 음수", "T3", ["대표"], "즉시", null),
  rule(
    "R-T3-02",
    "임계선 돌파",
    "T3",
    ["대표"],
    "즉시",
    "임계선이 번레이트 확정 후에 다시 세워집니다 (§9.6)"
  ),
  rule("R-T3-03", "부채 신규", "T3", ["대표"], "즉시", null),
  rule("R-T3-04", "승인한도 초과", "T3", ["대표"], "즉시", null),
  rule(
    "R-T3-05",
    "차입 만기 D-30",
    "T3",
    ["대표", "재무"],
    "즉시",
    "만기 미확인 5건 — 발동 불가 (B2)"
  ),
  rule(
    "R-T3-06",
    "차입 만기 D-14",
    "T3",
    ["대표", "재무"],
    "즉시",
    "만기 미확인 5건 — 발동 불가 (B2)"
  ),
  rule(
    "R-T3-07",
    "차입 만기 D-7",
    "T3",
    ["대표"],
    "즉시",
    "만기 미확인 5건 — 발동 불가 (B2)"
  ),
  rule("R-T2-01", "SLA 초과", "T2", ["사업부리더", "재무"], "09:00", null),
  rule(
    "R-T2-02",
    "예산 초과",
    "T2",
    ["사업부리더", "재무"],
    "09:00",
    "예산이 등록되지 않았습니다"
  ),
  rule("R-T2-03", "검수 대기 누적", "T2", ["재무"], "09:00", null),
  rule("R-T2-04", "회수 연체 7일", "T2", ["재무"], "09:00", null),
  rule(
    "R-T1-01",
    "KPI 요약 · 파이프라인 · 회수 현황",
    "T1",
    ["대표", "부대표", "재무"],
    "월 09:00",
    null
  ),
  rule("R-T0-01", "개별 승인 처리 결과", "T0", ["담당자"], "미발송", null),
];

function rule(
  id: string,
  trigger: string,
  tier: string,
  recipients: string[],
  channel: string,
  blockedReason: string | null
): NotificationRule {
  return {
    id,
    trigger,
    tier,
    recipients,
    channel,
    active: true,
    blockedReason,
  };
}

export interface NotificationInput {
  cashPosition: CashPosition;
  ar: ArReport;
  debt: DebtReport;
  today: string;
}

/**
 * 지금 이 원장 상태에서 실제로 울려야 할 알림을 만든다.
 * 도착지가 없으므로 전부 sentAt = null(알림함에만 적재)이다 (B7).
 */
export function evaluateNotifications(
  input: NotificationInput
): Notification[] {
  const out: Notification[] = [];
  const push = (
    ruleId: string,
    title: string,
    body: string,
    screen: string | null
  ) => {
    out.push({
      id: `${ruleId}-${out.length + 1}`,
      ruleId,
      title,
      body,
      screen,
      sentAt: null, // 도착지 미정 (B7) — 알림함에만 남는다
      readAt: null,
      createdAt: `${input.today}T09:00:00+09:00`,
    });
  };

  const p0 = input.cashPosition.tiers[0];
  if (p0.shortfall != null && p0.shortfall < 0) {
    push(
      "R-T3-01",
      "가용자금 음수 — P0까지 부족",
      `P0(기업 신용 직결)까지 막는 데 ${Math.abs(p0.shortfall).toLocaleString("ko-KR")}원이 모자랍니다. 회수 또는 조달 없이는 넘길 수 없습니다.`,
      "cash-position"
    );
  }

  for (const line of input.ar.overdue) {
    if ((line.dDay ?? 0) >= 7) {
      push(
        "R-T2-04",
        `회수 연체 ${line.dDay}일 — ${line.partyName}`,
        `${(line.entry.amount ?? 0).toLocaleString("ko-KR")}원 · 입금예정일 ${line.dueDate}. 회수 문제이므로 재무와 대표가 봅니다.`,
        "ar"
      );
    }
  }

  for (const line of input.debt.lines) {
    if (line.dDay == null) continue;
    for (const step of line.firedAlarms) {
      push(
        step === 0
          ? "R-T3-07"
          : step === 7
            ? "R-T3-07"
            : step === 14
              ? "R-T3-06"
              : "R-T3-05",
        `차입 만기 D-${step} — ${line.debt.creditor}`,
        `만기 ${line.debt.maturityDate}. 상환 재원 확인이 필요합니다.`,
        "debt"
      );
    }
  }

  return out;
}

/** 대표 수신은 하루 3건이 상한이고, 시스템이 강제한다 (§12) */
export function applyCeoCap(
  notifications: Notification[],
  rules: NotificationRule[]
): { delivered: Notification[]; capped: Notification[] } {
  const ceoRuleIds = new Set(
    rules.filter(r => r.recipients.includes("대표")).map(r => r.id)
  );
  const delivered: Notification[] = [];
  const capped: Notification[] = [];
  let ceoCount = 0;
  for (const notification of notifications) {
    if (ceoRuleIds.has(notification.ruleId)) {
      if (ceoCount >= CEO_DAILY_CAP) {
        capped.push(notification);
        continue;
      }
      ceoCount += 1;
    }
    delivered.push(notification);
  }
  return { delivered, capped };
}
