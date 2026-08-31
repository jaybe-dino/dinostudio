/**
 * 전표 · 분개장 — 원장이 확정되는 순간 자동 생성된다. 사람이 분개를 만들지 않는다 (원칙 12).
 * 사양서는 3차로 잡았지만 인수 기준 T1 ⑤가 1차에서 전표 1건 생성을 요구한다.
 */
import { counterAccountFor, findAccount } from "./accounts.js";
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
