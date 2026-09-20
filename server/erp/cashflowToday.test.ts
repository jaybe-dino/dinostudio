/**
 * 일별 현금흐름은 **오늘**을 맨 위에 둔다.
 *
 * 블록은 「움직임이 있는 날」에만 생기는데, 이 회사 시트에는 앞으로 나갈 돈이
 * 미리 적혀 있다. 그냥 최신순으로 늘어놓으면 맨 위가 오늘이 아니라 제일 먼
 * 예정일이 되고, **그 숫자를 오늘 잔액으로 읽게 된다.** 그것을 막는다.
 */
import { describe, expect, it } from "vitest";
import { anchorToday } from "../../shared/erp/cashflow.js";
import type { CashflowBlock } from "../../shared/erp/cashflow.js";

function block(key: string, close: number | null): CashflowBlock {
  return {
    unit: "day",
    key,
    open: close,
    inSum: 0,
    outSum: 0,
    close,
    recordedClose: null,
    settledClose: null,
    settledIn: 0,
    settledOut: 0,
    cardSpend: 0,
    cardEntries: [],
    internalTransfer: 0,
    transferEntries: [],
    recordedAsOf: null,
    closeGap: null,
    nullReason: null,
    undecided: [],
    outEntries: [],
    inEntries: [],
    pendingEntries: [],
    isMigrated: false,
  };
}

const TODAY = "2026-09-12";

describe("오늘이 맨 위에 온다", () => {
  it("오늘 움직임이 없어도 맨 위에 선다", () => {
    // 9/18 같은 예정일이 맨 위로 올라오면 안 된다
    const out = anchorToday(
      [block("2026-09-11", 135_970_000), block("2026-09-18", 141_987_880)],
      TODAY
    );
    expect(out[0].key).toBe(TODAY);
    expect(out[0].isToday).toBe(true);
  });

  it("오늘 블록이 없으면 직전 날의 잔액을 이어받는다", () => {
    const out = anchorToday(
      [block("2026-09-11", 135_970_000), block("2026-09-18", 141_987_880)],
      TODAY
    );
    expect(out[0].open).toBe(135_970_000);
    expect(out[0].close).toBe(135_970_000);
    expect(out[0].inSum).toBe(0);
    expect(out[0].outSum).toBe(0);
  });

  it("직전 잔액이 계산 불가면 오늘도 계산 불가다 — 만들어 내지 않는다", () => {
    const unknown = {
      ...block("2026-09-11", null),
      nullReason: "undecided_carryover",
    };
    const out = anchorToday([unknown], TODAY);
    expect(out[0].close).toBeNull();
    expect(out[0].nullReason).toBe("undecided_carryover");
  });

  it("오늘 블록이 이미 있으면 새로 만들지 않는다", () => {
    const out = anchorToday(
      [block("2026-09-11", 1), block(TODAY, 2), block("2026-09-18", 3)],
      TODAY
    );
    expect(out[0].key).toBe(TODAY);
    expect(out[0].close).toBe(2);
    expect(out.filter(b => b.key === TODAY)).toHaveLength(1);
  });

  it("나머지는 최신순이다", () => {
    const out = anchorToday(
      [block("2026-09-03", 1), block("2026-09-11", 2), block("2026-09-18", 3)],
      TODAY
    );
    expect(out.map(b => b.key)).toEqual([
      TODAY,
      "2026-09-18",
      "2026-09-11",
      "2026-09-03",
    ]);
  });
});

describe("지나간 실적과 앞으로 나갈 예정을 구분한다", () => {
  it("오늘보다 뒤는 예정으로 표시한다", () => {
    const out = anchorToday(
      [block("2026-09-11", 1), block("2026-09-18", 2)],
      TODAY
    );
    expect(out.find(b => b.key === "2026-09-18")?.isFuture).toBe(true);
    expect(out.find(b => b.key === "2026-09-11")?.isFuture).toBe(false);
  });

  it("오늘은 예정이 아니다", () => {
    const out = anchorToday([block(TODAY, 1)], TODAY);
    expect(out[0].isFuture).toBe(false);
    expect(out[0].isToday).toBe(true);
  });

  it("블록이 하나도 없어도 오늘은 선다", () => {
    const out = anchorToday([], TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe(TODAY);
    expect(out[0].close).toBeNull();
  });
});
