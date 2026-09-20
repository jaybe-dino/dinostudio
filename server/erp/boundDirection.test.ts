/**
 * 「하한」과 「상한」의 방향.
 *
 * 화면에는 「누락 비용을 제외한 런웨이 = 하한」이라고 적혀 있었다. **거꾸로다.**
 * 비용을 덜 세면 분모가 작아져 런웨이는 **길어진다.** 그래서 그 값은 상한이고
 * 실제 런웨이는 그보다 짧다.
 *
 * 「하한」이라고 부르면 「적어도 이만큼은 버틴다」로 읽힌다. 실제로는
 * 「많아야 이만큼」이다 — 이 시스템에서 가장 위험한 오표기다.
 */
import { describe, expect, it } from "vitest";
import { buildRunway } from "../../shared/erp/burnRate.js";
import type { Entry, Period } from "../../shared/erp/types.js";
import type { RunwayInput } from "../../shared/erp/burnRate.js";

/** 이 파일의 관심사는 방향뿐이다 — 나머지는 고정해 둔다 */
const base = (entries: Entry[], cashOnHand: number | null): RunwayInput => ({
  entries,
  periods: [] as Period[],
  cashOnHand,
  payrollMonthly: null,
  subscriptionsRegistered: false,
  taxPayable: null,
  debtMonthlyInterest: null,
  expectedRunwayWeeks: null,
});

const opex = (amount: number, code = "5210"): Entry =>
  ({
    id: `e-${amount}`,
    code: `EX-${amount}`,
    direction: "out",
    status: "confirmed",
    title: "운영비",
    amount,
    amountCandidate: null,
    cashDate: "2026-09-14",
    accrualDate: "2026-09-14",
    accountCode: code,
    nature: "직접원가",
    internalTransferId: null,
    paidAt: null,
    payMethod: "계좌",
    hasEvidence: true,
    isPersonal: false,
    version: 1,
  }) as Entry;

describe("비용을 덜 세면 런웨이는 길어진다", () => {
  it("**확정 운영비로 낸 런웨이는 상한이다** — 실제는 더 짧다", () => {
    const withOnlyKnown = buildRunway(base([opex(10_000_000)], 100_000_000));
    const withMoreCosts = buildRunway(
      base([opex(10_000_000), opex(10_000_001)], 100_000_000)
    );

    expect(withOnlyKnown.upperBoundRunwayMonths).not.toBeNull();
    expect(withMoreCosts.upperBoundRunwayMonths).not.toBeNull();
    // 비용이 더 잡힐수록 런웨이는 **짧아진다** — 그러므로 앞의 값이 상한이다
    expect(withMoreCosts.upperBoundRunwayMonths!).toBeLessThan(
      withOnlyKnown.upperBoundRunwayMonths!
    );
  });

  it("확정 운영비 자체는 **하한**이다 — 빠진 항목이 있으므로 실제는 더 크다", () => {
    const few = buildRunway(base([opex(10_000_000)], 100_000_000));
    const more = buildRunway(
      base([opex(10_000_000), opex(5_000_000)], 100_000_000)
    );
    expect(more.lowerBoundMonthlyOpex).toBeGreaterThan(
      few.lowerBoundMonthlyOpex
    );
  });

  it("보유현금을 모르면 상한도 못 낸다 — 0 이 아니라 모름이다 (원칙 8)", () => {
    const r = buildRunway(base([opex(10_000_000)], null));
    expect(r.upperBoundRunwayMonths).toBeNull();
  });

  it("운영비가 0 이면 나눌 수 없다 — 무한대를 내지 않는다", () => {
    const r = buildRunway(base([], 100_000_000));
    expect(r.upperBoundRunwayMonths).toBeNull();
  });
});
