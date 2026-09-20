/**
 * 「해당일 잔액이 같이 보여야 한다」 (대표님 지시).
 *
 * 계산 종료 잔액은 판정 대기가 하나라도 있으면 null 이 된다 — 원칙 8 이고,
 * 그건 그대로 둔다. 문제는 **그 이유로 시트에 적힌 잔액까지 감췄던 것**이다.
 * 판정 대기가 47건이라 실제로는 모든 날이 「계산 불가」로만 보였다.
 *
 * 그래서 둘을 따로 들고 간다. 지어내지 않고, 적힌 것도 버리지 않는다.
 */
import { describe, expect, it } from "vitest";
import { buildCashflow, cashflowGap } from "../../shared/erp/cashflow.js";
import { SHEET_SEED } from "../../shared/erp/sheetSeed.js";
import type { DaySnapshot, Entry, Settlement } from "../../shared/erp/types.js";

const day = (date: string, close: number | null): DaySnapshot => ({
  date,
  open: null,
  inSum: 0,
  outSum: 0,
  close,
  note: null,
  isMigrated: false,
});

const entry = (over: Partial<Entry>): Entry =>
  ({
    code: "E-1",
    direction: "out",
    title: "건",
    amount: 1_000_000,
    cashDate: "2026-09-14",
    accrualDate: null,
    accountCode: null,
    nature: "미지정",
    buCode: null,
    projectId: null,
    partyId: null,
    status: "confirmed",
    priority: null,
    priorityOverride: null,
    undecidedReason: null,
    hasEvidence: true,
    noteRaw: null,
    source: "sheet",
    sourceRef: "s-1",
    paidAt: null,
    approvedBy: null,
    approvedAt: null,
    createdBy: "sheet",
    createdAt: "2026-09-14T00:00:00+09:00",
    ...over,
  }) as Entry;

describe("판정 대기가 있어도 그 날 잔액은 보인다", () => {
  const entries = [
    entry({ code: "E-1", cashDate: "2026-09-14" }),
    entry({
      code: "E-2",
      cashDate: "2026-09-14",
      amount: null,
      status: "undecided",
      undecidedReason: "금액 미정",
    }),
  ];
  const snapshots = [day("2026-09-14", 106_700_000)];

  it("계산 잔액은 여전히 세우지 않는다 — 원칙 8 은 그대로다", () => {
    const [block] = buildCashflow(entries, snapshots, "day");
    expect(block.close).toBeNull();
    expect(block.nullReason).toBe("undecided_carryover");
  });

  it("**시트에 적힌 잔액은 그대로 보여 준다**", () => {
    const [block] = buildCashflow(entries, snapshots, "day");
    expect(block.recordedClose).toBe(106_700_000);
    expect(block.recordedAsOf).toBe("2026-09-14");
  });

  it("계산이 서면 기록과의 차이를 낸다 — 그 차이가 남은 일의 크기다", () => {
    const clean = [
      entry({ code: "E-1", amount: 3_300_000, cashDate: "2026-09-14" }),
    ];
    const [block] = buildCashflow(
      clean,
      [{ ...day("2026-09-14", 106_700_000), open: 110_000_000 }],
      "day"
    );
    expect(block.close).toBe(106_700_000);
    expect(block.closeGap).toBe(0);
  });

  it("적힌 잔액이 없으면 없다고 한다 — 앞 날 것을 끌어오지 않는다", () => {
    const [, second] = buildCashflow(
      [
        entry({ code: "E-1", cashDate: "2026-09-14" }),
        entry({ code: "E-2", cashDate: "2026-09-15" }),
      ],
      [day("2026-09-14", 106_700_000)],
      "day"
    );
    expect(second.key).toBe("2026-09-15");
    expect(second.recordedClose).toBeNull();
  });
});

describe("월별에도 잔액이 붙는다", () => {
  it("기간 안 **마지막으로 적힌 날**의 잔액을 쓴다", () => {
    // 시트의 마지막 날(9/22)은 아직 종료 잔액이 안 적혀 있다. 그 날 것을
    // 그대로 쓰면 바로 전날 적혀 있는 잔액까지 함께 사라진다.
    const [month] = buildCashflow(
      [
        entry({ code: "E-1", cashDate: "2026-09-21" }),
        entry({ code: "E-2", cashDate: "2026-09-22" }),
      ],
      [day("2026-09-21", 162_167_880), day("2026-09-22", null)],
      "month"
    );
    expect(month.key).toBe("2026-09");
    expect(month.recordedClose).toBe(162_167_880);
    expect(month.recordedAsOf).toBe("2026-09-21");
  });
});

describe("빈 구간도 잔액을 말한다", () => {
  it("계산이 안 되면 적힌 값이라도 내놓는다", () => {
    const blocks = buildCashflow(
      [
        entry({
          code: "E-1",
          cashDate: "2026-09-01",
          amount: null,
          status: "undecided",
        }),
        entry({ code: "E-2", cashDate: "2026-09-30" }),
      ],
      [day("2026-09-01", 50_000_000), day("2026-09-30", 49_000_000)],
      "day"
    );
    const gap = cashflowGap(blocks[0], blocks[1])!;
    expect(gap.balance).toBeNull();
    expect(gap.recordedBalance).toBe(50_000_000);
  });
});

describe("실제 시트로 확인한다", () => {
  it("9/13 시트의 **모든 날**에 잔액이 선다 (마지막 날 제외)", () => {
    const days = buildCashflow(SHEET_SEED.entries, SHEET_SEED.snapshots, "day");
    // 판정 대기 47건 때문에 계산 잔액은 한 날도 서지 않는다 — 그래서 이 값이
    // 없으면 화면이 통째로 「계산 불가」만 보여 준다
    expect(days.every(d => d.close == null)).toBe(true);
    const withBalance = days.filter(d => d.recordedClose != null);
    expect(withBalance.length).toBe(days.length - 1);
    expect(withBalance[0].recordedClose).toBe(13_500_000);
    expect(withBalance.at(-1)!.recordedClose).toBe(162_167_880);
  });

  it("9월 잔액은 9/21 자 162,167,880 이다", () => {
    const [month] = buildCashflow(
      SHEET_SEED.entries,
      SHEET_SEED.snapshots,
      "month"
    );
    expect(month.recordedClose).toBe(162_167_880);
    expect(month.recordedAsOf).toBe("2026-09-21");
  });
});

describe("은행 대사 잔액 — 실제 확인된 것만으로 이은 잔액", () => {
  /*
   * 잔액이 네 가지가 됐다. 섞으면 아무 의미가 없으므로 각자 무엇인지 고정한다.
   *   시트 잔액   — 시트에 사람이 적어 둔 그 날 잔액 (기록)
   *   계산 잔액   — 승인된 건으로 이은 잔액 (판정 대기가 있으면 안 선다)
   *   대사 잔액   — **실제 입출금이 확인된 것만**으로 이은 잔액 (은행과 맞춰 본다)
   *   보유현금    — 기준값. 사람이 통장을 보고 적는다
   */
  const line = (over: Partial<Settlement>): Settlement => ({
    id: "s-1",
    entryId: "e-1",
    settledOn: "2026-09-14",
    amount: 1_000_000,
    bankAccount: null,
    bankRef: null,
    note: null,
    actor: "cfo@dinostudio.kr",
    at: "2026-09-14T10:00:00+09:00",
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    ...over,
  });

  const entries = [
    entry({
      id: "e-1",
      code: "E-1",
      cashDate: "2026-09-14",
      amount: 3_000_000,
    }),
    entry({
      id: "e-2",
      code: "E-2",
      cashDate: "2026-09-14",
      amount: 5_000_000,
      direction: "in",
    }),
  ];
  const snapshots = [{ ...day("2026-09-14", 106_700_000), open: 110_000_000 }];

  it("확인 줄이 없으면 대사 잔액은 **0 이 아니라 모름**이다", () => {
    const [block] = buildCashflow(entries, snapshots, "day");
    expect(block.settledClose).toBeNull();
    expect(block.settledIn).toBe(0);
    expect(block.settledOut).toBe(0);
  });

  it("확인된 것만 세어 잔액을 잇는다", () => {
    const [block] = buildCashflow(entries, snapshots, "day", [
      line({ id: "s-1", entryId: "e-1", amount: 3_000_000 }),
      line({ id: "s-2", entryId: "e-2", amount: 5_000_000 }),
    ]);
    expect(block.settledOut).toBe(3_000_000);
    expect(block.settledIn).toBe(5_000_000);
    expect(block.settledClose).toBe(110_000_000 - 3_000_000 + 5_000_000);
  });

  it("**확인 날짜에 붙인다 — 건의 예정일이 아니다**", () => {
    // 9/14 예정이던 돈이 9/18 에 나갔으면 통장이 줄어든 날은 9/18 이다.
    // 예정일로 세면 은행 잔액과 영영 안 맞는다.
    const blocks = buildCashflow(entries, snapshots, "day", [
      line({
        id: "s-1",
        entryId: "e-1",
        amount: 3_000_000,
        settledOn: "2026-09-18",
      }),
    ]);
    const d14 = blocks.find(b => b.key === "2026-09-14")!;
    const d18 = blocks.find(b => b.key === "2026-09-18")!;
    expect(d14.settledOut).toBe(0);
    expect(d18.settledOut).toBe(3_000_000);
  });

  it("무효 처리된 줄은 세지 않는다", () => {
    const [block] = buildCashflow(entries, snapshots, "day", [
      line({
        id: "s-1",
        entryId: "e-1",
        amount: 3_000_000,
        voidedAt: "2026-09-15T09:00:00+09:00",
        voidedBy: "cfo@dinostudio.kr",
        voidReason: "착오",
      }),
    ]);
    expect(block.settledOut).toBe(0);
  });

  it("월별에도 붙는다 — 마지막 날의 대사 잔액이 그 달의 잔액이다", () => {
    const [month] = buildCashflow(entries, snapshots, "month", [
      line({ id: "s-1", entryId: "e-1", amount: 3_000_000 }),
    ]);
    expect(month.key).toBe("2026-09");
    expect(month.settledOut).toBe(3_000_000);
    expect(month.settledClose).toBe(107_000_000);
  });

  it("**계산 잔액과 대사 잔액이 갈린다** — 승인만 하고 안 나간 돈이 그 차이다", () => {
    // 두 건 다 승인됐지만 지출만 실제로 나갔다.
    const [block] = buildCashflow(entries, snapshots, "day", [
      line({ id: "s-1", entryId: "e-1", amount: 3_000_000 }),
    ]);
    // 계산 잔액은 둘 다 반영한다 (승인 기준)
    expect(block.close).toBe(110_000_000 - 3_000_000 + 5_000_000);
    // 대사 잔액은 나간 것만 반영한다 — 5,000,000 은 아직 안 들어왔다
    expect(block.settledClose).toBe(107_000_000);
  });
});
