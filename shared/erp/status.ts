/**
 * §7.2 상태 머신 · §7.3 상태별 지표 반영
 *
 * §7.3 표가 이 시스템의 모든 합계의 근거다. 어떤 화면도 이 표를 우회해서 집계하지 않는다.
 */
import type { EntryStatus } from "./types";

export interface StatusRule {
  /** 현금흐름 계 */
  cashflow: boolean;
  /** 손익 */
  pnl: boolean;
  /** 전표 */
  journal: "생성됨" | "없음" | "역분개" | "상계";
  /** 예약런웨이 — 승인 대기를 포함하는 유일한 지표 (§9.6) */
  reservedRunway: boolean;
  /** 화면 표시 라벨 */
  label: string;
}

export const STATUS_RULES: Record<EntryStatus, StatusRule> = {
  confirmed: {
    cashflow: true,
    pnl: true,
    journal: "생성됨",
    reservedRunway: true,
    label: "확정",
  },
  pending: {
    cashflow: false,
    pnl: false,
    journal: "없음",
    reservedRunway: true,
    label: "승인 대기",
  },
  undecided: {
    cashflow: false,
    pnl: false,
    journal: "없음",
    reservedRunway: false,
    label: "판정 대기",
  },
  held: {
    cashflow: false,
    pnl: false,
    journal: "없음",
    reservedRunway: false,
    label: "보류",
  },
  rejected: {
    cashflow: false,
    pnl: false,
    journal: "없음",
    reservedRunway: false,
    label: "반려",
  },
  superseded: {
    cashflow: false,
    pnl: false,
    journal: "역분개",
    reservedRunway: false,
    label: "대체됨",
  },
  cancelled: {
    cashflow: false,
    pnl: false,
    journal: "상계",
    reservedRunway: false,
    label: "취소",
  },
};

/** 현금흐름 계에 들어가는가 — 확정 + 금액 있음 (§7.3 · 원칙 8) */
export function countsInCashflow(
  status: EntryStatus,
  amount: number | null
): boolean {
  return STATUS_RULES[status].cashflow && amount != null;
}

/** §7.2 허용 전이 */
const TRANSITIONS: Record<EntryStatus, EntryStatus[]> = {
  undecided: ["pending", "held", "rejected"],
  pending: ["confirmed", "rejected", "held", "undecided"],
  held: ["pending", "rejected", "undecided"],
  rejected: ["pending"],
  confirmed: ["superseded", "cancelled"],
  superseded: [],
  cancelled: [],
};

export function canTransition(from: EntryStatus, to: EntryStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function statusLabel(status: EntryStatus): string {
  return STATUS_RULES[status].label;
}
