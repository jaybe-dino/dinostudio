/**
 * 2차 · 3차 파생 뷰 검증 — §9.3 채권 · §9.4 부채 · §9.5 13주 · §9.6 번레이트 · §9.7 손익 · §9.8 재무제표
 *
 * §9.7은 "두 계단의 영업이익 일치 검증을 자동 테스트로 두십시오"라고 명시하고 있어 여기 있습니다.
 */
import { SEED_DEBTS, buildForecast, buildPnl, trialBalance } from "@shared/erp";
import { describe, expect, it } from "vitest";
import { LedgerService } from "./service";
import { InMemoryLedgerStore } from "./store";
import type { Actor } from "./service";

const CFO: Actor = { id: "cfo@dinostudio.kr", role: "재무" };
const service = () => new LedgerService(new InMemoryLedgerStore());

describe("§9.3 채권 · 입금예정일", () => {
  it("미수는 계산서 발행분만 — 50,929,608 (3건)", async () => {
    const ar = await service().ar();
    expect(ar.receivableTotal).toBe(50_929_608);
    expect(ar.receivables).toHaveLength(3);
  });

  it("발행 대기는 채권이 아니다 — 127,600,000 (판별 가능분)", async () => {
    const ar = await service().ar();
    expect(ar.pendingIssueTotal).toBe(127_600_000);
    // 줄컴퍼니 중도금은 단위 판별 불가라 어느 합계에도 없다 (원칙 8)
    expect(ar.pendingIssueUndecided).toBe(1);
  });

  it("D-day — 08/20 예정 건은 08/27 기준 +7일 연체", async () => {
    const ar = await service().ar();
    const hardrel = ar.receivables.find(l => l.partyName === "하드렐");
    expect(hardrel?.dDay).toBe(7);
    expect(hardrel?.status).toBe("연체");
    expect(ar.overdue).toHaveLength(2);
  });

  it("계약이 없으면 입금예정일을 손으로 넣지 않고 null + 「계약 미등록」", async () => {
    const ar = await service().ar();
    const collab = ar.receivables.find(l => l.partyName === "콜랩");
    expect(collab?.dueDate).toBeNull();
    expect(collab?.dueDateBlockedBy).toBe("계약 미등록");
  });

  it("DSO는 계산서 발행일이 있는 건만 — 3건 중 1건", async () => {
    const ar = await service().ar();
    expect(ar.dsoBasis).toEqual({ n: 1, of: 3, amount: 27_500_000 });
    expect(ar.dso).toBe(15); // 08/12 발행 → 08/27
  });
});

describe("§9.4 부채 · 만기 알람", () => {
  it("만기가 전건 미확인이라 알람이 하나도 울리지 않는다 (B2)", async () => {
    const report = await service().debt();
    expect(report.maturityUnknown).toBe(5);
    expect(report.lines.every(l => l.firedAlarms.length === 0)).toBe(true);
    expect(report.lines.every(l => l.state === "만기 미확인")).toBe(true);
  });

  it("단기 2.4억 · 장기 7.9억(건별 미분해) · 총 10.3억 · 월 이자 4,750,000", async () => {
    const report = await service().debt();
    expect(report.shortTerm).toBe(240_000_000);
    expect(report.principalUndecomposed).toBe(790_000_000);
    expect(report.total).toBe(1_030_000_000);
    expect(report.monthlyInterest).toBe(4_750_000);
  });

  it("이자보상배율은 영업이익이 없어 계산 불가", async () => {
    const report = await service().debt();
    expect(report.interestCoverage).toBeNull();
    expect(report.interestCoverageNullReason).toContain("영업이익");
  });
});

describe("§9.5 13주 자금계획", () => {
  it("13주 · 성사확률과 상환 라인이 없어 blockers로 노출된다", async () => {
    const forecast = await service().forecast("Base");
    expect(forecast.weeks).toHaveLength(13);
    expect(forecast.blockers.some(b => b.includes("성사 가능성"))).toBe(true);
    expect(forecast.blockers.some(b => b.includes("상환 라인"))).toBe(true);
  });

  it("Stress는 회수 −30% · 지출 +10%", () => {
    const entries = [
      {
        code: "IN-X",
        direction: "in",
        status: "pending",
        amount: 10_000_000,
        invoiceIssued: true,
        cashDate: null,
        paidAt: null,
        dueDate: "2026-08-27",
      },
      {
        code: "EX-X",
        direction: "out",
        status: "confirmed",
        amount: 1_000_000,
        cashDate: "2026-08-27",
        paidAt: null,
        dueDate: "2026-08-27",
      },
    ] as never;
    const base = buildForecast(entries, [], {
      today: "2026-08-27",
      openingCash: 0,
      pipelineProbability: null,
    });
    const stress = buildForecast(entries, [], {
      today: "2026-08-27",
      openingCash: 0,
      scenario: "Stress",
      pipelineProbability: null,
    });
    expect(base.weeks[0].inflow).toBe(10_000_000);
    expect(stress.weeks[0].inflow).toBe(7_000_000);
    expect(stress.weeks[0].outflow).toBe(1_100_000);
  });

  it("보유현금이 없으면 주차 잔액을 시작하지 않는다", () => {
    const result = buildForecast([], [], {
      today: "2026-08-27",
      openingCash: null,
      pipelineProbability: null,
    });
    expect(result.weeks.every(w => w.close === null)).toBe(true);
    expect(result.expectedRunwayWeeks).toBeNull();
  });
});

describe("§9.7 손익 — 두 계단의 영업이익은 반드시 일치한다", () => {
  it("회계 계단 영업이익 == 관리 계단 영업이익", async () => {
    const store = new InMemoryLedgerStore();
    const entries = await store.listEntries();
    const pnl = buildPnl(entries);
    // 다르면 배부 로직이 틀린 것이다 (§9.7)
    expect(pnl.operatingProfitGap).toBe(0);
    expect(pnl.management.operatingProfit).toBe(pnl.accounting.operatingProfit);
  });

  it("관리 계단의 계단 구조가 성립한다", async () => {
    const pnl = (await service().pnl({})).total;
    const m = pnl.management;
    expect(m.netRevenue).toBe(m.grossRevenue - m.passThrough);
    expect(m.contributionProfit).toBe(m.netRevenue - m.directCost);
    expect(m.operatingProfit).toBe(m.contributionProfit - m.commonAllocated);
  });

  it("귀속이 비어 있으면 그 사실이 blockers로 나온다", async () => {
    const pnl = (await service().pnl({})).total;
    expect(pnl.attributionMissing.count).toBeGreaterThan(0);
    expect(pnl.blockers.some(b => b.includes("귀속 미지정"))).toBe(true);
  });
});

describe("§9.6 번레이트 · 런웨이 3종 (T15)", () => {
  it("산출 조건 6개 중 0개 충족 — 세 값 모두 null", async () => {
    const runway = await service().runway();
    expect(runway.conditionsMet).toBe(0);
    expect(runway.burnRate.value).toBeNull();
    expect(runway.simple.value).toBeNull();
    expect(runway.reserved.value).toBeNull();
    for (const metric of [runway.burnRate, runway.simple, runway.reserved]) {
      expect(metric.confidence).toBe("N");
      expect(metric.blockedBy.length).toBeGreaterThan(0);
      expect(metric.label).not.toBe("런웨이"); // 라벨 없이 「런웨이」라 쓰지 않는다 (원칙 3)
    }
  });

  it("운영비 = 총지출 − (통과원가 + 차입 원금 + 부가세 + 자산 취득)", async () => {
    const runway = await service().runway();
    // 통과원가와 재무활동은 운영비에서 빠진다
    expect(runway.opex.passThrough.amount).toBe(770_000);
    expect(runway.opex.nonOperating.amount).toBe(11_500_000); // 차입 원금 상환 2건
    expect(runway.opex.opex.amount).toBe(21_360_000);
    expect(runway.lowerBoundMonthlyOpex).toBe(21_360_000);
  });
});

describe("§9.8 재무제표 5종 · 전표", () => {
  it("확정 건마다 전표가 있고 차변 합 == 대변 합", async () => {
    const { journals, trialBalance: tb } = await service().journals();
    expect(journals.length).toBeGreaterThan(0);
    for (const journal of journals) {
      const debit = journal.lines.reduce((a, l) => a + l.debit, 0);
      const credit = journal.lines.reduce((a, l) => a + l.credit, 0);
      expect(debit).toBe(credit);
    }
    expect(tb.difference).toBe(0);
  });

  it("기초 재무상태표가 없으면 「기초 미설정」 행으로 차액을 그대로 노출한다 (B6)", async () => {
    const fs = await service().financialStatements(null);
    expect(fs.status).toBe("가결산");
    expect(fs.balanceSheet.some(r => r.label === "기초 미설정")).toBe(true);
    expect(fs.blockers.some(b => b.includes("기초 재무상태표"))).toBe(true);
  });

  it("현금흐름표는 3구간으로 나뉘고 차액을 「기타」로 밀어넣지 않는다", async () => {
    const fs = await service().financialStatements(null);
    const labels = fs.cashflowStatement.map(r => r.label);
    expect(labels).toContain("영업활동 현금흐름");
    expect(labels).toContain("투자활동 현금흐름");
    expect(labels).toContain("재무활동 현금흐름");
    expect(labels).toContain("구간 판정 불가");
    expect(labels).not.toContain("기타");
  });
});

describe("월 마감 (T12)", () => {
  it("8월은 blockers 때문에 마감되지 않는다", async () => {
    const svc = service();
    await expect(svc.closePeriod("2026-08", CFO)).rejects.toMatchObject({
      code: "period_closed",
    });
    const periods = (await svc.masters()).periods;
    const august = periods.find(p => p.ym === "2026-08");
    expect(august?.status).toBe("open");
    expect(august?.blockers.some(b => b.includes("V1"))).toBe(true);
    expect(august?.blockers.some(b => b.includes("판정 대기"))).toBe(true);
  });
});

describe("§12 알림", () => {
  it("대표 수신은 하루 3건 상한을 시스템이 강제한다", async () => {
    const result = await service().notifications(CFO);
    const ceoRules = new Set(
      result.rules.filter(r => r.recipients.includes("대표")).map(r => r.id)
    );
    const deliveredToCeo = result.delivered.filter(n => ceoRules.has(n.ruleId));
    expect(deliveredToCeo.length).toBeLessThanOrEqual(3);
  });

  it("도착지가 없어도 알림함에는 남는다 (B7)", async () => {
    const result = await service().notifications(CFO);
    expect(result.delivered.length).toBeGreaterThan(0);
    expect(result.delivered.every(n => n.sentAt === null)).toBe(true);
  });

  it("만기 미확인 차입 규칙은 발동 불가로 표시된다", () => {
    const blocked = SEED_DEBTS.every(d => d.maturityDate == null);
    expect(blocked).toBe(true);
  });
});
