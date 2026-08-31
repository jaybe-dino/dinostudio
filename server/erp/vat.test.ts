/**
 * 부가세 분리 (docs/erp-qa.md A1 · A9)
 *
 * 여기가 틀리면 손익·부가세 신고·재무상태표가 동시에 틀린다.
 * 그래서 "얼마가 어느 계정으로 가는가"를 숫자로 고정한다.
 */
import { describe, expect, it } from "vitest";
import {
  VAT_INPUT_ACCOUNT,
  VAT_OUTPUT_ACCOUNT,
  accountAllowsVatDeduction,
  assertBalanced,
  buildJournal,
  splitVat,
  vatAccountsPresent,
  vatClassOf,
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
const ids = () => `id-${++seq}`;

describe("계정별 부가세 구분", () => {
  it("부가세 계정이 마스터에 있다", () => {
    expect(vatAccountsPresent()).toBe(true);
  });

  it("급여·이자는 세액을 만들지 않는다", () => {
    expect(vatClassOf("6110")).toBe("none");
    expect(vatClassOf("8110")).toBe("exempt");
  });

  it("여비교통비는 과세지만 매입세액 불공제다", () => {
    // 항공·철도·택시는 세금계산서를 받아도 공제되지 않는다
    expect(vatClassOf("6510")).toBe("excluded");
    expect(accountAllowsVatDeduction("6510")).toBe(false);
  });

  it("모르는 계정은 세액을 만들지 않는다", () => {
    expect(vatClassOf("9900")).toBe("none");
    expect(vatClassOf("없는코드")).toBe("none");
  });
});

describe("공급대가 분리", () => {
  it("1,100,000 은 공급가액 1,000,000 + 세액 100,000 으로 나뉜다", () => {
    const split = splitVat({
      amount: 1_100_000,
      accountCode: "6310",
      hasQualifiedEvidence: true,
    });
    expect(split).toMatchObject({
      supply: 1_000_000,
      vat: 100_000,
      reason: null,
    });
    // 합이 공급대가와 정확히 같아야 분개가 균형을 잃지 않는다
    expect(split.supply + split.vat).toBe(1_100_000);
  });

  it("반올림이 생겨도 합은 공급대가와 같다", () => {
    for (const amount of [1, 7, 33_333, 999_999, 1_234_567]) {
      const split = splitVat({
        amount,
        accountCode: "6310",
        hasQualifiedEvidence: true,
      });
      expect(split.supply + split.vat).toBe(amount);
    }
  });

  it("적격증빙이 없으면 분리하지 않고 이유를 남긴다", () => {
    const split = splitVat({
      amount: 1_100_000,
      accountCode: "6310",
      hasQualifiedEvidence: false,
    });
    expect(split).toMatchObject({ supply: 1_100_000, vat: 0 });
    expect(split.reason).toContain("적격증빙");
  });

  it("통과원가는 우리 세액이 아니다", () => {
    const split = splitVat({
      amount: 1_100_000,
      accountCode: "6310",
      hasQualifiedEvidence: true,
      isPassThrough: true,
    });
    expect(split.vat).toBe(0);
  });

  it("취소 전표(음수)도 같은 비율로 나뉘어 상계된다", () => {
    const plus = splitVat({
      amount: 1_100_000,
      accountCode: "6310",
      hasQualifiedEvidence: true,
    });
    const minus = splitVat({
      amount: -1_100_000,
      accountCode: "6310",
      hasQualifiedEvidence: true,
    });
    expect(minus.supply).toBe(-plus.supply);
    expect(minus.vat).toBe(-plus.vat);
  });
});

describe("전표 생성", () => {
  it("적격증빙이 있는 지출은 3줄이 된다", () => {
    const journal = buildJournal(entry(), ids, { hasQualifiedEvidence: true })!;
    expect(journal.lines).toHaveLength(3);
    const byAccount = Object.fromEntries(
      journal.lines.map(l => [l.accountCode, l])
    );
    // 비용은 공급가액만 — 여기가 예전에 1,100,000 이어서 손익이 과대계상됐다
    expect(byAccount["6310"].debit).toBe(1_000_000);
    expect(byAccount[VAT_INPUT_ACCOUNT].debit).toBe(100_000);
    expect(byAccount["1110"].credit).toBe(1_100_000);
  });

  it("증빙이 없으면 2줄로 남는다", () => {
    const journal = buildJournal(entry(), ids, {
      hasQualifiedEvidence: false,
    })!;
    expect(journal.lines).toHaveLength(2);
    expect(journal.lines[0].debit).toBe(1_100_000);
  });

  it("옵션을 주지 않으면 세액을 만들지 않는다", () => {
    // 모르면 만들지 않는 편이 안전하다 — 없는 세액을 신고할 수 없다
    expect(buildJournal(entry(), ids)!.lines).toHaveLength(2);
  });

  it("매출은 예수부가세로 잡힌다", () => {
    const journal = buildJournal(
      entry({ direction: "in", accountCode: "4100", amount: 5_500_000 }),
      ids,
      { hasQualifiedEvidence: true }
    )!;
    const byAccount = Object.fromEntries(
      journal.lines.map(l => [l.accountCode, l])
    );
    expect(byAccount["1110"].debit).toBe(5_500_000);
    expect(byAccount["4100"].credit).toBe(5_000_000);
    expect(byAccount[VAT_OUTPUT_ACCOUNT].credit).toBe(500_000);
  });

  it("급여는 적격증빙이 있어도 2줄이다", () => {
    const journal = buildJournal(
      entry({ accountCode: "6110", amount: 3_000_000 }),
      ids,
      { hasQualifiedEvidence: true }
    )!;
    expect(journal.lines).toHaveLength(2);
  });

  it("모든 전표가 차대 균형을 만족한다", () => {
    for (const accountCode of [
      "6310",
      "6110",
      "6510",
      "4100",
      "1210",
      "8110",
    ]) {
      for (const hasQualifiedEvidence of [true, false]) {
        for (const amount of [1_100_000, 33_333, -1_100_000]) {
          const journal = buildJournal(entry({ accountCode, amount }), ids, {
            hasQualifiedEvidence,
          })!;
          expect(() => assertBalanced(journal)).not.toThrow();
        }
      }
    }
  });

  it("균형이 깨진 전표는 단정에서 걸린다", () => {
    const journal = buildJournal(entry(), ids, { hasQualifiedEvidence: true })!;
    journal.lines[0].debit += 1;
    expect(() => assertBalanced(journal)).toThrow(/맞지 않습니다/);
  });
});
