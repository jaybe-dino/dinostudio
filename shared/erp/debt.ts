/**
 * §9.4 부채 · 만기 알람
 *
 *   D-day = debt.maturity_date − today
 *   D-30 최초 통지 · 상환 재원 확인 요청     (대표 · 재무)
 *   D-14 재원 미확보 시 재협상 / 조달 게이트 (대표 · 재무)
 *   D-7  매일 · 13주 계획 반영 여부 확인      (대표)
 *   D-0 경과 → 연체 전환 · 부채 원장 상태 변경 (대표)
 *
 * maturity_date가 null이면 규칙은 존재하되 **발동 불가** 상태로 표시한다 (B2).
 */
import { daysBetween } from "./ar";
import type { Debt } from "./types";

export const ALARM_STEPS = [30, 14, 7, 0] as const;
export type AlarmStep = (typeof ALARM_STEPS)[number];

export interface DebtLine {
  debt: Debt;
  /** 만기까지 남은 일수. 음수는 연체 */
  dDay: number | null;
  /** 지금 울려야 할 알람. 만기 미확인이면 빈 배열 */
  firedAlarms: AlarmStep[];
  state: "정상" | "만기 임박" | "연체" | "만기 미확인";
}

export interface DebtReport {
  today: string;
  lines: DebtLine[];
  /** 건별 잔액이 분해된 것만 합산한다 */
  principalKnown: number;
  /** 건별 미분해 잔액 — setting에서 온 총액 */
  principalUndecomposed: number | null;
  total: number | null;
  shortTerm: number;
  monthlyInterest: number | null;
  maturityUnknown: number;
  /** 이자보상배율 — 영업이익이 없으면 계산 불가 */
  interestCoverage: null;
  interestCoverageNullReason: string;
  blockers: string[];
}

export function buildDebtReport(
  debts: Debt[],
  today: string,
  undecomposedLongTerm: number | null
): DebtReport {
  const lines: DebtLine[] = debts.map(debt => {
    if (!debt.maturityDate) {
      return { debt, dDay: null, firedAlarms: [], state: "만기 미확인" };
    }
    const dDay = daysBetween(today, debt.maturityDate);
    const firedAlarms = ALARM_STEPS.filter(step => dDay <= step);
    return {
      debt,
      dDay,
      firedAlarms,
      state: dDay < 0 ? "연체" : dDay <= 30 ? "만기 임박" : "정상",
    };
  });

  const principalKnown = debts.reduce((acc, d) => acc + (d.principal ?? 0), 0);
  const shortTerm = debts
    .filter(d => d.term === "단기")
    .reduce((acc, d) => acc + (d.principal ?? 0), 0);
  const interests = debts
    .map(d => d.monthlyInterest)
    .filter((v): v is number => v != null);

  const maturityUnknown = debts.filter(d => !d.maturityDate).length;
  const blockers: string[] = [];
  if (maturityUnknown > 0) {
    blockers.push(
      `만기 미확인 ${maturityUnknown}건 — 알람 4종이 등록돼 있어도 하나도 울리지 않습니다 (B2)`
    );
  }
  if (debts.some(d => d.principal == null)) {
    blockers.push(
      "건별 잔액이 분해되지 않은 차입이 있습니다 — 13주 계획의 상환 라인을 만들 수 없습니다"
    );
  }

  return {
    today,
    lines,
    principalKnown,
    principalUndecomposed: undecomposedLongTerm,
    total:
      undecomposedLongTerm == null
        ? null
        : principalKnown + undecomposedLongTerm,
    shortTerm,
    monthlyInterest:
      interests.length > 0 ? interests.reduce((a, b) => a + b, 0) : null,
    maturityUnknown,
    interestCoverage: null,
    interestCoverageNullReason:
      "영업이익이 산출되지 않아 계산할 수 없습니다 (귀속 미지정 · 마감된 월 0개)",
    blockers,
  };
}
