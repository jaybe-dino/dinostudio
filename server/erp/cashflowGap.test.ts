/**
 * 일별 보기의 빈 구간 — 「왜 9월 1일 다음이 9월 30일인가」
 *
 * 움직임이 없는 날은 줄을 만들지 않는다. 그것 자체는 맞지만, 설명이 없으면
 * 잔액이 튄 것처럼 읽힌다. 빈 구간을 한 줄로 알려 주는 것을 고정한다.
 */
import { describe, expect, it } from "vitest";
import { cashflowGap } from "../../shared/erp/index.js";
import type { CashflowBlock } from "../../shared/erp/index.js";

function block(key: string, close: number | null): CashflowBlock {
  return {
    unit: "day",
    key,
    open: close,
    inSum: 0,
    outSum: 0,
    close,
    nullReason: null,
    undecided: [],
    outEntries: [],
    inEntries: [],
    pendingEntries: [],
    isMigrated: false,
  };
}

describe("빈 구간 표시", () => {
  it("9월 1일 → 9월 30일 사이 28일을 찾아낸다", () => {
    const gap = cashflowGap(
      block("2026-09-01", 50_000_000),
      block("2026-09-30", 50_000_000)
    );
    expect(gap).toEqual({
      from: "2026-09-02",
      to: "2026-09-29",
      days: 28,
      balance: 50_000_000,
    });
  });

  it("이어지는 날 사이에는 빈 구간이 없다", () => {
    expect(
      cashflowGap(block("2026-09-01", 100), block("2026-09-02", 100))
    ).toBeNull();
  });

  it("같은 날이면 빈 구간이 아니다", () => {
    expect(
      cashflowGap(block("2026-09-01", 100), block("2026-09-01", 100))
    ).toBeNull();
  });

  it("월을 넘는 구간도 일수를 정확히 센다", () => {
    const gap = cashflowGap(block("2026-08-31", 10), block("2026-10-01", 10));
    expect(gap?.days).toBe(30);
    expect(gap?.from).toBe("2026-09-01");
    expect(gap?.to).toBe("2026-09-30");
  });

  it("앞 블록의 잔액이 확정되지 않았으면 잔액을 말하지 않는다", () => {
    // 판정 대기가 남은 날부터는 종료 잔액이 null 이다 (원칙 8)
    const gap = cashflowGap(
      block("2026-09-01", null),
      block("2026-09-10", null)
    );
    expect(gap?.balance).toBeNull();
  });

  it("월별 블록에는 적용하지 않는다 — 단위 자체가 구간이다", () => {
    const monthly = { ...block("2026-09", 100), unit: "month" as const };
    const next = { ...block("2026-11", 100), unit: "month" as const };
    expect(cashflowGap(monthly, next)).toBeNull();
  });
});
