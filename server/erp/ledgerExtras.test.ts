/**
 * 4차 마무리 — A8 외화 · A12 이월 · A16 전표 대응 · B6 4대보험 · C4 여신 ·
 * C5 계좌별 · C7 연령 구간 · C8 지급 순서 · E11 제출 패키지
 *
 * 전부 「사람이 손으로 메우고 있던」 것이다. 손으로 메우던 자리는 시간이 지나면
 * 반드시 어긋나므로, 어긋났을 때 어디를 보면 되는지까지 테스트로 고정한다.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGING_BUCKETS,
  agingBucketLabel,
  assertBalanced,
  buildJournals,
  creditSummary,
  journalChains,
  paymentOrder,
  toKrw,
} from "../../shared/erp/index.js";
import type { Entry, Journal } from "../../shared/erp/index.js";
import { LedgerService } from "./service.js";
import { InMemoryLedgerStore } from "./store.js";
import type { Actor } from "./service.js";

const CFO: Actor = { id: "cfo@dinostudio.kr", role: "재무" };
const CEO: Actor = { id: "ceo@dinostudio.kr", role: "대표" };
const VIEWER: Actor = { id: "cpa@outside.kr", role: "외부열람" };

function svc() {
  return new LedgerService(new InMemoryLedgerStore());
}

function entry(over: Partial<Entry> = {}): Entry {
  return {
    id: "e1",
    code: "EX-260901-01",
    direction: "out",
    status: "confirmed",
    title: "테스트",
    noteRaw: "",
    amount: 1_000_000,
    amountCandidate: null,
    accountCode: "6310",
    buCode: null,
    projectId: null,
    partyId: null,
    payMethod: "계좌이체",
    bankAccount: null,
    cashDate: "2026-09-01",
    accrualDate: "2026-09-01",
    dueDate: null,
    paidAt: null,
    invoiceDate: null,
    isPersonal: false,
    hasEvidence: true,
    priorityOverride: null,
    source: "manual",
    sourceRef: null,
    parentCode: null,
    roundNo: null,
    linkedRevenueCode: null,
    version: 1,
    createdBy: "a@b.kr",
    createdAt: "2026-09-01T00:00:00+09:00",
    ...over,
  } as unknown as Entry;
}

let seq = 0;
const ids = () => `j-${++seq}`;

describe("B6 급여 3분할 — 사업주 부담분은 우리 비용이다", () => {
  it("급여 · 사업주부담 · 예수금으로 갈라지고 전표가 맞는다", () => {
    // 실지급 3,000,000 · 원천세 100,000 · 근로자 4대보험 250,000 · 사업주 280,000
    const journals = buildJournals(
      entry({
        accountCode: "6110",
        amount: 3_000_000,
        withheldAmount: 100_000,
        employeeInsurance: 250_000,
        employerInsurance: 280_000,
      }),
      ids
    );
    expect(journals).toHaveLength(1);
    const journal = journals[0];
    assertBalanced(journal);

    const at = (code: string) =>
      journal.lines.filter(l => l.accountCode === code);

    // 총급여 = 실지급 + 원천세 + 근로자 부담분
    expect(at("6110")[0].debit).toBe(3_350_000);
    // 사업주 부담분은 급여에 섞이지 않는다 — 별도 비용이다
    expect(at("6130")[0].debit).toBe(280_000);
    // 통장에서 나간 것은 실지급액뿐이다
    expect(at("1110")[0].credit).toBe(3_000_000);
    expect(at("2131")[0].credit).toBe(100_000);
    // 공단에 낼 돈은 근로자분 + 사업주분이다
    expect(at("2132")[0].credit).toBe(530_000);
  });

  it("보험 금액이 없으면 3분할하지 않는다 — 없는 예수금을 만들지 않는다", () => {
    const journals = buildJournals(
      entry({ accountCode: "6110", amount: 3_000_000 }),
      ids
    );
    expect(
      journals[0].lines.some(l => l.accountCode === "2132")
    ).toBe(false);
  });
});

describe("A8 외화 — 환율을 모르면 환산하지 않는다", () => {
  it("환율이 있으면 원화로 환산한다", () => {
    expect(toKrw({ amount: 1_000, currency: "USD", rate: 1_350.25 })).toEqual({
      krw: 1_350_250,
      reason: null,
    });
  });

  it("환율이 없으면 금액을 만들지 않고 이유를 남긴다", () => {
    const result = toKrw({ amount: 1_000, currency: "USD", rate: null });
    expect(result.krw).toBeNull();
    expect(result.reason).toContain("USD");
  });

  it("createEntry — 환율이 없는 외화 건은 판정 대기로 들어간다", async () => {
    const s = svc();
    const created = await s.createEntry(
      {
        direction: "out",
        title: "해외 SaaS",
        amount: null,
        cashDate: "2026-09-01",
        currency: "USD",
        amountForeign: 1_000,
        accountCode: "6310",
      },
      CFO
    );
    expect(created.entry.status).toBe("undecided");
    expect(created.entry.amount).toBeNull();
    expect(created.entry.undecidedReason).toContain("환율");
  });

  it("createEntry — 환율이 있으면 원화로 앉고 외화가 근거로 남는다", async () => {
    const s = svc();
    const created = await s.createEntry(
      {
        direction: "out",
        title: "해외 SaaS",
        amount: null,
        cashDate: "2026-09-01",
        currency: "usd",
        amountForeign: 1_000,
        fxRate: 1_350,
        accountCode: "6310",
      },
      CFO
    );
    expect(created.entry.amount).toBe(1_350_000);
    expect(created.entry.currency).toBe("USD");
    expect(created.entry.amountForeign).toBe(1_000);
    expect(created.entry.status).toBe("pending");
  });
});

describe("A16 전표 대응 — 원본 · 역분개 · 재분개", () => {
  const journal = (
    over: Partial<Journal & { entryCode: string }> = {}
  ): Journal & { entryCode: string } =>
    ({
      id: "j1",
      entryId: "e1",
      entryCode: "EX-260901-01",
      journalDate: "2026-09-01",
      journalNo: "2026-09-0001",
      memo: "원본",
      auto: true,
      reversedBy: null,
      lines: [
        {
          id: "l1",
          journalId: "j1",
          accountCode: "6310",
          debit: 1_000_000,
          credit: 0,
          buCode: null,
          projectId: null,
        },
      ],
      ...over,
    }) as Journal & { entryCode: string };

  it("수정이 없는 건은 대응표에 나오지 않는다", () => {
    expect(journalChains([journal()])).toHaveLength(0);
  });

  it("원본 · 역분개 · 재분개가 한 묶음으로 잡힌다", () => {
    const chains = journalChains([
      journal(),
      journal({ id: "j2", memo: "역분개", reversedBy: "j1" }),
      journal({
        id: "j3",
        entryCode: "EX-260901-01-R1",
        memo: "재분개",
        journalDate: "2026-09-02",
      }),
    ]);
    expect(chains).toHaveLength(1);
    expect(chains[0].baseCode).toBe("EX-260901-01");
    expect(chains[0].rows.map(r => r.role)).toEqual([
      "원본",
      "역분개",
      "재분개",
    ]);
    // 원본과 역분개가 지워지고 재분개만 남는다 — 금액이 두 번 잡히지 않았다
    expect(chains[0].balanced).toBe(true);
  });
});

describe("C7 연령 구간 — 업종마다 다르다", () => {
  it("기본 구간은 30 · 60 · 90 이다", () => {
    expect(Array.from(DEFAULT_AGING_BUCKETS)).toEqual([30, 60, 90]);
    expect(agingBucketLabel(10)).toBe("30일 이내");
    expect(agingBucketLabel(120)).toBe("90일 초과");
  });

  it("구간을 바꾸면 같은 경과일이 다른 칸으로 간다", () => {
    expect(agingBucketLabel(20, [15, 30])).toBe("30일 이내");
    expect(agingBucketLabel(20, [10, 15])).toBe("15일 초과");
  });

  it("설정값이 채권 화면의 구간을 바꾼다", async () => {
    const s = svc();
    await s.putSetting("ar_aging_buckets", [15, 30], false, CEO);
    const report = await s.ar();
    expect(report.aging.buckets).toEqual([15, 30]);
    expect(report.aging.rows.map(r => r.label)).toEqual([
      "15일 이내",
      "30일 이내",
      "30일 초과",
    ]);
  });

  it("경과일을 모르는 건은 어느 구간에도 넣지 않는다", async () => {
    const s = svc();
    const report = await s.ar();
    const counted = report.aging.rows.reduce((sum, r) => sum + r.count, 0);
    expect(counted + report.aging.unknown).toBe(report.receivables.length);
  });
});

describe("C8 지급 순서 — 연체가 먼저, 금액이 마지막", () => {
  it("연체 → 임박 → 금액 큰 것 순으로 정렬한다", () => {
    const sorted = paymentOrder(
      [
        entry({ id: "a", code: "EX-1", dueDate: "2026-09-10", amount: 100 }),
        entry({ id: "b", code: "EX-2", dueDate: "2026-08-20", amount: 10 }),
        entry({ id: "c", code: "EX-3", dueDate: "2026-09-10", amount: 900 }),
      ],
      "2026-09-01"
    );
    // 연체(8/20)가 금액과 무관하게 먼저다
    expect(sorted.map(e => e.code)).toEqual(["EX-2", "EX-3", "EX-1"]);
  });

  it("기한이 없는 건은 뒤로 간다 — 정렬 근거가 없다", () => {
    const sorted = paymentOrder(
      [
        entry({ id: "a", code: "EX-1", dueDate: null, cashDate: null }),
        entry({ id: "b", code: "EX-2", dueDate: "2026-09-30" }),
      ],
      "2026-09-01"
    );
    expect(sorted[0].code).toBe("EX-2");
  });
});

describe("C4 여신 — 한도는 현금과 다른 돈이다", () => {
  it("잔여 한도와 소진율을 계산한다", () => {
    const summary = creditSummary([
      {
        id: "1",
        name: "기업은행 마이너스",
        kind: "마이너스통장",
        limit: 50_000_000,
        used: 20_000_000,
      },
    ]);
    expect(summary.totalAvailable).toBe(30_000_000);
    expect(summary.lines[0].usageRate).toBe(40);
  });

  it("현금이 없으면 즉시 동원 가능액을 만들지 않는다", async () => {
    const s = svc();
    await s.putSetting("cash_on_hand", null, true, CEO);
    const credit = await s.credit();
    expect(credit.immediatelyAvailable).toBeNull();
  });

  it("현금이 있으면 한도를 더해 보여 주되 합치지 않는다", async () => {
    const s = svc();
    await s.putSetting("cash_on_hand", 10_000_000, false, CEO);
    await s.putSetting(
      "credit_lines",
      [
        {
          id: "1",
          name: "기업은행 마이너스",
          kind: "마이너스통장",
          limit: 50_000_000,
          used: 20_000_000,
        },
      ],
      false,
      CEO
    );
    const credit = await s.credit();
    expect(credit.cashOnHand).toBe(10_000_000);
    expect(credit.totalAvailable).toBe(30_000_000);
    expect(credit.immediatelyAvailable).toBe(40_000_000);
  });
});

describe("C5 계좌별 잔액 — 대사의 단위", () => {
  it("계좌가 없는 확정 건을 따로 센다", async () => {
    const s = svc();
    const banks = await s.bankAccounts();
    expect(banks.rows).toHaveLength(0);
    // 시드 원장은 계좌가 지정되지 않은 건들이다 — 합계는 맞아도 대사는 못 한다
    expect(banks.unassigned.n).toBeGreaterThan(0);
  });

  it("계좌를 등록하면 원장 증감이 계좌별로 붙는다", async () => {
    const s = svc();
    await s.putSetting(
      "bank_accounts",
      [
        {
          code: "1110-01",
          name: "주거래",
          bank: "기업은행",
          balance: 30_000_000,
        },
      ],
      false,
      CEO
    );
    const banks = await s.bankAccounts();
    expect(banks.rows[0].balance).toBe(30_000_000);
    expect(banks.declaredTotal).toBe(30_000_000);
    // 아직 이 계좌를 쓴 건이 없으므로 증감은 0 이다
    expect(banks.rows[0].ledgerMovement).toBe(0);
  });
});

describe("E11 세무 제출 패키지 — 외부열람은 들고 나갈 수 없다", () => {
  it("재무는 내보낼 수 있다", async () => {
    const s = svc();
    const pack = await s.taxPackage({ ym: "2026-08" }, CFO);
    expect(pack.ym).toBe("2026-08");
    expect(Array.isArray(pack.accountSummary)).toBe(true);
  });

  it("외부열람 역할은 거부된다 — 보는 것과 들고 나가는 것은 다르다", async () => {
    const s = svc();
    await expect(s.taxPackage({ ym: "2026-08" }, VIEWER)).rejects.toThrow(
      /내보낼 수 없습니다/
    );
  });
});

describe("A13 계정별 원장 — 잔액이 틀어진 지점을 찾는다", () => {
  it("누계 잔액이 줄마다 붙는다", async () => {
    const s = svc();
    const ledger = await s.accountLedger({ accountCode: "1110" }, CFO);
    expect(ledger.accountCode).toBe("1110");
    expect(ledger.normalSide).toBe("차변");
    // 마지막 줄의 누계가 기말 잔액과 같아야 한다
    if (ledger.rows.length > 0)
      expect(ledger.rows[ledger.rows.length - 1].balance).toBe(ledger.closing);
  });
});

describe("A12 이월 — 마감이 다음 달 기초잔액을 만든다", () => {
  /**
   * 마감을 통과시키기 위한 최소 원장. 이관 검증(V1~V8)은 시드 데이터를 전제로
   * 하므로 여기서는 시드를 비우고, 확정 건 하나를 직접 만들어 넣는다.
   */
  function freshSvc(cashOnHand: number | null) {
    return new LedgerService(
      new InMemoryLedgerStore({
        entries: [],
        snapshots: [],
        settings:
          cashOnHand == null
            ? []
            : [
                {
                  key: "cash_on_hand",
                  value: cashOnHand,
                  isProvisional: false,
                  ownerRole: "재무",
                  updatedBy: "test",
                  updatedAt: "2026-09-01T00:00:00+09:00",
                },
              ],
      })
    );
  }

  /** 확정된 수입 한 건 — 마감 대상이 있어야 이월이 의미를 갖는다 */
  async function confirmedIncome(
    s: LedgerService,
    cashDate: string,
    amount: number
  ) {
    const created = await s.createEntry(
      {
        direction: "in",
        title: "수금",
        amount,
        cashDate,
        accountCode: "4110",
      },
      CFO
    );
    await s.addEvidence(
      {
        code: created.entry.code,
        kind: "세금계산서",
        storage: "link",
        url: "https://drive.google.com/x",
      },
      CFO
    );
    const ready = await s.getEntry(created.entry.code, CFO);
    await s.approve(created.entry.code, ready.entry.version, CEO);
  }

  it("마감이 끝나면 다음 달 기초잔액이 원장에서 계산되어 남는다", async () => {
    const s = freshSvc(30_000_000);
    await confirmedIncome(s, "2026-09-10", 5_000_000);

    const period = await s.closePeriod("2026-09", CEO);
    expect(period.status).toBe("closed");
    // 기초 30,000,000 + 9월 수금 5,000,000
    expect(period.carryForward).toEqual({
      ym: "2026-10",
      value: 35_000_000,
      blockedBy: null,
    });

    // 사람이 다시 넣지 않아도 설정에 남는다
    const settings = await s.settings();
    const carried = settings.find(x => x.key === "opening_cash:2026-10");
    expect(carried?.value).toBe(35_000_000);
    expect(carried?.isProvisional).toBe(false);
  });

  it("12월 마감은 다음 해 1월로 넘어간다", async () => {
    const s = freshSvc(30_000_000);
    await confirmedIncome(s, "2026-12-10", 1_000_000);
    const period = await s.closePeriod("2026-12", CEO);
    expect(period.carryForward.ym).toBe("2027-01");
    expect(period.carryForward.value).toBe(31_000_000);
  });

  it("기초잔액이 없으면 이월을 만들지 않고 이유를 남긴다", async () => {
    const s = freshSvc(null);
    await confirmedIncome(s, "2026-09-10", 1_000_000);
    const period = await s.closePeriod("2026-09", CEO);
    expect(period.carryForward.value).toBeNull();
    expect(period.carryForward.blockedBy).toContain("cash_on_hand");
  });
});
