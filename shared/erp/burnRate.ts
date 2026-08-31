/**
 * §9.6 운영비 · 번레이트 · 런웨이 3종
 *
 *   월 운영비(= 월 번레이트) = 총지출 − (통과원가 + 차입 원금 + 부가세 + 자산 취득)
 *   월 번레이트 = **마감된 월의** 운영비. 추정으로 만들지 않는다.
 *   2개월 이상 마감되면 이동평균으로 전환.
 *
 *   단순런웨이 = 보유현금 ÷ 월 번레이트
 *   예상런웨이 = 13주 예측 잔액이 음수가 되는 시점
 *   예약런웨이 = (보유현금 − 승인대기 확정지출) ÷ 월 번레이트
 *
 * 마감된 월이 0이거나 급여 실액이 미확정이면 세 값 모두 null이고,
 * 라벨 없이 "런웨이"라고 쓰지 않는다 (원칙 3 · T15).
 */
import { isOpex } from "./accounts.js";
import type { Entry, Metric, Period } from "./types.js";

export interface OpexBreakdown {
  /** 운영비에 들어간 확정 지출 */
  opex: { amount: number; count: number; codes: string[] };
  /** 받아야 나가는 돈 — 운영비 아님 */
  passThrough: { amount: number; count: number; codes: string[] };
  /** 차입 원금 · 자산 취득 · 부가세 — 운영비 아님 */
  nonOperating: { amount: number; count: number; codes: string[] };
  /** 금액이 확정되지 않아 어느 쪽에도 못 넣은 건 */
  undecided: { count: number; codes: string[] };
}

export function opexBreakdown(
  entries: Entry[],
  from?: string,
  to?: string
): OpexBreakdown {
  const scoped = entries.filter(e => {
    if (e.direction !== "out") return false;
    const date = e.cashDate ?? e.accrualDate;
    if (from && (!date || date < from)) return false;
    if (to && (!date || date > to)) return false;
    return true;
  });

  const opex = { amount: 0, count: 0, codes: [] as string[] };
  const passThrough = { amount: 0, count: 0, codes: [] as string[] };
  const nonOperating = { amount: 0, count: 0, codes: [] as string[] };
  const undecided = { count: 0, codes: [] as string[] };

  for (const entry of scoped) {
    if (entry.status === "undecided" || entry.amount == null) {
      if (entry.status === "undecided") {
        undecided.count += 1;
        undecided.codes.push(entry.code);
      }
      continue;
    }
    if (entry.status !== "confirmed") continue; // 원칙 7
    const bucket = isOpex(entry)
      ? opex
      : entry.nature === "통과원가"
        ? passThrough
        : nonOperating;
    bucket.amount += entry.amount;
    bucket.count += 1;
    bucket.codes.push(entry.code);
  }
  return { opex, passThrough, nonOperating, undecided };
}

export interface BurnCondition {
  n: number;
  label: string;
  met: boolean;
  current: string;
  owner: string;
}

export interface RunwaySet {
  burnRate: Metric;
  /** 확정 운영비만으로 계산한 하한 — 반드시 「하한」 라벨을 붙인다 */
  lowerBoundMonthlyOpex: number;
  simple: Metric;
  expected: Metric;
  reserved: Metric;
  reservedDeductions: {
    pendingApproval: number;
    taxPayable: number | null;
  };
  conditions: BurnCondition[];
  conditionsMet: number;
}

export interface RunwayInput {
  entries: Entry[];
  periods: Period[];
  cashOnHand: number | null;
  /** B1 급여 실액 (월 총액) */
  payrollMonthly: number | null;
  /** 구독 원장 등록 여부 */
  subscriptionsRegistered: boolean;
  /**
   * 예수금 + 미지급세금 잔액 — 이미 확정된 유출이므로 예약런웨이에서 뺀다.
   * 모르면 0 이 아니라 undefined 로 두고, 화면에 「반영 안 됨」을 표시한다.
   */
  taxPayable?: number | null;
  /** 차입 이자 월액 — 약정서 확인분 */
  debtMonthlyInterest: number | null;
  /** §9.5에서 나온 예상런웨이 (주) */
  expectedRunwayWeeks: number | null;
}

export function buildRunway(input: RunwayInput): RunwaySet {
  const closed = input.periods.filter(p => p.status === "closed");
  const breakdown = opexBreakdown(input.entries);

  const attributionMissing = input.entries.filter(
    e => e.nature === "통과원가" && e.projectId == null
  ).length;
  const undecidedCount = input.entries.filter(
    e => e.status === "undecided"
  ).length;

  const conditions: BurnCondition[] = [
    {
      n: 1,
      label: "마감된 월 1개",
      met: closed.length >= 1,
      current: `${closed.length}개월`,
      owner: "재무",
    },
    {
      n: 2,
      label: "해당 월 판정 대기 0건",
      met: undecidedCount === 0,
      current: `${undecidedCount}건`,
      owner: "입력자·재무",
    },
    {
      n: 3,
      label: "급여 실액 (B1)",
      met: input.payrollMonthly != null,
      current: input.payrollMonthly == null ? "미확인" : "확인",
      owner: "대표",
    },
    {
      n: 4,
      label: "차입 이자 월액 (B2)",
      met: input.debtMonthlyInterest != null,
      current: input.debtMonthlyInterest == null ? "미확인" : "확인",
      owner: "재무",
    },
    {
      n: 5,
      label: "통과원가 전건 프로젝트 귀속",
      met: attributionMissing === 0,
      current: `${attributionMissing}건 미지정`,
      owner: "사업부",
    },
    {
      n: 6,
      label: "구독 목록 등록",
      met: input.subscriptionsRegistered,
      current: input.subscriptionsRegistered ? "등록" : "없음",
      owner: "재무",
    },
  ];

  const blockedBy = conditions
    .filter(c => !c.met)
    .map(c => `${c.label} (${c.current})`);
  const met = conditions.filter(c => c.met).length;

  // 마감된 월이 없으면 분모가 없다. 추정으로 만들지 않는다.
  const monthlyBurn: number | null =
    closed.length === 0 || input.payrollMonthly == null
      ? null
      : Math.round(
          closed
            .map(
              p =>
                opexBreakdown(input.entries, `${p.ym}-01`, `${p.ym}-31`).opex
                  .amount
            )
            .reduce((a, b) => a + b, 0) / closed.length
        );

  const metric = (
    label: string,
    value: number | null,
    nullReason: string
  ): Metric => ({
    value,
    label,
    confidence: value == null ? "N" : "확정",
    nullReason: value == null ? nullReason : null,
    blockedBy: value == null ? blockedBy : [],
  });

  const reservedPending = input.entries
    .filter(
      e =>
        e.direction === "out" &&
        e.status === "pending" &&
        e.amount != null &&
        e.paidAt == null
    )
    .reduce((acc, e) => acc + (e.amount ?? 0), 0);

  const simpleValue =
    monthlyBurn && monthlyBurn > 0 && input.cashOnHand != null
      ? Number((input.cashOnHand / monthlyBurn).toFixed(2))
      : null;
  /**
   * 이미 확정된 유출 — 예수금과 미지급세금.
   *
   * 승인 대기만 빼면 「다음 달 납부할 부가세·원천세」가 안 보인다.
   * 그건 결정을 기다리는 돈이 아니라 이미 남의 돈이다 (docs/erp-qa.md C1).
   */
  const taxPayable = input.taxPayable ?? 0;

  const reservedValue =
    monthlyBurn && monthlyBurn > 0 && input.cashOnHand != null
      ? Number(
          (
            (input.cashOnHand - reservedPending - taxPayable) /
            monthlyBurn
          ).toFixed(2)
        )
      : null;

  return {
    burnRate: metric("월 번레이트", monthlyBurn, "burn_rate_unavailable"),
    lowerBoundMonthlyOpex: breakdown.opex.amount,
    simple: metric("단순런웨이", simpleValue, "burn_rate_unavailable"),
    expected: {
      value: input.expectedRunwayWeeks,
      label: "예상런웨이",
      confidence: input.expectedRunwayWeeks == null ? "N" : "추정",
      nullReason:
        input.expectedRunwayWeeks == null
          ? "13주 예측 잔액을 시작할 수 없습니다"
          : null,
      blockedBy: input.expectedRunwayWeeks == null ? blockedBy : [],
    },
    reserved: metric("예약런웨이", reservedValue, "burn_rate_unavailable"),
    /** 예약런웨이가 무엇을 뺐는지 — 숫자만 주면 왜 줄었는지 알 수 없다 */
    reservedDeductions: {
      pendingApproval: reservedPending,
      taxPayable: input.taxPayable ?? null,
    },
    conditions,
    conditionsMet: met,
  };
}
