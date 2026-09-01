/**
 * §9.8 재무제표 5종 — 재무상태표 · 손익계산서 · 현금흐름표 · 자본변동표 · 주석
 *
 * 전부 journal_line 누계에서 생성한다. 화면용 별도 집계 테이블을 만들지 않는다.
 * 기초 재무상태표(자본·이월 잔액)가 없으면 시산표가 맞지 않는다 —
 * 차액을 「기초 미설정」 행으로 그대로 노출한다 (B6). 억지로 맞추지 않는다.
 * 현금흐름표는 직접법이고 §8.3의 3구간 자동 판정을 그대로 쓴다.
 */
import { cashflowSection, findAccount } from "./accounts.js";
import { trialBalance } from "./journal.js";
import { buildPnl } from "./pnl.js";
import type { Entry, Journal, Period } from "./types.js";

export interface StatementRow {
  label: string;
  amount: number | null;
  /** 소계·합계 행 */
  emphasis?: boolean;
  note?: string;
}

export interface FinancialStatements {
  period: { from: string | null; to: string | null; ym: string | null };
  /** 마감된 기간만 「확정」이고 그 외는 가결산이다 */
  status: "가결산" | "확정";
  /**
   * 어느 보고서가 어느 날짜를 축으로 쓰는가 (docs/erp-qa.md A4).
   * 화면이 이걸 표시해야 한다 — 같은 달의 손익과 현금이 다르면 사람은
   * 「어느 쪽이 틀렸나」를 먼저 의심하지만, 둘 다 맞고 축이 다를 뿐이다.
   */
  basis: {
    incomeStatement: string;
    cashflowStatement: string;
    balanceSheet: string;
  };
  balanceSheet: StatementRow[];
  incomeStatement: StatementRow[];
  cashflowStatement: StatementRow[];
  equityStatement: StatementRow[];
  notes: string[];
  blockers: string[];
}

const TYPE_GROUPS: Record<string, "자산" | "부채" | "자본"> = {
  자산: "자산",
  유형자산: "자산",
  기타자산: "자산",
  부채: "부채",
  자본: "자본",
};

export function buildFinancialStatements(
  entries: Entry[],
  journals: Journal[],
  options: {
    ym?: string | null;
    periods?: Period[];
    openingEquity?: number | null;
  } = {}
): FinancialStatements {
  const ym = options.ym ?? null;
  const from = ym ? `${ym}-01` : null;
  const to = ym ? `${ym}-31` : null;
  const scopedJournals = ym
    ? journals.filter(j => j.journalDate.startsWith(ym))
    : journals;
  const tb = trialBalance(scopedJournals);
  const pnl = buildPnl(entries, { from, to });

  const closed = (options.periods ?? []).find(
    p => p.ym === ym && p.status === "closed"
  );

  // ── 재무상태표 ── 전표 누계에서. 기초 잔액이 없으면 차액을 그대로 노출한다.
  const assets = tb.rows.filter(r => TYPE_GROUPS[r.type] === "자산");
  const liabilities = tb.rows.filter(r => TYPE_GROUPS[r.type] === "부채");
  const equityRows = tb.rows.filter(r => TYPE_GROUPS[r.type] === "자본");

  const assetTotal = assets.reduce((acc, r) => acc + r.balance, 0);
  const liabilityTotal = liabilities.reduce((acc, r) => acc - r.balance, 0);
  const equityTotal = equityRows.reduce((acc, r) => acc - r.balance, 0);
  const unset =
    assetTotal - (liabilityTotal + equityTotal + pnl.accounting.pretaxProfit);

  const balanceSheet: StatementRow[] = [
    ...assets.map(r => ({
      label: `${r.accountCode} ${r.accountName}`,
      amount: r.balance,
    })),
    { label: "자산 총계", amount: assetTotal, emphasis: true },
    ...liabilities.map(r => ({
      label: `${r.accountCode} ${r.accountName}`,
      amount: -r.balance,
    })),
    { label: "부채 총계", amount: liabilityTotal, emphasis: true },
    ...equityRows.map(r => ({
      label: `${r.accountCode} ${r.accountName}`,
      amount: -r.balance,
    })),
    { label: "당기순이익 (가결산)", amount: pnl.accounting.pretaxProfit },
    {
      label: "기초 미설정",
      amount: unset,
      note: "기초 재무상태표(자본·이월 잔액)가 없어 생긴 차액입니다. 조정 전표로 메우지 않습니다 (B6)",
    },
    {
      label: "부채와 자본 총계",
      amount:
        liabilityTotal + equityTotal + pnl.accounting.pretaxProfit + unset,
      emphasis: true,
    },
  ];

  const incomeStatement: StatementRow[] = [
    { label: "매출", amount: pnl.accounting.revenue },
    { label: "매출원가", amount: -pnl.accounting.cogs },
    { label: "매출총이익", amount: pnl.accounting.grossProfit, emphasis: true },
    { label: "판매비와관리비", amount: -pnl.accounting.sga },
    {
      label: "영업이익",
      amount: pnl.accounting.operatingProfit,
      emphasis: true,
    },
    { label: "영업외손익", amount: pnl.accounting.nonOperating },
    {
      label: "법인세차감전순이익",
      amount: pnl.accounting.pretaxProfit,
      emphasis: true,
    },
  ];

  // ── 현금흐름표 (직접법) ── §8.3 3구간 자동 판정을 그대로 사용
  //
  // 축이 다르다. 손익은 발생일(accrualDate), 현금흐름은 지급일(cashDate) 이다.
  // 같은 달의 두 숫자가 안 맞는 것이 정상이고, 안 맞는 이유가 이것이다 (A4).
  const cashEntries = entries.filter(
    e =>
      e.status === "confirmed" &&
      e.amount != null &&
      (!ym || (e.cashDate ?? "").startsWith(ym))
  );
  const bySection = { 영업: 0, 투자: 0, 재무: 0 } as Record<string, number>;
  for (const entry of cashEntries) {
    const section = cashflowSection(entry.accountCode);
    if (section !== "영업" && section !== "투자" && section !== "재무")
      continue;
    bySection[section] +=
      entry.direction === "in" ? (entry.amount ?? 0) : -(entry.amount ?? 0);
  }
  const netChange = bySection["영업"] + bySection["투자"] + bySection["재무"];
  const unclassified = cashEntries
    .filter(
      e => !["영업", "투자", "재무"].includes(cashflowSection(e.accountCode))
    )
    .reduce(
      (acc, e) =>
        acc + (e.direction === "in" ? (e.amount ?? 0) : -(e.amount ?? 0)),
      0
    );

  const cashflowStatement: StatementRow[] = [
    { label: "영업활동 현금흐름", amount: bySection["영업"] },
    { label: "투자활동 현금흐름", amount: bySection["투자"] },
    { label: "재무활동 현금흐름", amount: bySection["재무"] },
    { label: "현금의 증감", amount: netChange, emphasis: true },
    {
      label: "구간 판정 불가",
      amount: unclassified,
      note: "계정이 없어 3구간에 넣지 못한 건입니다. 「기타」로 밀어넣지 않습니다 (§8.3)",
    },
  ];

  const equityStatement: StatementRow[] = [
    {
      label: "기초 자본",
      amount: options.openingEquity ?? null,
      note:
        options.openingEquity == null
          ? "기초 재무상태표 미설정 (B6)"
          : undefined,
    },
    { label: "당기순이익", amount: pnl.accounting.pretaxProfit },
    {
      label: "기말 자본",
      amount:
        options.openingEquity == null
          ? null
          : options.openingEquity + pnl.accounting.pretaxProfit,
      emphasis: true,
    },
  ];

  const blockers: string[] = [...pnl.blockers];
  if (tb.difference !== 0) {
    blockers.push(
      `시산표 차변·대변 불일치 ${tb.difference.toLocaleString("ko-KR")} — 전표 생성 오류`
    );
  }
  if (options.openingEquity == null) {
    blockers.push(
      "기초 재무상태표(자본·이월 잔액)가 없습니다 — 재무상태표는 가결산으로만 봅니다 (B6)"
    );
  }
  if (unclassified !== 0) {
    blockers.push("계정이 없어 현금흐름 3구간에 넣지 못한 건이 있습니다");
  }

  const notes = [
    "이 표는 전부 전표(journal_line) 누계에서 생성됩니다. 화면용 별도 집계 테이블은 없습니다.",
    "현금흐름표는 직접법이고 §8.3의 계정 → 3구간 자동 판정을 그대로 씁니다.",
    "이자는 영업활동, 차입 원금 상환만 재무활동입니다 — 원리금을 한 덩어리로 처리하지 않습니다.",
    closed
      ? `${ym} 은(는) 마감된 기간이므로 확정 표기입니다.`
      : "마감되지 않은 기간이므로 가결산입니다. 확정 표기는 월 마감 이후에만 붙습니다.",
  ];

  return {
    period: { from, to, ym },
    status: closed ? "확정" : "가결산",
    /**
     * 어느 보고서가 어느 날짜를 축으로 쓰는가 (A4).
     *
     * 화면이 이걸 표시해야 한다. 손익과 현금흐름의 같은 달 숫자가 다르면
     * 사람은 「어느 쪽이 틀렸나」를 먼저 의심한다 — 둘 다 맞고 축이 다를 뿐이다.
     */
    basis: {
      incomeStatement: "발생주의 (귀속일)",
      cashflowStatement: "현금주의 (실제 입출금일)",
      balanceSheet: "기말 시점",
    },
    balanceSheet,
    incomeStatement,
    cashflowStatement,
    equityStatement,
    notes,
    blockers,
  };
}

/** 월 마감 — blockers가 비어야만 성공한다 (§10.1 · T12) */
export function closingBlockers(
  entries: Entry[],
  ym: string,
  migrationFailures: string[]
): string[] {
  const blockers: string[] = [...migrationFailures];
  // 발생월과 지급월을 모두 본다 — 하나만 보면 발생월이 이 달인 건이 빠진다 (A4 · D4)
  const inMonth = (e: Entry) =>
    (e.accrualDate ?? "").startsWith(ym) || (e.cashDate ?? "").startsWith(ym);

  const undecided = entries.filter(e => e.status === "undecided" && inMonth(e));
  if (undecided.length > 0) {
    blockers.push(
      `판정 대기 ${undecided.length}건 — ${undecided.map(e => e.code).join(" · ")}`
    );
  }
  const noAccount = entries.filter(
    e => e.status === "confirmed" && e.accountCode == null && inMonth(e)
  );
  if (noAccount.length > 0)
    blockers.push(`계정 미지정 확정 건 ${noAccount.length}건 — 전표 생성 불가`);
  return blockers;
}

export { findAccount };
