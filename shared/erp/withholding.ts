/**
 * 원천징수 — 예수금 (docs/erp-qa.md A2)
 *
 * 지금까지 전표는 지급액과 비용을 같게 잡았다. 그러면 **다음 달 납부할 예수금이
 * 재무제표에 안 보인다.** 외주비 1,000,000을 3.3% 떼고 967,000 보냈다면
 * 비용은 1,000,000이고 33,000은 우리가 대신 갖고 있다가 다음 달 10일에 납부한다.
 * 예수금을 잡지 않으면 그 33,000이 어디에도 없다.
 *
 * **원장은 통장에서 나온다** — 그래서 amount 는 실지급액(net)이다.
 * 총액은 실지급액에서 역산한다: 총액 = 실지급액 ÷ (1 − 세율).
 * 반대로 계약서 금액(총액)을 아는 경우는 mode 로 구분한다.
 *
 * ※ 근로소득은 간이세액표를 따르므로 비율로 계산하지 않는다 — 실액을 받는다.
 * ※ 세율은 세무대리인 확인이 필요하다 (docs/erp-qa.md B9).
 */

/** 지급 대상의 소득 구분 — 원천징수율과 신고서가 여기서 갈린다 */
export type IncomeType = "사업소득" | "기타소득" | "근로소득";

/**
 * 원천징수율 (지방소득세 포함).
 *   사업소득 3.3% = 소득세 3% + 지방소득세 0.3%
 *   기타소득 8.8% = 소득세 8% + 지방소득세 0.8% (필요경비 60% 인정 기준)
 */
export const WITHHOLDING_RATE: Record<IncomeType, number | null> = {
  사업소득: 0.033,
  기타소득: 0.088,
  // 간이세액표를 따르므로 비율이 없다 — 실액을 받아야 한다
  근로소득: null,
};

/** 예수금 계정 — 원천세 */
export const WITHHOLDING_PAYABLE_ACCOUNT = "2131";
/** 예수금 계정 — 4대보험 근로자 부담분 */
export const INSURANCE_PAYABLE_ACCOUNT = "2132";

export interface WithholdingSplit {
  /** 비용으로 잡히는 총액 */
  gross: number;
  /** 실제로 나간 현금 */
  net: number;
  /** 예수금 — 우리가 대신 갖고 있다가 납부하는 금액 */
  withheld: number;
  reason: string | null;
}

/**
 * 원천징수를 분리한다.
 *
 * mode="net"   amount 가 실지급액이다 (통장에서 나온 금액 — 원장의 기본)
 * mode="gross" amount 가 계약 총액이다
 */
export function splitWithholding(input: {
  amount: number;
  incomeType: IncomeType | null | undefined;
  mode?: "net" | "gross";
  /** 근로소득처럼 비율이 없는 경우 직접 받는 원천징수액 */
  withheldOverride?: number | null;
}): WithholdingSplit {
  const none = (reason: string): WithholdingSplit => ({
    gross: input.amount,
    net: input.amount,
    withheld: 0,
    reason,
  });

  if (input.amount === 0) return none("금액이 0입니다");
  if (!input.incomeType) return none("소득 구분이 지정되지 않았습니다");

  const sign = input.amount < 0 ? -1 : 1;
  const magnitude = Math.abs(input.amount);

  if (input.withheldOverride != null) {
    const withheld = Math.abs(input.withheldOverride);
    if (withheld > magnitude && (input.mode ?? "net") === "gross")
      return none("원천징수액이 총액보다 큽니다 — 입력을 확인하십시오");
    const gross =
      (input.mode ?? "net") === "net" ? magnitude + withheld : magnitude;
    return {
      gross: sign * gross,
      net: sign * (gross - withheld),
      withheld: sign * withheld,
      reason: null,
    };
  }

  const rate = WITHHOLDING_RATE[input.incomeType];
  if (rate == null)
    return none(
      `${input.incomeType}은 간이세액표를 따릅니다 — 원천징수액을 직접 입력해야 합니다`
    );

  if ((input.mode ?? "net") === "gross") {
    const withheld = Math.round(magnitude * rate);
    return {
      gross: sign * magnitude,
      net: sign * (magnitude - withheld),
      withheld: sign * withheld,
      reason: null,
    };
  }

  // 실지급액에서 총액을 역산한다. 반올림 뒤에도 net + withheld == gross 가 되도록 맞춘다.
  const gross = Math.round(magnitude / (1 - rate));
  const withheld = gross - magnitude;
  return {
    gross: sign * gross,
    net: sign * magnitude,
    withheld: sign * withheld,
    reason: null,
  };
}

/** 원천세 납부 기한 — 지급월 다음 달 10일 */
export function withholdingDueDate(paidOn: string): string {
  const [year, month] = paidOn.split("-").map(Number);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-10`;
}
