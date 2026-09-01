/**
 * 세무 일정 · 세금계산서 발행 관리 (docs/erp-qa.md B4 · B5 · B10)
 *
 * 놓치면 가산세가 붙는 것만 담는다. 「알아두면 좋은 것」은 넣지 않는다 —
 * 캘린더가 길어지면 아무도 안 본다.
 *
 * ※ 기한과 대상은 세무대리인 확인이 필요하다. 회사 형태·규모에 따라 달라진다.
 */
import { kstToday } from "./time.js";
import { withholdingDueDate } from "./withholding.js";
import type { Entry } from "./types.js";

/** 세금계산서 발행 상태 */
export type InvoiceStatus = "발행완료" | "발행대기" | "기한임박" | "기한초과";

/**
 * 세금계산서 발행 기한 — 공급일이 속한 달의 다음 달 10일 (B4).
 * 이 날을 넘기면 지연발행 가산세가 붙는다.
 */
export function invoiceDueDate(supplyDate: string): string {
  const [year, month] = supplyDate.split("-").map(Number);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-10`;
}

/** 기한임박으로 볼 남은 일수 */
export const INVOICE_WARN_DAYS = 5;

export interface InvoiceObligation {
  code: string;
  title: string;
  amount: number | null;
  /** 공급일 — 발행 기한의 기준 */
  supplyDate: string;
  dueDate: string;
  status: InvoiceStatus;
  /** 기한까지 남은 일수. 음수면 넘겼다 */
  daysLeft: number;
  invoiceNo: string | null;
}

function daysBetween(from: string, to: string): number {
  const ms =
    new Date(`${to}T00:00:00+09:00`).getTime() -
    new Date(`${from}T00:00:00+09:00`).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * 우리가 발행해야 하는 세금계산서 (B4).
 *
 * 지금까지 시스템은 **받는 계산서**만 다뤘다. 발행 쪽이 없으면 매출세액 신고 근거가
 * 원장에 없고, 누락해도 아무도 모른다.
 *
 * 매출 건 중 아직 발행하지 않은 것을 기한과 함께 돌려준다.
 */
export function invoiceObligations(
  entries: Entry[],
  today: string = kstToday()
): InvoiceObligation[] {
  return entries
    .filter(
      e =>
        e.direction === "in" &&
        (e.status === "confirmed" || e.status === "pending") &&
        // 발행 의무는 공급일이 있어야 생긴다
        (e.accrualDate ?? e.cashDate) != null
    )
    .map(e => {
      const supplyDate = (e.accrualDate ?? e.cashDate)!;
      const dueDate = invoiceDueDate(supplyDate);
      const daysLeft = daysBetween(today, dueDate);
      const issued = e.invoiceIssued === true;
      const status: InvoiceStatus = issued
        ? "발행완료"
        : daysLeft < 0
          ? "기한초과"
          : daysLeft <= INVOICE_WARN_DAYS
            ? "기한임박"
            : "발행대기";
      return {
        code: e.code,
        title: e.title || e.noteRaw || e.code,
        amount: e.amount,
        supplyDate,
        dueDate,
        status,
        daysLeft,
        invoiceNo: e.invoiceNo,
      };
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export type TaxKind = "부가세" | "원천세" | "법인세" | "지급명세서" | "4대보험";

export interface TaxDeadline {
  kind: TaxKind;
  label: string;
  dueDate: string;
  /** 남은 일수. 음수면 지났다 */
  daysLeft: number;
  /** 왜 중요한가 — 놓쳤을 때 무슨 일이 생기나 */
  penalty: string;
  /** 지금 시스템이 아는 금액. 모르면 null */
  amount: number | null;
}

/**
 * 신고·납부 캘린더 (B5 · B10).
 *
 * 금액을 아는 것은 붙여서 주고, 모르는 것은 null 로 둔다 —
 * 0 으로 채우면 「낼 게 없다」로 읽힌다.
 */
export function taxCalendar(
  input: {
    /** 예수금 잔액 — 원천세 납부액 */
    withholdingPayable: number | null;
    /** 이번 과세기간 부가세 납부 예상액 */
    vatPayable: number | null;
    /** 마지막 급여 지급일 — 원천세 기한의 기준 */
    lastPayrollDate: string | null;
  },
  today: string = kstToday()
): TaxDeadline[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const pad = (n: number) => String(n).padStart(2, "0");
  const daysLeft = (due: string) => daysBetween(today, due);

  const deadlines: TaxDeadline[] = [];

  // 원천세 — 지급월 다음 달 10일
  const payrollBase = input.lastPayrollDate ?? `${year}-${pad(month)}-01`;
  const withholdingDue = withholdingDueDate(payrollBase);
  deadlines.push({
    kind: "원천세",
    label: "원천세 납부 (지급월 다음 달 10일)",
    dueDate: withholdingDue,
    daysLeft: daysLeft(withholdingDue),
    penalty: "미납 시 납부불성실 가산세",
    amount: input.withholdingPayable,
  });

  // 4대보험 — 매월 10일
  const insuranceDue = `${year}-${pad(month)}-10`;
  deadlines.push({
    kind: "4대보험",
    label: "4대보험 납부 (매월 10일)",
    dueDate: insuranceDue,
    daysLeft: daysLeft(insuranceDue),
    penalty: "연체금 부과",
    amount: null,
  });

  // 부가세 — 1·4·7·10월 25일
  const vatMonths = [1, 4, 7, 10];
  const nextVatMonth = vatMonths.find(m => m >= month) ?? vatMonths[0];
  const vatYear = nextVatMonth >= month ? year : year + 1;
  const vatDue = `${vatYear}-${pad(nextVatMonth)}-25`;
  deadlines.push({
    kind: "부가세",
    label: "부가세 신고·납부",
    dueDate: vatDue,
    daysLeft: daysLeft(vatDue),
    penalty: "무신고 가산세 20% · 납부불성실 가산세",
    amount: input.vatPayable,
  });

  // 지급명세서 — 사업소득·기타소득은 다음 해 2월 말
  const statementDue = `${year + (month > 2 ? 1 : 0)}-02-28`;
  deadlines.push({
    kind: "지급명세서",
    label: "지급명세서 제출 (사업·기타소득)",
    dueDate: statementDue,
    daysLeft: daysLeft(statementDue),
    penalty: "미제출 가산세 1%",
    amount: null,
  });

  // 법인세 — 사업연도 종료 후 3개월. 12월 결산 기준 3월 31일
  const corporateDue = `${year + (month > 3 ? 1 : 0)}-03-31`;
  deadlines.push({
    kind: "법인세",
    label: "법인세 신고·납부 (12월 결산 기준)",
    dueDate: corporateDue,
    daysLeft: daysLeft(corporateDue),
    penalty: "무신고 가산세 20%",
    amount: null,
  });

  return deadlines.sort((a, b) => a.daysLeft - b.daysLeft);
}

/** 며칠 안쪽을 「임박」으로 볼 것인가 */
export const DEADLINE_WARN_DAYS = 7;
