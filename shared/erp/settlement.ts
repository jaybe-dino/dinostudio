/**
 * 실제 입출금 확인의 계산 규칙.
 *
 * 화면도 서버도 여기 있는 함수만 쓴다. 「얼마나 남았나」를 두 군데서 따로
 * 계산하면 반드시 한쪽만 고치게 된다 — 이 저장소에서 이번 주에만 네 번 그랬다.
 */
import type { Entry, Settlement } from "./types.js";

/** 무효 처리된 줄은 어떤 합계에도 들어가지 않는다 */
export function isLive(settlement: Settlement): boolean {
  return settlement.voidedAt == null;
}

export function settledAmount(settlements: Settlement[]): number {
  let total = 0;
  for (const s of settlements) if (isLive(s)) total += s.amount;
  return total;
}

/** 마지막으로 움직인 날 — 건이 다 채워졌을 때 `entry.paidAt` 이 된다 */
export function lastSettledOn(settlements: Settlement[]): string | null {
  let last: string | null = null;
  for (const s of settlements) {
    if (!isLive(s)) continue;
    if (last == null || s.settledOn > last) last = s.settledOn;
  }
  return last;
}

export type SettlementState = "미확인" | "부분 확인" | "확인 완료";

export interface SettlementSummary {
  settled: number;
  /** 건 금액이 없으면 남은 금액도 알 수 없다 (원칙 8) */
  remaining: number | null;
  state: SettlementState;
  lastSettledOn: string | null;
  /** 살아 있는 줄 수 — 부분 지급이 몇 번에 나뉘었나 */
  lines: number;
}

export function summarize(
  entry: Pick<Entry, "amount">,
  settlements: Settlement[]
): SettlementSummary {
  const live = settlements.filter(isLive);
  const settled = settledAmount(live);
  const remaining = entry.amount == null ? null : entry.amount - settled;
  /*
   * 상태는 **금액이 아니라 남은 금액**으로 정한다. 건 금액을 모르면
   * 「확인 완료」라고 말할 수 없다 — 얼마를 채워야 끝인지 모르기 때문이다.
   */
  const state: SettlementState =
    settled === 0
      ? "미확인"
      : remaining != null && remaining <= 0
        ? "확인 완료"
        : "부분 확인";
  return {
    settled,
    remaining,
    state,
    lastSettledOn: lastSettledOn(live),
    lines: live.length,
  };
}

/** 확인을 더 받을 수 있는 상태인가 — 집행대기 목록의 판정 기준이다 */
export function isOpenForSettlement(
  entry: Pick<Entry, "amount">,
  settlements: Settlement[]
): boolean {
  return summarize(entry, settlements).state !== "확인 완료";
}
