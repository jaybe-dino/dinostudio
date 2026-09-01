/**
 * 부가세 — 공급대가에서 공급가액과 매입세액을 나눈다.
 *
 * 왜 필요한가. 지금까지 전표는 공급대가 전액을 비용으로 잡았다. 그러면
 *   · 손익이 매입세액만큼 과대계상된다
 *   · 부가세 신고 시 매입세액을 원장에서 집계할 수 없다
 *   · 재무상태표의 부가세대급금·예수부가세가 영원히 0이다
 * 세 가지가 동시에 틀린다. (docs/erp-qa.md A1)
 *
 * 분리 조건은 두 개가 모두 참일 때다 —
 *   ① 계정과목이 과세 대상이다 (급여·이자·차입은 아니다)
 *   ② 적격증빙이 붙어 있다 (세금계산서·카드전표·현금영수증)
 * 하나라도 아니면 분리하지 않는다. 없는 세액을 만들어 내면 신고가 틀린다.
 *
 * ※ 계정별 과세 구분은 세무대리인 확인이 필요하다 — docs/erp-qa.md B1 · B3.
 */
import { VAT_RATE } from "./evidence.js";
import { findAccount } from "./accounts.js";

/**
 * 계정과목의 부가세 성격.
 *   taxable   — 과세. 적격증빙이 있으면 매입세액을 분리한다
 *   exempt    — 면세. 세액이 애초에 없다 (이자·교육·일부 용역)
 *   excluded  — 과세지만 매입세액 불공제. 세액을 분리하지 않고 비용에 포함한다
 *               (여비교통비·접대비·비영업용 승용차)
 *   none      — 부가세와 무관 (급여·차입 원금·세금과공과·자본)
 */
export type VatClass = "taxable" | "exempt" | "excluded" | "none";

/**
 * 계정별 부가세 구분.
 * 여기 없는 계정은 none 으로 본다 — 모르면 분리하지 않는 편이 안전하다.
 */
export const ACCOUNT_VAT_CLASS: Record<string, VatClass> = {
  // 매출 — 예수부가세가 발생한다
  "4100": "taxable",
  "4200": "taxable",
  "4300": "taxable",
  // 매출원가 · 판관비 — 매입세액
  "5140": "taxable",
  "5210": "taxable",
  "5220": "taxable",
  "5310": "taxable",
  "6210": "taxable",
  "6310": "taxable",
  "6320": "taxable",
  "6410": "taxable",
  "6420": "taxable",
  // 여객운송(항공·철도·택시)은 세금계산서를 받아도 매입세액 불공제다
  "6510": "excluded",
  "8120": "taxable",
  // 자산도 매입세액 공제 대상이다
  "1210": "taxable",
  // 인건비 · 이자 · 세금 — 부가세와 무관하거나 면세
  "6110": "none",
  "6120": "none",
  "6130": "none",
  "6140": "none",
  "6520": "none",
  "6530": "none",
  "7110": "exempt",
  "8110": "exempt",
  "1310": "none",
  "1110": "none",
  "1450": "none",
  "2120": "none",
  "2130": "none",
  "2140": "none",
  "2210": "none",
  "2310": "none",
  "3100": "none",
  // 미분류는 판정 자체가 안 된 것이다 — 세액을 만들지 않는다
  "9900": "none",
};

export function vatClassOf(accountCode: string | null | undefined): VatClass {
  if (!accountCode) return "none";
  return ACCOUNT_VAT_CLASS[accountCode] ?? "none";
}

/** 매입세액 공제가 되는 계정인가 (증빙과 별개로 계정 자체의 성격) */
export function accountAllowsVatDeduction(
  accountCode: string | null | undefined
): boolean {
  return vatClassOf(accountCode) === "taxable";
}

export interface VatSplit {
  /** 공급가액 — 비용·자산·수익으로 가는 금액 */
  supply: number;
  /** 세액 — 부가세대급금(매입) 또는 예수부가세(매출)로 가는 금액 */
  vat: number;
  /** 분리하지 않았다면 그 이유 */
  reason: string | null;
}

/**
 * 공급대가(실제 주고받은 금액)를 공급가액과 세액으로 나눈다.
 *
 * 세액 = 공급대가 × 10/110. 원 단위 절사가 아니라 반올림을 쓴다 —
 * 공급가액 + 세액이 공급대가와 정확히 같아야 분개가 균형을 잃지 않는다.
 */
export function splitVat(input: {
  amount: number;
  accountCode: string | null | undefined;
  /** 세금계산서·카드전표·현금영수증이 붙어 있는가 */
  hasQualifiedEvidence: boolean;
  /** 통과원가는 우리 매출·매입이 아니다 */
  isPassThrough?: boolean;
}): VatSplit {
  const none = (reason: string): VatSplit => ({
    supply: input.amount,
    vat: 0,
    reason,
  });

  if (input.amount === 0) return none("금액이 0입니다");
  if (input.isPassThrough) return none("통과원가는 우리 세액이 아닙니다");

  const klass = vatClassOf(input.accountCode);
  if (klass === "none") return none("부가세와 무관한 계정입니다");
  if (klass === "exempt") return none("면세 거래로 세액이 없습니다");
  if (klass === "excluded")
    return none("매입세액 불공제 계정입니다 (여객운송 등)");
  if (!input.hasQualifiedEvidence)
    return none("적격증빙이 없어 매입세액을 분리할 수 없습니다");

  // 음수(취소 전표)도 같은 비율로 나눈다 — 원본과 대칭이어야 상계된다
  const sign = input.amount < 0 ? -1 : 1;
  const gross = Math.abs(input.amount);
  const vat = Math.round((gross * VAT_RATE) / (1 + VAT_RATE));
  return { supply: sign * (gross - vat), vat: sign * vat, reason: null };
}

/** 매입세액 계정 */
export const VAT_INPUT_ACCOUNT = "1450";
/** 매출세액 계정 */
export const VAT_OUTPUT_ACCOUNT = "2130";

/** 이 계정이 존재하는지 — 마스터가 바뀌면 분개가 조용히 깨지므로 확인한다 */
export function vatAccountsPresent(): boolean {
  return (
    findAccount(VAT_INPUT_ACCOUNT) != null &&
    findAccount(VAT_OUTPUT_ACCOUNT) != null
  );
}

/** 부가세를 상계한 뒤 실제로 낼 금액이 앉는 계정 */
export const TAX_PAYABLE_ACCOUNT = "2150";

/** 부가세 과세기간 — 1기 예정·확정, 2기 예정·확정 */
export interface VatPeriod {
  label: string;
  from: string;
  to: string;
  /** 신고·납부 기한 */
  dueDate: string;
}

/**
 * 그 해의 부가세 과세기간 4개.
 * 법인은 예정신고(4월·10월)와 확정신고(7월·1월)를 한다.
 */
export function vatPeriods(year: number): VatPeriod[] {
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    {
      label: `${year}년 1기 예정`,
      from: `${year}-01-01`,
      to: `${year}-03-31`,
      dueDate: `${year}-04-25`,
    },
    {
      label: `${year}년 1기 확정`,
      from: `${year}-04-01`,
      to: `${year}-06-30`,
      dueDate: `${year}-07-25`,
    },
    {
      label: `${year}년 2기 예정`,
      from: `${year}-07-01`,
      to: `${year}-09-30`,
      dueDate: `${year}-10-25`,
    },
    {
      label: `${year}년 2기 확정`,
      from: `${year}-10-01`,
      to: `${year}-12-31`,
      // 확정신고 기한은 다음 해 1월 25일이다
      dueDate: `${year + 1}-01-${pad(25)}`,
    },
  ];
}

/** 지금 날짜가 속한 과세기간 */
export function vatPeriodOf(date: string): VatPeriod | null {
  const year = Number(date.slice(0, 4));
  return vatPeriods(year).find(p => date >= p.from && date <= p.to) ?? null;
}

export interface VatSettlement {
  period: VatPeriod;
  /** 매출세액 — 예수부가세 대변 잔액 */
  output: number;
  /** 매입세액 — 부가세대급금 차변 잔액 */
  input: number;
  /** 낼 돈. 음수면 환급이다 */
  payable: number;
  /** 환급 상황인가 — 낼 돈과 받을 돈은 성격이 다르므로 구분한다 */
  isRefund: boolean;
}

/**
 * 과세기간의 부가세 정산 (docs/erp-qa.md B7).
 *
 * 신고 시 매출세액에서 매입세액을 빼고 차액만 납부한다. 두 계정을 상계하지 않으면
 * 재무상태표에 예수부가세와 부가세대급금이 양쪽에 그대로 남아, 실제로 낼 돈이 얼마인지
 * 어디에도 없다.
 */
export function settleVat(
  period: VatPeriod,
  journalLines: {
    accountCode: string;
    debit: number;
    credit: number;
    journalDate: string;
  }[]
): VatSettlement {
  const inRange = journalLines.filter(
    l => l.journalDate >= period.from && l.journalDate <= period.to
  );
  const balance = (code: string, side: "credit" | "debit") =>
    inRange
      .filter(l => l.accountCode === code)
      .reduce(
        (sum, l) =>
          sum + (side === "credit" ? l.credit - l.debit : l.debit - l.credit),
        0
      );

  const output = balance(VAT_OUTPUT_ACCOUNT, "credit");
  const input = balance(VAT_INPUT_ACCOUNT, "debit");
  const payable = output - input;
  return { period, output, input, payable, isRefund: payable < 0 };
}
