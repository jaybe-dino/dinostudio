/**
 * 역할별 대기함 — 「지금 이 건은 **누가** 움직여야 하는가」.
 *
 * 승인 화면이 하나의 목록이면 각자 자기 일을 못 찾는다. 대표는 결재할 것만,
 * 재무는 채워 넣을 것만, 리더는 확인할 것만 보여야 한다.
 *
 * **판정 순서는 `approve()` 와 같다.** 승인은 금액 → 계정과목 → 증빙 →
 * 자기승인 → 한도 순으로 막히는데, 그 중 **맨 처음 막히는 관문**이 곧 대기
 * 사유다. 여기서 순서를 다르게 두면 화면은 「대표 결재 대기」라고 하는데
 * 실제로 누르면 「증빙이 없습니다」가 뜬다 — 규칙이 두 벌이 되는 전형적인
 * 사고다.
 */
import { rolesAllowedToApprove } from "./permissions.js";
import type { Entry, Role } from "./types.js";

/** 무엇에 막혀 있는가 — 승인 판정 순서 그대로다 */
export const WAIT_BLOCKERS = [
  "금액 미확정",
  "계정과목 없음",
  "증빙 없음",
  "결재 대기",
] as const;
export type WaitBlocker = (typeof WAIT_BLOCKERS)[number];

/**
 * 관문마다 **누가 풀 수 있는가**.
 *
 * 승인 한도(결재 대기)만 금액에 따라 달라지고, 나머지는 고정이다.
 *   · 금액 — 올린 사람이 확인해 채운다. 재무가 대신 채우기도 한다
 *   · 계정과목 — 계정 체계의 주인은 재무다 (§13.1 account RW)
 *   · 증빙 — 받은 사람이 올린다. 재무가 챙긴다
 */
const FIXED_OWNERS: Record<Exclude<WaitBlocker, "결재 대기">, Role[]> = {
  "금액 미확정": ["재무", "담당자"],
  "계정과목 없음": ["재무"],
  "증빙 없음": ["담당자", "재무"],
};

export interface WaitingItem {
  code: string;
  title: string;
  direction: Entry["direction"];
  amount: number | null;
  /** 적요 칸에서 읽은 후보 금액 — 확정은 아니다 */
  amountCandidate: number | null;
  cashDate: string | null;
  buCode: string | null;
  blocker: WaitBlocker;
  /** 이 건을 움직일 수 있는 역할 */
  waitingOn: Role[];
  /** 사람이 읽는 한 줄 */
  note: string;
  /**
   * 보는 사람이 이 건에 관여했는가 (D1).
   * 관여했으면 한도가 맞아도 본인은 승인할 수 없다.
   */
  selfBlocked: boolean;
}

/** 이 건이 지금 무엇에 막혀 있는가 — 없으면 대기 상태가 아니다 */
export function classifyWaiting(
  entry: Entry,
  options: {
    /** D2 쪼개기 방지 — 같은 주 같은 거래처 합계. 한도는 이 값으로 다시 본다 */
    weekTotal?: number | null;
    /** 보는 사람이 이 건에 관여했는가 */
    touchedByViewer?: boolean;
  } = {}
): WaitingItem | null {
  // 확정·취소된 건은 아무도 기다리지 않는다
  if (entry.status !== "pending" && entry.status !== "undecided") return null;

  const base = {
    code: entry.code,
    title: entry.title,
    direction: entry.direction,
    amount: entry.amount,
    amountCandidate: entry.amountCandidate ?? null,
    cashDate: entry.cashDate,
    buCode: entry.buCode ?? null,
    selfBlocked: options.touchedByViewer ?? false,
  };

  // ① 금액 — 정해지지 않으면 승인 자체가 불가능하다 (§10.3 amount_undecided)
  if (entry.amount == null) {
    return {
      ...base,
      blocker: "금액 미확정",
      waitingOn: FIXED_OWNERS["금액 미확정"],
      note:
        entry.amountCandidate != null
          ? `적요에 ${entry.amountCandidate.toLocaleString("ko-KR")}원이 적혀 있습니다 — 맞는지 확인해 금액칸에 넣어야 승인할 수 있습니다`
          : (entry.undecidedReason ??
            "금액을 확인해 넣어야 승인할 수 있습니다"),
    };
  }

  // ② 계정과목 — 없으면 전표가 만들어지지 않는다
  if (!entry.accountCode) {
    return {
      ...base,
      blocker: "계정과목 없음",
      waitingOn: FIXED_OWNERS["계정과목 없음"],
      note: "계정과목을 지정해야 전표가 생성됩니다",
    };
  }

  // ③ 증빙 — 없으면 보류까지만 가능하다
  if (!entry.hasEvidence) {
    return {
      ...base,
      blocker: "증빙 없음",
      waitingOn: FIXED_OWNERS["증빙 없음"],
      note: "증빙을 올려야 확정됩니다 — 받는 시점에 올리는 것이 원칙입니다",
    };
  }

  // ④ 한도 — 쪼개기를 감안한 금액으로 본다 (D2)
  const forLimit = Math.max(entry.amount, options.weekTotal ?? 0);
  const allowed = rolesAllowedToApprove(forLimit);
  const split = (options.weekTotal ?? 0) > entry.amount;
  return {
    ...base,
    blocker: "결재 대기",
    waitingOn: allowed,
    note: split
      ? `같은 주 같은 거래처 합계 ${forLimit.toLocaleString("ko-KR")}원 기준으로 ${allowed.join(" · ")} 결재가 필요합니다`
      : `${allowed.join(" · ")} 결재가 필요합니다`,
  };
}

export interface RoleQueue {
  role: Role;
  items: WaitingItem[];
  /** 금액이 정해진 건의 합계. 미확정이 섞여 있으면 그 건은 빠진다 */
  amountSum: number;
  /** 금액을 모르는 건 수 — 합계에 들어가지 못한 것 */
  unknownAmount: number;
}

/** 역할별로 나눈 대기함. 한 건이 여러 역할에 동시에 걸릴 수 있다 */
export function buildRoleQueues(
  items: WaitingItem[],
  roles: Role[]
): RoleQueue[] {
  return roles.map(role => {
    const mine = items.filter(item => item.waitingOn.includes(role));
    const known = mine.filter(item => item.amount != null);
    return {
      role,
      items: mine,
      amountSum: known.reduce((sum, item) => sum + (item.amount ?? 0), 0),
      unknownAmount: mine.length - known.length,
    };
  });
}

/** 막힌 관문별 건수 — 「무엇 때문에 멈춰 있나」를 한눈에 */
export function blockerSummary(items: WaitingItem[]) {
  return WAIT_BLOCKERS.map(blocker => ({
    blocker,
    n: items.filter(item => item.blocker === blocker).length,
  }));
}
