/**
 * §9.3 채권 · 입금예정일
 *
 *   미수      = entry[in, invoice_issued = true, 미입금]   // 원칙 4
 *   발행 대기 = entry[in, invoice_issued = false, 미입금]   // 미수 아님 — 별도 목록
 *
 *   due_date = invoice_date + contract.payment_terms.days   // 손으로 넣지 않는다
 *   contract 미등록 → due_date = null · 화면에 "계약서 확인"
 *   D-day = today − due_date       (+n = n일 연체)
 *   DSO   = Σ(미수 잔액 × 경과일) ÷ Σ 미수 잔액              // 발행분만
 */
import type { Contract, Entry, Party } from "./types.js";

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000
  );
}

export function addDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** 미입금 — 실제로 돈이 들어온 날이 없는 수입 건 */
export function isUncollected(entry: Entry): boolean {
  return (
    entry.direction === "in" && entry.paidAt == null && entry.cashDate == null
  );
}

export interface ReceivableLine {
  entry: Entry;
  partyName: string;
  /** 자동 산출된 입금예정일. 계약이 없으면 null */
  dueDate: string | null;
  /** null 사유 — "계약 미등록" · "계산서 발행일 없음" */
  dueDateBlockedBy: string | null;
  /** + = 연체 일수, − = 남은 일수, null = 산출 불가 */
  dDay: number | null;
  /** 계산서 발행 후 경과일 — DSO의 가중치 */
  agingDays: number | null;
  status: "연체" | "정상" | "산출 불가";
}

export interface ArReport {
  today: string;
  /** 계산서가 발행된 미입금 건만 채권이다 (원칙 4) */
  receivables: ReceivableLine[];
  receivableTotal: number;
  /** 발행 전 — 채권이 아니고 DSO에도 들어가지 않는다 */
  pendingIssue: ReceivableLine[];
  pendingIssueTotal: number;
  /** 금액을 판별할 수 없어 어느 합계에도 없는 건 */
  pendingIssueUndecided: number;
  /** 발행분만. 분모가 0이면 null */
  dso: number | null;
  dsoNullReason: string | null;
  /** DSO에 실제로 반영된 건 — 계산서 발행일이 있는 건만 */
  dsoBasis: { n: number; of: number; amount: number };
  overdue: ReceivableLine[];
  blockers: string[];
}

function buildLine(
  entry: Entry,
  parties: Party[],
  contracts: Contract[],
  today: string
): ReceivableLine {
  const partyName =
    parties.find(p => p.id === entry.partyId)?.name ?? entry.title;
  const contract = contracts.find(c => c.id === entry.contractId) ?? null;

  let dueDate: string | null = entry.dueDate;
  let blocked: string | null = null;
  if (dueDate == null) {
    if (!contract) blocked = "계약 미등록";
    else if (contract.paymentTermsDays == null) blocked = "결제조건 미확인";
    else if (!entry.invoiceDate) blocked = "계산서 발행일 없음";
    else dueDate = addDays(entry.invoiceDate, contract.paymentTermsDays);
  }

  const dDay = dueDate ? daysBetween(dueDate, today) : null;
  const agingDays = entry.invoiceDate
    ? daysBetween(entry.invoiceDate, today)
    : null;
  return {
    entry,
    partyName,
    dueDate,
    dueDateBlockedBy: dueDate ? null : blocked,
    dDay,
    agingDays,
    status: dDay == null ? "산출 불가" : dDay > 0 ? "연체" : "정상",
  };
}

export function buildArReport(
  entries: Entry[],
  parties: Party[],
  contracts: Contract[],
  today: string
): ArReport {
  const uncollected = entries.filter(isUncollected);
  const issued = uncollected.filter(e => e.invoiceIssued === true);
  const notIssued = uncollected.filter(e => e.invoiceIssued !== true);

  const receivables = issued.map(e => buildLine(e, parties, contracts, today));
  const pendingIssue = notIssued.map(e =>
    buildLine(e, parties, contracts, today)
  );

  const receivableTotal = receivables.reduce(
    (acc, l) => acc + (l.entry.amount ?? 0),
    0
  );
  const pendingIssueTotal = pendingIssue.reduce(
    (acc, l) => acc + (l.entry.amount ?? 0),
    0
  );

  // DSO는 발행분만. 경과일을 모르는 건은 분자·분모 양쪽에서 빠진다 (원칙 8).
  const weighted = receivables.filter(
    l => l.entry.amount != null && l.agingDays != null
  );
  const denominator = weighted.reduce(
    (acc, l) => acc + (l.entry.amount ?? 0),
    0
  );
  const numerator = weighted.reduce(
    (acc, l) => acc + (l.entry.amount ?? 0) * (l.agingDays ?? 0),
    0
  );

  const blockers: string[] = [];
  for (const line of receivables) {
    if (line.dueDateBlockedBy)
      blockers.push(`${line.partyName} — ${line.dueDateBlockedBy}`);
  }

  return {
    today,
    receivables,
    receivableTotal,
    pendingIssue,
    pendingIssueTotal,
    pendingIssueUndecided: pendingIssue.filter(l => l.entry.amount == null)
      .length,
    dso: denominator > 0 ? Math.round(numerator / denominator) : null,
    dsoNullReason:
      denominator > 0 ? null : "발행된 미수 건의 계산서 발행일이 없습니다",
    dsoBasis: {
      n: weighted.length,
      of: receivables.length,
      amount: denominator,
    },
    overdue: receivables.filter(l => l.status === "연체"),
    blockers,
  };
}
