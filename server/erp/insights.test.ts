/**
 * 경영 판단 지표 (docs/erp-qa.md E3 · E4 · E5 · E7)
 *
 * 판단에 쓰는 숫자이므로 「모르는 것을 0 으로 채우지 않는다」가 특히 중요하다.
 * 0 은 「없다」로 읽히고, 그 오독이 채용·수주 결정으로 이어진다.
 */
import { describe, expect, it } from "vitest";
import {
  CONCENTRATION_WARN,
  productivity,
  projectMargins,
  revenueConcentration,
  runwayDaysCost,
} from "../../shared/erp/index.js";
import type { Entry, Project } from "../../shared/erp/index.js";

function sale(over: Partial<Entry> = {}): Entry {
  return {
    id: `s-${Math.random()}`,
    code: `IN-2608-${Math.floor(Math.random() * 1000)}`,
    direction: "in",
    status: "confirmed",
    title: "매출",
    noteRaw: "",
    amount: 10_000_000,
    amountCandidate: null,
    accountCode: "4100",
    buCode: null,
    projectId: null,
    partyId: "p1",
    payMethod: "계좌이체",
    bankAccount: null,
    cashDate: "2026-08-31",
    accrualDate: "2026-08-15",
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
    createdAt: "2026-08-15T00:00:00+09:00",
    updatedAt: "2026-08-15T00:00:00+09:00",
    ...over,
  } as Entry;
}

const NAMES = new Map([
  ["p1", "A사"],
  ["p2", "B사"],
  ["p3", "C사"],
]);

describe("E3 승인하면 런웨이가 며칠 줄어드나", () => {
  it("월 번레이트 6천만이면 1,100만은 5.5일이다", () => {
    // 일 번레이트 200만 → 1,100만 ÷ 200만 = 5.5일
    expect(runwayDaysCost(11_000_000, 60_000_000)).toBe(5.5);
  });

  it("번레이트를 모르면 계산하지 않는다", () => {
    // 추정 분모로 나눈 숫자가 승인 결정에 쓰이면 안 된다
    expect(runwayDaysCost(11_000_000, null)).toBeNull();
    expect(runwayDaysCost(11_000_000, 0)).toBeNull();
  });

  it("금액이 없으면 계산하지 않는다", () => {
    expect(runwayDaysCost(null, 60_000_000)).toBeNull();
  });
});

describe("E5 매출 집중도", () => {
  it("한 곳에 몰려 있으면 경고한다", () => {
    const c = revenueConcentration(
      [
        sale({ partyId: "p1", amount: 80_000_000 }),
        sale({ partyId: "p2", amount: 20_000_000 }),
      ],
      NAMES
    );
    expect(c.top1).toBeCloseTo(0.8);
    expect(c.top1! > CONCENTRATION_WARN).toBe(true);
    expect(c.verdict).toContain("80%");
  });

  it("고르게 퍼져 있으면 경고하지 않는다", () => {
    const c = revenueConcentration(
      [
        sale({ partyId: "p1", amount: 10_000_000 }),
        sale({ partyId: "p2", amount: 10_000_000 }),
        sale({ partyId: "p3", amount: 10_000_000 }),
      ],
      NAMES
    );
    expect(c.top1).toBeCloseTo(1 / 3);
    expect(c.verdict).toContain("몰려 있지 않습니다");
  });

  it("거래처 미지정 건을 하나로 묶지 않는다", () => {
    // 묶으면 없는 편중이 생긴다 — 서로 다른 거래처일 수 있다
    const c = revenueConcentration(
      [
        sale({ partyId: null, code: "IN-1", amount: 30_000_000 }),
        sale({ partyId: null, code: "IN-2", amount: 30_000_000 }),
        sale({ partyId: "p1", amount: 40_000_000 }),
      ],
      NAMES
    );
    expect(c.rows).toHaveLength(3);
    expect(c.top1).toBeCloseTo(0.4);
  });

  it("확정 매출이 없으면 0 이 아니라 판정 불가다", () => {
    const c = revenueConcentration([], NAMES);
    expect(c.top1).toBeNull();
    expect(c.hhi).toBeNull();
    expect(c.verdict).toContain("판정할 수 없습니다");
  });

  it("승인 대기와 지출은 세지 않는다", () => {
    const c = revenueConcentration(
      [sale({ status: "pending" }), sale({ direction: "out" })],
      NAMES
    );
    expect(c.total).toBe(0);
  });

  it("허핀달 지수가 집중을 잡는다", () => {
    const one = revenueConcentration([sale({ amount: 100_000_000 })], NAMES);
    const many = revenueConcentration(
      [
        sale({ partyId: "p1", amount: 10_000_000 }),
        sale({ partyId: "p2", amount: 10_000_000 }),
        sale({ partyId: "p3", amount: 10_000_000 }),
      ],
      NAMES
    );
    expect(one.hhi).toBeCloseTo(1);
    expect(many.hhi!).toBeLessThan(one.hhi!);
  });
});

describe("E4 프로젝트 예상 마진", () => {
  const project: Project = {
    id: "pr1",
    code: "PRJ-0001",
    name: "테스트",
    buCode: null,
    status: "진행",
    budget: 50_000_000,
    startDate: null,
    endDate: null,
  };

  it("계약 − (기투입 + 잔여추정) 이다", () => {
    const [row] = projectMargins(
      [project],
      [sale({ direction: "out", projectId: "pr1", amount: 20_000_000 })],
      new Map([["pr1", 10_000_000]])
    );
    expect(row.spent).toBe(20_000_000);
    expect(row.expectedMargin).toBe(20_000_000);
    expect(row.expectedMarginRate).toBe(40);
  });

  it("잔여 추정이 없으면 계산하지 않고 이유를 남긴다", () => {
    // 시스템이 추정치를 만들면 근거 없는 숫자가 수주 판단에 쓰인다
    const [row] = projectMargins([project], [], new Map());
    expect(row.expectedMargin).toBeNull();
    expect(row.blockedBy).toContain("잔여 원가 추정");
  });

  it("완료된 프로젝트는 잔여가 0 이라 추정을 기다리지 않는다", () => {
    const [row] = projectMargins(
      [{ ...project, status: "완료" }],
      [sale({ direction: "out", projectId: "pr1", amount: 30_000_000 })],
      new Map()
    );
    expect(row.expectedMargin).toBe(20_000_000);
    expect(row.done).toBe(true);
  });

  it("계약 금액이 없으면 그 사실을 말한다", () => {
    const [row] = projectMargins([{ ...project, budget: null }], [], new Map());
    expect(row.blockedBy).toContain("계약 금액");
  });

  it("적자 프로젝트를 진행 중에도 잡는다", () => {
    const [row] = projectMargins(
      [project],
      [sale({ direction: "out", projectId: "pr1", amount: 45_000_000 })],
      new Map([["pr1", 20_000_000]])
    );
    expect(row.expectedMargin).toBeLessThan(0);
  });
});

describe("E7 인당 생산성", () => {
  it("인원으로 나눈다", () => {
    const p = productivity({
      headcount: 10,
      monthlyRevenue: 100_000_000,
      monthlyProfit: 20_000_000,
    });
    expect(p.revenuePerHead).toBe(10_000_000);
    expect(p.profitPerHead).toBe(2_000_000);
    expect(p.blockedBy).toBeNull();
  });

  it("인원수를 모르면 계산하지 않는다", () => {
    // 「대략 몇 명」으로 나눈 숫자가 채용 결정에 쓰이면 안 된다
    const p = productivity({
      headcount: null,
      monthlyRevenue: 100_000_000,
      monthlyProfit: 0,
    });
    expect(p.revenuePerHead).toBeNull();
    expect(p.blockedBy).toContain("인원수");
  });

  it("매출을 모르면 계산하지 않는다", () => {
    const p = productivity({
      headcount: 10,
      monthlyRevenue: null,
      monthlyProfit: null,
    });
    expect(p.revenuePerHead).toBeNull();
    expect(p.blockedBy).toContain("매출");
  });
});
