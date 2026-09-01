/**
 * 전표 · 분개장 — 원장이 확정되는 순간 자동 생성된다. 사람이 분개를 만들지 않는다 (원칙 12).
 * 사양서는 3차로 잡았지만 인수 기준 T1 ⑤가 1차에서 전표 1건 생성을 요구한다.
 */
import {
  PAYABLE_ACCOUNT,
  RECEIVABLE_ACCOUNT,
  counterAccountFor,
  findAccount,
} from "./accounts.js";

/** 이자비용 계정 — 상환에서 원금과 나뉜다 */
const INTEREST_EXPENSE_ACCOUNT = "8110";
import { VAT_INPUT_ACCOUNT, VAT_OUTPUT_ACCOUNT, splitVat } from "./vat.js";
import {
  WITHHOLDING_PAYABLE_ACCOUNT,
  splitWithholding,
} from "./withholding.js";
import type { Entry, Journal, JournalLine } from "./types.js";

export interface IdFactory {
  (): string;
}

/**
 * 지출: 비용·자산 차변 · 현금(또는 카드미지급금) 대변
 * 수입: 현금 차변 · 수익·부채 대변
 *
 * 과세 건에 적격증빙이 붙어 있으면 세액을 분리해 3줄이 된다 —
 *   지출: 비용(공급가액) + 부가세대급금(세액) / 현금(공급대가)
 *   수입: 현금(공급대가) / 수익(공급가액) + 예수부가세(세액)
 * 어느 경우에도 차변 합 == 대변 합이다 (assertBalanced 로 강제한다).
 */
export function buildJournal(
  entry: Entry,
  newId: IdFactory,
  /**
   * 적격증빙(세금계산서·카드전표·현금영수증)이 붙어 있는가.
   * 전표를 만드는 시점에만 알 수 있으므로 서비스가 넘겨 준다.
   * 기본값을 false 로 두어, 모르면 세액을 만들지 않는다.
   */
  options: { hasQualifiedEvidence?: boolean } = {}
): Journal | null {
  if (entry.amount == null || !entry.accountCode) return null;
  const journalId = newId();
  const counter = counterAccountFor(entry.payMethod);
  const amount = entry.amount; // 취소 전표(-C)는 음수 그대로 상계된다
  const outward = entry.direction === "out";

  const split = splitVat({
    amount,
    accountCode: entry.accountCode,
    hasQualifiedEvidence: options.hasQualifiedEvidence ?? false,
  });

  const line = (
    accountCode: string,
    debit: number,
    credit: number
  ): JournalLine => ({
    id: newId(),
    journalId,
    accountCode,
    debit,
    credit,
    buCode: entry.buCode,
    projectId: entry.projectId,
  });

  /**
   * 원천징수 — 지급액과 비용이 다르다.
   * amount 는 실제로 나간 현금(net)이므로 총액을 역산해 비용에 잡고,
   * 차액을 예수금으로 남긴다. 예수금을 잡지 않으면 다음 달 납부액이 어디에도 없다.
   */
  const withholding = splitWithholding({
    amount,
    incomeType: entry.incomeType,
    mode: "net",
    withheldOverride: entry.withheldAmount ?? null,
  });

  const lines: JournalLine[] = [];
  if (outward) {
    if (withholding.withheld !== 0) {
      // 비용은 총액 · 현금은 실지급액 · 차액은 예수금
      // (원천징수 건은 부가세 대상이 아니므로 세액 분리와 겹치지 않는다)
      lines.push(line(entry.accountCode, withholding.gross, 0));
      lines.push(line(WITHHOLDING_PAYABLE_ACCOUNT, 0, withholding.withheld));
      lines.push(line(counter, 0, amount));
    } else {
      // 비용·자산은 공급가액만, 세액은 자산(부가세대급금)으로 따로
      lines.push(line(entry.accountCode, split.supply, 0));
      if (split.vat !== 0) lines.push(line(VAT_INPUT_ACCOUNT, split.vat, 0));
      lines.push(line(counter, 0, amount));
    }
  } else {
    lines.push(line(counter, amount, 0));
    lines.push(line(entry.accountCode, 0, split.supply));
    if (split.vat !== 0) lines.push(line(VAT_OUTPUT_ACCOUNT, 0, split.vat));
  }

  const journal: Journal = {
    id: journalId,
    entryId: entry.id,
    journalDate: entry.cashDate ?? entry.accrualDate ?? "",
    memo: entry.title || entry.noteRaw,
    auto: true,
    reversedBy: null,
    lines,
  };
  assertBalanced(journal);
  return journal;
}

/**
 * 차변 합 == 대변 합을 단정한다.
 *
 * 2줄 분개일 때는 구조상 늘 맞았지만, 세액 분리로 3줄이 되면서 반올림 한 원에
 * 균형이 깨질 수 있다. 균형이 깨진 전표는 저장되면 시산표 전체를 못 믿게 되므로
 * 만드는 자리에서 막는다 (docs/erp-qa.md A9).
 */
export function assertBalanced(journal: Journal): void {
  const debit = journal.lines.reduce((sum, l) => sum + l.debit, 0);
  const credit = journal.lines.reduce((sum, l) => sum + l.credit, 0);
  if (debit !== credit) {
    throw new Error(
      `전표 ${journal.id} 의 차변 ${debit} 과 대변 ${credit} 이 맞지 않습니다 — 저장하지 않습니다`
    );
  }
}

/**
 * 한 원장 건에서 나오는 전표 전부.
 *
 * 대부분은 1건이지만 두 경우에 2건이 된다 —
 *   ① 발생월 ≠ 지급월 → 발생 시 「비용/미지급금」, 지급 시 「미지급금/현금」 (A5)
 *   ② 차입 상환 → 원금(부채 감소)과 이자(비용)를 나눈다 (C3)
 *
 * ①이 없으면 발생과 지급이 다른 건이 부채로 안 잡혀, 다음 달 낼 돈이 재무상태표에 없다.
 */
export function buildJournals(
  entry: Entry,
  newId: IdFactory,
  options: { hasQualifiedEvidence?: boolean } = {}
): Journal[] {
  if (entry.amount == null || !entry.accountCode) return [];

  // ② 차입 상환 — 원금과 이자를 나눈다
  if (entry.principalAmount != null && entry.direction === "out") {
    const repayment = buildRepaymentJournal(entry, newId);
    if (repayment) return [repayment];
  }

  const accrualMonth = (entry.accrualDate ?? "").slice(0, 7);
  const cashMonth = (entry.cashDate ?? "").slice(0, 7);
  const straddles =
    accrualMonth !== "" && cashMonth !== "" && accrualMonth !== cashMonth;

  if (!straddles) {
    const single = buildJournal(entry, newId, options);
    return single ? [single] : [];
  }

  // ① 발생과 지급이 다른 달 — 2단으로 나눈다
  const bridge =
    entry.direction === "out" ? PAYABLE_ACCOUNT : RECEIVABLE_ACCOUNT;

  // 발생 전표는 상대계정을 현금이 아니라 미지급금/미수금으로 둔다.
  // 세액 분리는 발생 시점에 한다 — 세금계산서 날짜가 그때다.
  const accrual = buildJournal(
    { ...entry, cashDate: entry.accrualDate, payMethod: null },
    newId,
    options
  );
  if (!accrual) return [];
  for (const line of accrual.lines) {
    if (line.accountCode === counterAccountFor(entry.payMethod))
      line.accountCode = bridge;
  }
  accrual.journalDate = entry.accrualDate ?? accrual.journalDate;
  accrual.memo = `발생 — ${accrual.memo ?? ""}`.trim();
  assertBalanced(accrual);

  // 지급 전표는 미지급금을 없애고 현금을 뺀다
  const settleId = newId();
  const counter = counterAccountFor(entry.payMethod);
  const amount = entry.amount;
  const settle: Journal = {
    id: settleId,
    entryId: entry.id,
    journalDate: entry.cashDate ?? "",
    memo: `지급 — ${entry.title || entry.noteRaw}`.trim(),
    auto: true,
    reversedBy: null,
    lines:
      entry.direction === "out"
        ? [
            {
              id: newId(),
              journalId: settleId,
              accountCode: bridge,
              debit: amount,
              credit: 0,
              buCode: entry.buCode,
              projectId: entry.projectId,
            },
            {
              id: newId(),
              journalId: settleId,
              accountCode: counter,
              debit: 0,
              credit: amount,
              buCode: entry.buCode,
              projectId: entry.projectId,
            },
          ]
        : [
            {
              id: newId(),
              journalId: settleId,
              accountCode: counter,
              debit: amount,
              credit: 0,
              buCode: entry.buCode,
              projectId: entry.projectId,
            },
            {
              id: newId(),
              journalId: settleId,
              accountCode: bridge,
              debit: 0,
              credit: amount,
              buCode: entry.buCode,
              projectId: entry.projectId,
            },
          ],
  };
  assertBalanced(settle);
  return [accrual, settle];
}

/**
 * 차입 상환 전표 — 원금은 부채를 줄이고 이자는 비용이다 (C3).
 * 원금만 잡으면 이자가 손익에서 빠지고, 전액을 이자로 잡으면 부채가 안 줄어든다.
 */
function buildRepaymentJournal(entry: Entry, newId: IdFactory): Journal | null {
  const total = entry.amount;
  const principal = entry.principalAmount;
  if (total == null || principal == null || !entry.accountCode) return null;
  if (Math.abs(principal) > Math.abs(total)) return null;

  const interest = total - principal;
  const journalId = newId();
  const counter = counterAccountFor(entry.payMethod);
  const line = (accountCode: string, debit: number, credit: number) => ({
    id: newId(),
    journalId,
    accountCode,
    debit,
    credit,
    buCode: entry.buCode,
    projectId: entry.projectId,
  });

  const lines = [line(entry.accountCode, principal, 0)];
  // 이자가 0 이면 줄을 만들지 않는다 — 0 짜리 줄은 전표를 읽기 어렵게만 한다
  if (interest !== 0) lines.push(line(INTEREST_EXPENSE_ACCOUNT, interest, 0));
  lines.push(line(counter, 0, total));

  const journal: Journal = {
    id: journalId,
    entryId: entry.id,
    journalDate: entry.cashDate ?? entry.accrualDate ?? "",
    memo: `상환 — ${entry.title || entry.noteRaw}`.trim(),
    auto: true,
    reversedBy: null,
    lines,
  };
  assertBalanced(journal);
  return journal;
}

export interface TrialBalanceRow {
  accountCode: string;
  accountName: string;
  type: string;
  debit: number;
  credit: number;
  /** 차변 − 대변. 자산·비용은 +, 부채·자본·수익은 − 로 잡힌다 */
  balance: number;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  debitTotal: number;
  creditTotal: number;
  /** 차변 합 − 대변 합. 0이 아니면 기초 재무상태표가 없기 때문이다 (B6 · §9.8) */
  difference: number;
}

/** 총계정원장 — 전표 누계. 화면용 별도 집계 테이블을 만들지 않는다 (§9.8). */
export function trialBalance(journals: Journal[]): TrialBalance {
  const byAccount = new Map<string, { debit: number; credit: number }>();
  for (const journal of journals) {
    for (const line of journal.lines) {
      const acc = byAccount.get(line.accountCode) ?? { debit: 0, credit: 0 };
      acc.debit += line.debit;
      acc.credit += line.credit;
      byAccount.set(line.accountCode, acc);
    }
  }
  const rows: TrialBalanceRow[] = Array.from(byAccount.entries())
    .map(([accountCode, sums]) => {
      const account = findAccount(accountCode);
      return {
        accountCode,
        accountName: account?.name ?? "미분류",
        type: account?.type ?? "미분류",
        debit: sums.debit,
        credit: sums.credit,
        balance: sums.debit - sums.credit,
      };
    })
    .sort((a, b) => (a.accountCode < b.accountCode ? -1 : 1));

  const debitTotal = rows.reduce((acc, r) => acc + r.debit, 0);
  const creditTotal = rows.reduce((acc, r) => acc + r.credit, 0);
  return {
    rows,
    debitTotal,
    creditTotal,
    difference: debitTotal - creditTotal,
  };
}

/**
 * §7.3 — 대체됨(superseded)의 전표 처리는 「역분개」다.
 * 원본 전표를 지우지 않고 차·대를 뒤집은 전표를 하나 더 만들어 상계한다 (원칙 9).
 * 이걸 하지 않으면 -R1의 전표와 원본 전표가 재무제표에 이중 계상된다.
 */
export function buildReversal(journal: Journal, newId: IdFactory): Journal {
  const reversalId = newId();
  return {
    id: reversalId,
    entryId: journal.entryId,
    journalDate: journal.journalDate,
    memo: `역분개 — ${journal.memo ?? ""}`.trim(),
    auto: true,
    reversedBy: journal.id,
    lines: journal.lines.map(line => ({
      id: newId(),
      journalId: reversalId,
      accountCode: line.accountCode,
      debit: line.credit,
      credit: line.debit,
      buCode: line.buCode,
      projectId: line.projectId,
    })),
  };
}
