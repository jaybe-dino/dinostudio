/**
 * 같은 돈이 두 번 빠지는 두 가지 — **카드**와 **내부 계좌이체**.
 *
 * 둘 다 원장에는 줄이 서는데 그 날 통장은 움직이지 않는다. 그냥 두면
 * 현금흐름이 실제와 어긋나고, 그 어긋남은 잔액을 맞춰 보기 전에는 안 보인다.
 */
import { describe, expect, it } from "vitest";
import { buildCashflow, buildPnl } from "../../shared/erp/index.js";
import { LedgerService } from "./service.js";
import { InMemoryLedgerStore } from "./store.js";
import type { Actor } from "./service.js";
import type { DaySnapshot, Entry } from "../../shared/erp/types.js";

const CEO: Actor = { id: "ceo@dinostudio.kr", role: "대표" };
const CFO: Actor = { id: "cfo@dinostudio.kr", role: "재무" };
const STAFF: Actor = { id: "staff@dinostudio.kr", role: "담당자" };

const day = (date: string, open: number): DaySnapshot => ({
  date,
  open,
  inSum: 0,
  outSum: 0,
  close: null,
  note: null,
  isMigrated: false,
});

const entry = (over: Partial<Entry>): Entry =>
  ({
    id: "e",
    code: "E",
    parentCode: null,
    direction: "out",
    status: "confirmed",
    title: "건",
    noteRaw: null,
    note: null,
    amount: 1_000_000,
    amountCandidate: null,
    amountSupply: null,
    amountVat: null,
    currency: "KRW",
    cashDate: "2026-09-14",
    accrualDate: "2026-09-14",
    startDate: null,
    deliverDate: null,
    requestDate: null,
    dueDate: null,
    paidAt: null,
    accountCode: "5210",
    nature: "직접원가",
    buCode: null,
    projectId: null,
    partyId: null,
    contractId: null,
    internalTransferId: null,
    priority: null,
    priorityOverride: null,
    priorityReason: null,
    payMethod: "계좌",
    bankAccount: null,
    invoiceIssued: null,
    invoiceNo: null,
    invoiceDate: null,
    source: "manual",
    sourceRef: null,
    roundNo: null,
    linkedRevenueCode: null,
    undecidedReason: null,
    hasEvidence: true,
    isPersonal: false,
    version: 1,
    createdBy: "x",
    createdAt: "2026-09-14T00:00:00+09:00",
    ...over,
  }) as Entry;

describe("법인카드 — 긁은 날 통장은 안 움직인다", () => {
  const snapshots = [day("2026-09-14", 100_000_000)];

  it("카드 사용은 그 날 지출계에 들어가지 않는다", () => {
    const [block] = buildCashflow(
      [entry({ id: "e1", code: "E1", payMethod: "법인카드" })],
      snapshots,
      "day"
    );
    expect(block.outSum).toBe(0);
    expect(block.close).toBe(100_000_000);
  });

  it("**빼되 숨기지 않는다** — 카드 사용액이 따로 실려 온다", () => {
    const [block] = buildCashflow(
      [entry({ id: "e1", code: "E1", payMethod: "법인카드" })],
      snapshots,
      "day"
    );
    expect(block.cardSpend).toBe(1_000_000);
    expect(block.cardEntries.map(e => e.code)).toEqual(["E1"]);
  });

  it("카드대금 결제 건은 계좌 지급이므로 **그때 한 번** 빠진다", () => {
    const blocks = buildCashflow(
      [
        entry({ id: "e1", code: "E1", payMethod: "법인카드" }),
        entry({
          id: "e2",
          code: "E2",
          payMethod: "계좌",
          title: "카드대금 결제",
          accountCode: "2120",
          cashDate: "2026-09-25",
          accrualDate: "2026-09-25",
        }),
      ],
      [day("2026-09-14", 100_000_000)],
      "day"
    );
    const d14 = blocks.find(b => b.key === "2026-09-14")!;
    const d25 = blocks.find(b => b.key === "2026-09-25")!;
    expect(d14.outSum).toBe(0);
    expect(d25.outSum).toBe(1_000_000);
    // 두 번이 아니라 한 번만 빠졌다
    expect(d25.close).toBe(99_000_000);
  });

  it("개인카드선결제도 같다", () => {
    const [block] = buildCashflow(
      [entry({ id: "e1", code: "E1", payMethod: "개인카드선결제" })],
      snapshots,
      "day"
    );
    expect(block.outSum).toBe(0);
    expect(block.cardSpend).toBe(1_000_000);
  });

  it("카드로 **들어온 돈**은 해당 없다 — 지출에만 걸리는 규칙이다", () => {
    const [block] = buildCashflow(
      [
        entry({
          id: "e1",
          code: "E1",
          direction: "in",
          payMethod: "법인카드",
          accountCode: "4110",
        }),
      ],
      snapshots,
      "day"
    );
    expect(block.inSum).toBe(1_000_000);
  });
});

describe("내부 계좌이체 — 우리 계좌끼리 옮긴 것이다", () => {
  const pair = [
    entry({
      id: "t1",
      code: "T1",
      direction: "out",
      internalTransferId: "TR-1",
      nature: "손익아님",
      amount: 30_000_000,
    }),
    entry({
      id: "t2",
      code: "T2",
      direction: "in",
      internalTransferId: "TR-1",
      nature: "손익아님",
      amount: 30_000_000,
      accountCode: "4110",
    }),
  ];

  it("양쪽 다 계에 안 들어간다 — 지출계·입금계가 동시에 부풀지 않는다", () => {
    const [block] = buildCashflow(
      pair,
      [day("2026-09-14", 100_000_000)],
      "day"
    );
    expect(block.outSum).toBe(0);
    expect(block.inSum).toBe(0);
    expect(block.close).toBe(100_000_000);
  });

  it("따로 보여 준다 — 안 보이면 빠진 것인지 잘못된 것인지 알 수 없다", () => {
    const [block] = buildCashflow(
      pair,
      [day("2026-09-14", 100_000_000)],
      "day"
    );
    expect(block.internalTransfer).toBe(30_000_000);
    expect(block.transferEntries.length).toBe(2);
  });

  it("**손익에도 안 잡힌다** — 비용도 수익도 아니다", () => {
    const withTransfer = buildPnl(pair);
    expect(withTransfer.accounting.revenue).toBe(0);
    expect(withTransfer.accounting.sga).toBe(0);
  });
});

describe("짝으로만 만든다", () => {
  function svc() {
    return new LedgerService(new InMemoryLedgerStore());
  }

  it("한 번 부르면 두 건이 같은 짝 키로 선다", async () => {
    const s = svc();
    const result = await s.recordInternalTransfer(
      {
        date: "2026-09-14",
        amount: 30_000_000,
        fromAccount: "기업은행 주거래",
        toAccount: "농협 제2계좌",
      },
      CFO
    );
    expect(result.entries.length).toBe(2);
    const ids = new Set(result.entries.map(e => e.internalTransferId));
    expect(ids.size).toBe(1);
    expect(result.entries.map(e => e.direction).sort()).toEqual(["in", "out"]);
  });

  it("만든 뒤에도 현금흐름 계가 움직이지 않는다", async () => {
    const s = svc();
    const before = await s.cashflow("day");
    const beforeOut = before.blocks.reduce((sum, b) => sum + b.outSum, 0);
    await s.recordInternalTransfer(
      {
        date: "2026-09-14",
        amount: 30_000_000,
        fromAccount: "기업은행 주거래",
        toAccount: "농협 제2계좌",
      },
      CFO
    );
    const after = await s.cashflow("day");
    const afterOut = after.blocks.reduce((sum, b) => sum + b.outSum, 0);
    expect(afterOut).toBe(beforeOut);
  });

  it("같은 계좌끼리는 거부한다", async () => {
    const s = svc();
    await expect(
      s.recordInternalTransfer(
        {
          date: "2026-09-14",
          amount: 1_000_000,
          fromAccount: "기업은행 주거래",
          toAccount: "기업은행 주거래",
        },
        CFO
      )
    ).rejects.toThrow(/같은 계좌/);
  });

  it("담당자는 기록할 수 없다", async () => {
    const s = svc();
    await expect(
      s.recordInternalTransfer(
        {
          date: "2026-09-14",
          amount: 1_000_000,
          fromAccount: "A",
          toAccount: "B",
        },
        STAFF
      )
    ).rejects.toThrow(/대표·부대표·재무만/);
  });

  it("감사로그에 짝으로 남는다", async () => {
    const s = svc();
    const result = await s.recordInternalTransfer(
      {
        date: "2026-09-14",
        amount: 1_000_000,
        fromAccount: "A",
        toAccount: "B",
      },
      CEO
    );
    const trail = await s.auditTrail({
      table: "entry",
      rowId: result.transferId,
    });
    expect(trail.some(r => r.action === "internal-transfer")).toBe(true);
  });
});

describe("짝이 안 붙으면 반쪽을 남기지 않는다", () => {
  /*
   * 예전에는 `saved ?? withPair` 로 넘겨, 저장소에는 짝 키가 없는데 반환값은
   * 붙었다고 말했다. 짝 키가 없으면 movesCash() 가 true 가 되어 **내부이체
   * 한쪽이 현금흐름에 실제 지출로 잡힌다** — 이 기능을 만든 이유가 바로
   * 그걸 막는 것이었다.
   */
  it("두 번째 다리에서 저장이 실패하면 첫 번째를 되돌리고 오류를 낸다", async () => {
    const store = new InMemoryLedgerStore();
    const s = new LedgerService(store);

    // 두 번째 replaceEntry 만 실패시킨다 (버전 충돌을 흉내낸다)
    const real = store.replaceEntry.bind(store);
    let calls = 0;
    store.replaceEntry = async (entry, expected) => {
      calls += 1;
      if (calls === 2) return undefined;
      return real(entry, expected);
    };

    await expect(
      s.recordInternalTransfer(
        {
          date: "2026-09-14",
          amount: 30_000_000,
          fromAccount: "기업은행 주거래",
          toAccount: "농협 제2계좌",
        },
        CFO
      )
    ).rejects.toThrow(/짝을 만들지 못했습니다/);

    /*
     * 가장 중요한 것 — **반쪽이 현금흐름에 남아 있으면 안 된다.**
     * 3억을 옮겼는데 나간 것만 잡히면 그 달이 통째로 적자로 보인다.
     */
    const after = await s.cashflow("day");
    const onDay = after.blocks.find(b => b.key === "2026-09-14");
    const leaked = [
      ...(onDay?.outEntries ?? []),
      ...(onDay?.inEntries ?? []),
    ].filter(e => e.amount === 30_000_000);
    expect(leaked).toEqual([]);
  });
});
