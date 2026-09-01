/**
 * 세무 일정 (docs/erp-qa.md B4 · B5 · B10)
 *
 * 놓치면 가산세가 붙는 것들이므로 기한 계산을 숫자로 고정한다.
 */
import { describe, expect, it } from "vitest";
import {
  DEADLINE_WARN_DAYS,
  INVOICE_WARN_DAYS,
  invoiceDueDate,
  invoiceObligations,
  taxCalendar,
} from "../../shared/erp/index.js";
import type { Entry } from "../../shared/erp/index.js";

function sale(over: Partial<Entry> = {}): Entry {
  return {
    id: `s-${Math.random()}`,
    code: "IN-260801-01",
    direction: "in",
    status: "confirmed",
    title: "용역매출",
    noteRaw: "",
    amount: 5_500_000,
    amountCandidate: null,
    accountCode: "4100",
    buCode: null,
    projectId: null,
    partyId: null,
    payMethod: "계좌이체",
    bankAccount: null,
    cashDate: "2026-08-31",
    accrualDate: "2026-08-15",
    dueDate: null,
    paidAt: null,
    invoiceDate: null,
    invoiceIssued: null,
    invoiceNo: null,
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
    createdAt: "2026-08-15T00:00:00+09:00",
    updatedAt: "2026-08-15T00:00:00+09:00",
    ...over,
  } as Entry;
}

describe("B4 세금계산서 발행 기한", () => {
  it("공급일이 속한 달의 다음 달 10일이다", () => {
    expect(invoiceDueDate("2026-08-15")).toBe("2026-09-10");
    // 12월 공급분은 해가 넘어간다
    expect(invoiceDueDate("2026-12-31")).toBe("2027-01-10");
  });

  it("발행 안 한 매출을 기한과 함께 돌려준다", () => {
    const list = invoiceObligations([sale()], "2026-09-01");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      supplyDate: "2026-08-15",
      dueDate: "2026-09-10",
      status: "발행대기",
      daysLeft: 9,
    });
  });

  it(`기한 ${INVOICE_WARN_DAYS}일 이내면 임박으로 표시한다`, () => {
    const list = invoiceObligations([sale()], "2026-09-07");
    expect(list[0].status).toBe("기한임박");
  });

  it("기한을 넘기면 초과로 표시하고 일수가 음수다", () => {
    const list = invoiceObligations([sale()], "2026-09-15");
    expect(list[0].status).toBe("기한초과");
    expect(list[0].daysLeft).toBeLessThan(0);
  });

  it("발행 완료 건은 기한과 무관하게 완료다", () => {
    const list = invoiceObligations(
      [sale({ invoiceIssued: true, invoiceNo: "2026-0001" })],
      "2026-09-30"
    );
    expect(list[0].status).toBe("발행완료");
  });

  it("지출 건은 발행 의무가 없다", () => {
    // 우리가 발행하는 것만 대상이다 — 받는 계산서는 증빙 쪽이다
    expect(
      invoiceObligations([sale({ direction: "out" })], "2026-09-01")
    ).toHaveLength(0);
  });

  it("공급일이 없으면 의무가 생기지 않는다", () => {
    expect(
      invoiceObligations(
        [sale({ accrualDate: null, cashDate: null })],
        "2026-09-01"
      )
    ).toHaveLength(0);
  });

  it("기한이 가까운 순서로 정렬한다", () => {
    const list = invoiceObligations(
      [
        sale({ code: "IN-260901-01", accrualDate: "2026-09-01" }),
        sale({ code: "IN-260701-01", accrualDate: "2026-07-01" }),
      ],
      "2026-09-05"
    );
    expect(list.map(o => o.code)).toEqual(["IN-260701-01", "IN-260901-01"]);
  });
});

describe("B5 · B10 신고 캘린더", () => {
  const calendar = taxCalendar(
    {
      withholdingPayable: 330_000,
      vatPayable: 500_000,
      lastPayrollDate: "2026-08-25",
    },
    "2026-09-01"
  );

  it("기한이 가까운 순서로 온다", () => {
    const days = calendar.map(c => c.daysLeft);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
  });

  it("원천세는 지급월 다음 달 10일이다", () => {
    const w = calendar.find(c => c.kind === "원천세")!;
    expect(w.dueDate).toBe("2026-09-10");
    expect(w.amount).toBe(330_000);
  });

  it("부가세 기한은 1·4·7·10월 25일이다", () => {
    expect(calendar.find(c => c.kind === "부가세")!.dueDate).toBe("2026-10-25");
  });

  it("아는 금액은 붙이고 모르는 것은 null 로 둔다", () => {
    // 0 으로 채우면 「낼 게 없다」로 읽힌다
    const insurance = calendar.find(c => c.kind === "4대보험")!;
    expect(insurance.amount).toBeNull();
    expect(calendar.find(c => c.kind === "부가세")!.amount).toBe(500_000);
  });

  it("모든 항목이 놓쳤을 때의 결과를 말한다", () => {
    for (const c of calendar) expect(c.penalty.length).toBeGreaterThan(0);
  });

  it("임박 기준이 정의되어 있다", () => {
    expect(DEADLINE_WARN_DAYS).toBeGreaterThan(0);
  });
});
