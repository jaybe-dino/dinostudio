/**
 * 원천징수 예수금 (docs/erp-qa.md A2 · C1)
 *
 * 예수금을 안 잡으면 다음 달 납부할 돈이 재무제표에서 사라진다.
 * 여기서 고정하는 것은 「비용은 총액 · 현금은 실지급액 · 차액은 예수금」이다.
 */
import { describe, expect, it } from "vitest";
import {
  WITHHOLDING_PAYABLE_ACCOUNT,
  WITHHOLDING_RATE,
  assertBalanced,
  buildJournal,
  splitWithholding,
  withholdingDueDate,
} from "../../shared/erp/index.js";
import type { Entry } from "../../shared/erp/index.js";

function entry(over: Partial<Entry> = {}): Entry {
  return {
    id: "e1",
    code: "EX-260901-01",
    direction: "out",
    status: "confirmed",
    title: "외주 정산",
    noteRaw: "",
    amount: 967_000,
    amountCandidate: null,
    accountCode: "5210",
    buCode: null,
    projectId: null,
    partyId: null,
    payMethod: "계좌이체",
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
    updatedAt: "2026-09-01T00:00:00+09:00",
    ...over,
  } as Entry;
}

let seq = 0;
const ids = () => `w-${++seq}`;

describe("원천징수 분리", () => {
  it("사업소득 3.3% — 실지급 967,000 이면 총액 1,000,000", () => {
    const split = splitWithholding({ amount: 967_000, incomeType: "사업소득" });
    expect(split.gross).toBe(1_000_000);
    expect(split.net).toBe(967_000);
    expect(split.withheld).toBe(33_000);
    // 합이 어긋나면 분개가 균형을 잃는다
    expect(split.net + split.withheld).toBe(split.gross);
  });

  it("총액 기준으로도 계산된다", () => {
    const split = splitWithholding({
      amount: 1_000_000,
      incomeType: "사업소득",
      mode: "gross",
    });
    expect(split).toMatchObject({
      gross: 1_000_000,
      net: 967_000,
      withheld: 33_000,
    });
  });

  it("기타소득은 8.8% 다", () => {
    expect(WITHHOLDING_RATE.기타소득).toBe(0.088);
    const split = splitWithholding({
      amount: 1_000_000,
      incomeType: "기타소득",
      mode: "gross",
    });
    expect(split.withheld).toBe(88_000);
  });

  it("근로소득은 비율로 계산하지 않고 이유를 남긴다", () => {
    // 간이세액표를 따르므로 비율이 없다 — 만들어 내면 신고가 틀린다
    const split = splitWithholding({
      amount: 3_000_000,
      incomeType: "근로소득",
    });
    expect(split.withheld).toBe(0);
    expect(split.reason).toContain("간이세액표");
  });

  it("근로소득도 실액을 주면 분리된다", () => {
    const split = splitWithholding({
      amount: 2_800_000,
      incomeType: "근로소득",
      withheldOverride: 200_000,
    });
    expect(split).toMatchObject({
      gross: 3_000_000,
      net: 2_800_000,
      withheld: 200_000,
    });
  });

  it("소득 구분이 없으면 분리하지 않는다", () => {
    const split = splitWithholding({ amount: 967_000, incomeType: null });
    expect(split.withheld).toBe(0);
    expect(split.reason).toContain("소득 구분");
  });

  it("반올림 뒤에도 합이 맞는다", () => {
    for (const amount of [1, 7, 33_333, 967_000, 1_234_567]) {
      const split = splitWithholding({ amount, incomeType: "사업소득" });
      expect(split.net + split.withheld).toBe(split.gross);
    }
  });

  it("취소(음수)도 대칭으로 상계된다", () => {
    const plus = splitWithholding({ amount: 967_000, incomeType: "사업소득" });
    const minus = splitWithholding({
      amount: -967_000,
      incomeType: "사업소득",
    });
    expect(minus.gross).toBe(-plus.gross);
    expect(minus.withheld).toBe(-plus.withheld);
  });

  it("납부 기한은 지급월 다음 달 10일이다", () => {
    expect(withholdingDueDate("2026-09-05")).toBe("2026-10-10");
    // 12월 지급분은 해가 넘어간다
    expect(withholdingDueDate("2026-12-20")).toBe("2027-01-10");
  });
});

describe("원천징수 전표", () => {
  it("비용은 총액 · 현금은 실지급액 · 차액은 예수금", () => {
    const journal = buildJournal(entry({ incomeType: "사업소득" }), ids)!;
    const by = Object.fromEntries(journal.lines.map(l => [l.accountCode, l]));
    // 예전에는 비용이 967,000 이어서 33,000 이 어디에도 없었다
    expect(by["5210"].debit).toBe(1_000_000);
    expect(by[WITHHOLDING_PAYABLE_ACCOUNT].credit).toBe(33_000);
    expect(by["1110"].credit).toBe(967_000);
    expect(() => assertBalanced(journal)).not.toThrow();
  });

  it("소득 구분이 없으면 기존 2줄 그대로다", () => {
    expect(buildJournal(entry(), ids)!.lines).toHaveLength(2);
  });

  it("금액이 바뀌어도 균형을 유지한다", () => {
    for (const amount of [967_000, 33_333, -967_000]) {
      const journal = buildJournal(
        entry({ amount, incomeType: "사업소득" }),
        ids
      )!;
      expect(() => assertBalanced(journal)).not.toThrow();
    }
  });
});
