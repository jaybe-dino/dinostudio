/**
 * 은행 대사 (docs/erp-qa.md C6)
 *
 * 「대사 차액 0」이 사실이 되려면 이 로직이 맞아야 한다.
 * 특히 **잘못 맞추는 것**이 안 맞추는 것보다 나쁘다 — 틀린 확신이 생긴다.
 */
import { describe, expect, it } from "vitest";
import {
  NEAR_MATCH_DAYS,
  checkBalanceChain,
  parseBankStatement,
  reconcile,
} from "../../shared/erp/index.js";
import type { BankTxn, Entry } from "../../shared/erp/index.js";

const YEAR = 2026;

function entry(over: Partial<Entry> = {}): Entry {
  return {
    id: `e-${Math.random()}`,
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
    updatedAt: "2026-09-01T00:00:00+09:00",
    ...over,
  } as Entry;
}

function txn(over: Partial<BankTxn> = {}): BankTxn {
  return {
    date: "2026-09-01",
    description: "테스트",
    out: 1_000_000,
    in: null,
    balance: null,
    raw: "",
    ...over,
  };
}

describe("거래내역 읽기", () => {
  it("기업은행 형태의 헤더를 알아본다", () => {
    const text = [
      "거래일자\t적요\t출금액\t입금액\t거래후잔액",
      "2026-09-01\t㈜셀릿\t1,100,000\t\t18,000,000",
      "2026-09-02\t용역대금\t\t5,500,000\t23,500,000",
    ].join("\n");
    const { txns, skipped } = parseBankStatement(text, YEAR);
    expect(skipped).toHaveLength(0);
    expect(txns).toHaveLength(2);
    expect(txns[0]).toMatchObject({
      date: "2026-09-01",
      description: "㈜셀릿",
      out: 1_100_000,
      in: null,
      balance: 18_000_000,
    });
    expect(txns[1].in).toBe(5_500_000);
  });

  it("거래일시에 시각이 붙어 있어도 읽는다", () => {
    const text = [
      "거래일시,내용,출금,입금",
      "2026-09-01 14:23:11,카드대금,500000,",
    ].join("\n");
    expect(parseBankStatement(text, YEAR).txns[0].date).toBe("2026-09-01");
  });

  it("읽지 못한 줄을 버리지 않고 이유와 함께 남긴다", () => {
    // 조용히 사라지면 잔액이 안 맞는 이유를 영영 못 찾는다
    const text = [
      "거래일자\t적요\t출금\t입금",
      "말도안되는날짜\t뭔가\t100\t",
      "2026-09-01\t정상\t200\t",
    ].join("\n");
    const { txns, skipped } = parseBankStatement(text, YEAR);
    expect(txns).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].why).toContain("거래일자");
  });

  it("헤더가 없으면 추측하지 않고 거부한다", () => {
    const { txns, skipped } = parseBankStatement("2026-09-01\t100\t", YEAR);
    expect(txns).toHaveLength(0);
    expect(skipped[0].why).toContain("거래일자 컬럼");
  });
});

describe("대사", () => {
  it("날짜·금액이 같으면 정확히 짝짓는다", () => {
    const r = reconcile([txn()], [entry()]);
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].kind).toBe("exact");
    expect(r.bankOnly).toHaveLength(0);
    expect(r.ledgerOnly).toHaveLength(0);
  });

  it(`금액이 같고 ${NEAR_MATCH_DAYS}일 이내면 근접으로 짝짓는다`, () => {
    // 카드 매입은 며칠 밀려 통장에 찍힌다
    const r = reconcile([txn({ date: "2026-09-03" })], [entry()]);
    expect(r.matched[0]).toMatchObject({ kind: "near", dayGap: 2 });
  });

  it("금액이 같아도 날짜가 너무 멀면 같은 거래로 단정하지 않는다", () => {
    // 잘못 맞추는 것이 안 맞추는 것보다 나쁘다 — 틀린 확신이 생긴다
    const r = reconcile([txn({ date: "2026-09-20" })], [entry()]);
    expect(r.matched).toHaveLength(0);
    expect(r.bankOnly).toHaveLength(1);
    expect(r.ledgerOnly).toHaveLength(1);
  });

  it("한 원장 건에 두 거래가 붙지 않는다", () => {
    // 붙으면 잔액이 두 번 빠진다
    const r = reconcile([txn(), txn()], [entry()]);
    expect(r.matched).toHaveLength(1);
    expect(r.bankOnly).toHaveLength(1);
  });

  it("같은 금액이 여럿이면 날짜가 가까운 쪽을 고른다", () => {
    const near = entry({ id: "near", cashDate: "2026-09-01" });
    const far = entry({ id: "far", cashDate: "2026-09-03" });
    const r = reconcile([txn({ date: "2026-09-01" })], [far, near]);
    expect(r.matched[0].entry?.id).toBe("near");
  });

  it("입금과 출금을 섞지 않는다", () => {
    const r = reconcile([txn({ out: null, in: 1_000_000 })], [entry()]);
    expect(r.matched).toHaveLength(0);
  });

  it("승인 대기 건은 대사 대상이 아니다", () => {
    // 아직 통장에 없다
    const r = reconcile([txn()], [entry({ status: "pending" })]);
    expect(r.ledgerOnly).toHaveLength(0);
    expect(r.bankOnly).toHaveLength(1);
  });

  it("통장에만 있는 것과 원장에만 있는 것을 나눠서 준다", () => {
    const r = reconcile(
      [txn({ description: "모르는 출금", out: 777 })],
      [entry({ amount: 999 })]
    );
    expect(r.bankOnly[0].description).toBe("모르는 출금");
    expect(r.ledgerOnly[0].amount).toBe(999);
  });

  it("차액을 방향별로 계산한다", () => {
    const r = reconcile(
      [txn({ out: 1_000_000 }), txn({ out: null, in: 500_000 })],
      [entry({ amount: 1_000_000 })]
    );
    expect(r.difference.outGap).toBe(0);
    expect(r.difference.inGap).toBe(500_000);
  });
});

describe("잔액 체인", () => {
  it("이어지면 ok", () => {
    const r = checkBalanceChain([
      txn({ balance: 10_000_000, out: null }),
      txn({ out: 1_000_000, balance: 9_000_000 }),
      txn({ out: null, in: 500_000, balance: 9_500_000 }),
    ]);
    expect(r.ok).toBe(true);
  });

  it("끊기면 어디서 끊겼는지 알려준다", () => {
    // 붙여넣기가 잘렸거나 줄이 빠진 것이다 — 대사 전에 알아야 한다
    const r = checkBalanceChain([
      txn({ balance: 10_000_000, out: null }),
      txn({ date: "2026-09-05", out: 1_000_000, balance: 8_000_000 }),
    ]);
    expect(r.ok).toBe(false);
    expect(r.breaks[0]).toMatchObject({
      at: "2026-09-05",
      expected: 9_000_000,
      actual: 8_000_000,
    });
  });

  it("잔액 컬럼이 없으면 검사하지 않는다", () => {
    expect(checkBalanceChain([txn(), txn()]).ok).toBe(true);
  });
});
