/**
 * 전표 · 분개장 — 원장이 확정되는 순간 자동 생성된다. 사람이 분개를 만들지 않는다 (원칙 12).
 * 사양서는 3차로 잡았지만 인수 기준 T1 ⑤가 1차에서 전표 1건 생성을 요구한다.
 */
import { counterAccountFor, findAccount } from "./accounts.js";
import type { Entry, Journal, JournalLine } from "./types.js";

export interface IdFactory {
  (): string;
}

/**
 * 지출: 비용·자산 차변 · 현금(또는 카드미지급금) 대변
 * 수입: 현금 차변 · 수익·부채 대변
 * 차변 합 == 대변 합을 언제나 만족한다.
 */
export function buildJournal(entry: Entry, newId: IdFactory): Journal | null {
  if (entry.amount == null || !entry.accountCode) return null;
  const journalId = newId();
  const counter = counterAccountFor(entry.payMethod);
  const amount = entry.amount; // 취소 전표(-C)는 음수 그대로 상계된다
  const outward = entry.direction === "out";
  const debitAccount = outward ? entry.accountCode : counter;
  const creditAccount = outward ? counter : entry.accountCode;
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
  return {
    id: journalId,
    entryId: entry.id,
    journalDate: entry.cashDate ?? entry.accrualDate ?? "",
    memo: entry.title || entry.noteRaw,
    auto: true,
    reversedBy: null,
    lines: [line(debitAccount, amount, 0), line(creditAccount, 0, amount)],
  };
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
