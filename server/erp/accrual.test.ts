/**
 * 1차 회계 정확도 — A4 축 분리 · A5 미지급금 2단 · B7 부가세 상계 · C3 원금/이자
 *
 * 네 가지 모두 「전표가 현실을 반영하지 않던」 것이다.
 * 숫자가 어느 계정에 얼마로 앉는지를 고정한다.
 */
import { describe, expect, it } from "vitest";
import {
  PAYABLE_ACCOUNT,
  RECEIVABLE_ACCOUNT,
  VAT_INPUT_ACCOUNT,
  VAT_OUTPUT_ACCOUNT,
  assertBalanced,
  buildJournals,
  settleVat,
  vatPeriodOf,
  vatPeriods,
} from "../../shared/erp/index.js";
import type { Entry } from "../../shared/erp/index.js";

function entry(over: Partial<Entry> = {}): Entry {
  return {
    id: "e1",
    code: "EX-260901-01",
    direction: "out",
    status: "confirmed",
    title: "테스트",
    noteRaw: "",
    amount: 1_100_000,
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

let seq = 0;
const ids = () => `j-${++seq}`;

describe("A5 발생월 ≠ 지급월 — 미지급금 2단 전표", () => {
  it("8월 발생 · 9월 지급이면 전표가 2건 나온다", () => {
    const journals = buildJournals(
      entry({ accrualDate: "2026-08-20", cashDate: "2026-09-05" }),
      ids
    );
    expect(journals).toHaveLength(2);
    const [accrual, settle] = journals;
    expect(accrual.journalDate).toBe("2026-08-20");
    expect(settle.journalDate).toBe("2026-09-05");
  });

  it("발생 전표는 비용/미지급금 — 현금이 아니다", () => {
    const [accrual] = buildJournals(
      entry({ accrualDate: "2026-08-20", cashDate: "2026-09-05" }),
      ids
    );
    const by = Object.fromEntries(accrual.lines.map(l => [l.accountCode, l]));
    expect(by["6310"].debit).toBe(1_100_000);
    // 8월에는 아직 현금이 안 나갔다 — 부채로 잡혀야 한다
    expect(by[PAYABLE_ACCOUNT].credit).toBe(1_100_000);
    expect(by["1110"]).toBeUndefined();
  });

  it("지급 전표는 미지급금을 없애고 현금을 뺀다", () => {
    const [, settle] = buildJournals(
      entry({ accrualDate: "2026-08-20", cashDate: "2026-09-05" }),
      ids
    );
    const by = Object.fromEntries(settle.lines.map(l => [l.accountCode, l]));
    expect(by[PAYABLE_ACCOUNT].debit).toBe(1_100_000);
    expect(by["1110"].credit).toBe(1_100_000);
  });

  it("수입은 미수금을 거친다", () => {
    const journals = buildJournals(
      entry({
        direction: "in",
        accountCode: "4100",
        accrualDate: "2026-08-20",
        cashDate: "2026-09-05",
      }),
      ids
    );
    const accrual = Object.fromEntries(
      journals[0].lines.map(l => [l.accountCode, l])
    );
    expect(accrual[RECEIVABLE_ACCOUNT].debit).toBe(1_100_000);
  });

  it("같은 달이면 1건 그대로다", () => {
    expect(buildJournals(entry(), ids)).toHaveLength(1);
  });

  it("2단 전표도 각각 균형을 만족한다", () => {
    for (const j of buildJournals(
      entry({ accrualDate: "2026-08-20", cashDate: "2026-09-05" }),
      ids
    ))
      expect(() => assertBalanced(j)).not.toThrow();
  });

  it("적격증빙이 있으면 발생 전표에서 세액을 나눈다", () => {
    // 세금계산서 날짜가 발생일이므로 세액도 그때 잡힌다
    const [accrual] = buildJournals(
      entry({ accrualDate: "2026-08-20", cashDate: "2026-09-05" }),
      ids,
      { hasQualifiedEvidence: true }
    );
    const by = Object.fromEntries(accrual.lines.map(l => [l.accountCode, l]));
    expect(by["6310"].debit).toBe(1_000_000);
    expect(by[VAT_INPUT_ACCOUNT].debit).toBe(100_000);
    expect(by[PAYABLE_ACCOUNT].credit).toBe(1_100_000);
  });
});

describe("C3 차입 상환 — 원금과 이자", () => {
  it("원금은 부채를 줄이고 이자는 비용이다", () => {
    const journals = buildJournals(
      entry({
        accountCode: "2210",
        amount: 5_200_000,
        principalAmount: 5_000_000,
      }),
      ids
    );
    expect(journals).toHaveLength(1);
    const by = Object.fromEntries(
      journals[0].lines.map(l => [l.accountCode, l])
    );
    // 원금만 잡으면 이자가 손익에서 빠지고, 전액 이자로 잡으면 부채가 안 줄어든다
    expect(by["2210"].debit).toBe(5_000_000);
    expect(by["8110"].debit).toBe(200_000);
    expect(by["1110"].credit).toBe(5_200_000);
  });

  it("이자가 0 이면 이자 줄을 만들지 않는다", () => {
    const journals = buildJournals(
      entry({
        accountCode: "2210",
        amount: 5_000_000,
        principalAmount: 5_000_000,
      }),
      ids
    );
    expect(journals[0].lines).toHaveLength(2);
  });

  it("원금이 총액보다 크면 전표를 만들지 않는다", () => {
    // 입력 오류다 — 억지로 맞추면 부채가 음수가 된다
    expect(
      buildJournals(
        entry({
          accountCode: "2210",
          amount: 1_000_000,
          principalAmount: 2_000_000,
        }),
        ids
      )
    ).toHaveLength(1);
  });
});

describe("A15 · B7 부가세 과세기간", () => {
  it("한 해에 과세기간이 4개다", () => {
    const periods = vatPeriods(2026);
    expect(periods).toHaveLength(4);
    expect(periods[0].dueDate).toBe("2026-04-25");
    // 2기 확정신고 기한은 다음 해 1월이다
    expect(periods[3].dueDate).toBe("2027-01-25");
  });

  it("날짜가 속한 과세기간을 찾는다", () => {
    expect(vatPeriodOf("2026-09-15")?.label).toBe("2026년 2기 예정");
    expect(vatPeriodOf("2026-02-01")?.label).toBe("2026년 1기 예정");
  });

  it("매출세액에서 매입세액을 빼고 차액만 낸다", () => {
    const period = vatPeriods(2026)[2]; // 7~9월
    const s = settleVat(period, [
      {
        accountCode: VAT_OUTPUT_ACCOUNT,
        debit: 0,
        credit: 800_000,
        journalDate: "2026-08-10",
      },
      {
        accountCode: VAT_INPUT_ACCOUNT,
        debit: 300_000,
        credit: 0,
        journalDate: "2026-08-15",
      },
    ]);
    expect(s.output).toBe(800_000);
    expect(s.input).toBe(300_000);
    expect(s.payable).toBe(500_000);
    expect(s.isRefund).toBe(false);
  });

  it("매입이 매출보다 크면 환급으로 표시한다", () => {
    // 낼 돈과 받을 돈은 성격이 다르므로 구분한다
    const period = vatPeriods(2026)[2];
    const s = settleVat(period, [
      {
        accountCode: VAT_INPUT_ACCOUNT,
        debit: 900_000,
        credit: 0,
        journalDate: "2026-08-15",
      },
    ]);
    expect(s.payable).toBe(-900_000);
    expect(s.isRefund).toBe(true);
  });

  it("과세기간 밖의 전표는 세지 않는다", () => {
    const period = vatPeriods(2026)[2]; // 7~9월
    const s = settleVat(period, [
      {
        accountCode: VAT_OUTPUT_ACCOUNT,
        debit: 0,
        credit: 500_000,
        journalDate: "2026-06-30",
      },
    ]);
    expect(s.output).toBe(0);
  });
});
