/**
 * §7.2 상태 머신 · §7.3 상태별 지표 반영
 *
 * §7.3 표가 이 시스템의 모든 합계의 근거다. 어떤 화면도 이 표를 우회해서 집계하지 않는다.
 */
import type { EntryStatus } from "./types.js";

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

/* ── 판정 대기 사유 분류 ────────────────────────────────────────────────── */

/**
 * 판정 대기는 여러 이유로 생긴다. 사유 문장은 이미 남아 있지만, 목록에서
 * 「무엇이 없어서 막혔나」가 한눈에 안 보였다 — 대표가 8건을 보고 「금액은
 * 있는데 내용이 없는 건 뭐냐」고 물어야 하는 상태였다.
 *
 * 사람이 할 일이 다르므로 종류를 나눈다.
 *   내용 없음   — 무엇에 쓴 돈인지 모른다. 사람 기억이나 증빙이 필요하다
 *   금액 없음   — 얼마인지 모른다. 통장·카드 명세를 봐야 한다
 *   단위 불명   — 숫자는 있는데 만원인지 원인지 모른다. 확인만 하면 된다
 *   중복 의심   — 둘 다 있는데 같은 건이 두 번 들어왔을 수 있다
 *   방향 불명   — 들어온 돈인지 나간 돈인지 모른다
 */
export type UndecidedKind =
  | "내용 없음"
  | "금액 없음"
  | "단위 불명"
  | "중복 의심"
  | "방향 불명"
  | "기타";

export interface UndecidedClass {
  kind: UndecidedKind;
  /** 이 건을 풀려면 사람이 무엇을 해야 하는가 */
  todo: string;
}

/**
 * 판정 대기 사유를 분류한다.
 *
 * 제목·금액이 실제로 비었는지를 먼저 보고, 그 다음 사유 문장을 읽는다 —
 * 사유는 사람이 쓴 문장이라 표기가 흔들릴 수 있지만 빈 칸은 흔들리지 않는다.
 */
export function classifyUndecided(entry: {
  title?: string | null;
  amount?: number | null;
  undecidedReason?: string | null;
}): UndecidedClass {
  const reason = entry.undecidedReason ?? "";
  const noTitle = (entry.title ?? "").trim() === "";
  const noAmount = entry.amount == null;

  // 둘 다 비면 내용이 먼저다 — 무엇인지 모르면 금액을 물어볼 상대도 모른다
  if (noTitle)
    return {
      kind: "내용 없음",
      todo: "무엇에 쓴 돈인지 확인해 항목명을 넣습니다",
    };

  if (noAmount) {
    if (reason.includes("단위"))
      return {
        kind: "단위 불명",
        todo: "적요의 숫자가 원인지 만원인지 확인합니다",
      };
    return {
      kind: "금액 없음",
      todo: "통장·카드 명세에서 실제 금액을 확인합니다",
    };
  }

  if (reason.includes("중복"))
    return {
      kind: "중복 의심",
      todo: "같은 건이 두 번 들어왔는지 보고, 중복이면 취소합니다",
    };
  if (reason.includes("매출인지") || reason.includes("방향"))
    return {
      kind: "방향 불명",
      todo: "들어온 돈인지 나간 돈인지 확인합니다",
    };
  return { kind: "기타", todo: reason || "사유를 확인합니다" };
}
