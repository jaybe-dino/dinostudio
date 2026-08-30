/**
 * §9.7 손익 — 회계 계단과 관리 계단
 *
 * 회계 계단 (세무·감사용)          관리 계단 (사업 판단용)
 *   매출                             총매출 (GMV 제외 — 비회계)
 *   − 매출원가                       − 통과원가
 *   = 매출총이익                     = 순매출
 *   − 판매비와관리비                 − 직접원가
 *   = 영업이익                       = 기여이익
 *   ± 영업외손익                     − 공통배부
 *   = 법인세차감전순이익             = 영업이익  ← 회계 계단과 반드시 일치
 *
 * 두 계단의 영업이익이 다르면 배부 로직이 틀린 것이다. 이 일치 검증을 자동 테스트로 둔다.
 */
import { findAccount } from "./accounts.js";
import type { Entry } from "./types.js";

export interface AccountingLadder {
  revenue: number;
  cogs: number;
  grossProfit: number;
  sga: number;
  operatingProfit: number;
  nonOperating: number;
  pretaxProfit: number;
}

export interface ManagementLadder {
  grossRevenue: number;
  passThrough: number;
  netRevenue: number;
  directCost: number;
  contributionProfit: number;
  commonAllocated: number;
  operatingProfit: number;
}

export interface PnlResult {
  from: string | null;
  to: string | null;
  accounting: AccountingLadder;
  management: ManagementLadder;
  /** 두 계단의 영업이익 차이. 0이 아니면 배부 로직이 틀린 것이다 (§9.7) */
  operatingProfitGap: number;
  /** 귀속이 비어 있어 관리 계단에서 빠진 건 */
  attributionMissing: { count: number; amount: number; codes: string[] };
  blockers: string[];
}

/** 손익은 발생일(accrual_date) 기준이다 — 현금흐름표의 cash_date와 다르다 (§6.2 · B4) */
function inScope(
  entry: Entry,
  from?: string | null,
  to?: string | null
): boolean {
  if (entry.status !== "confirmed" || entry.amount == null) return false; // 원칙 7 · 8
  const date = entry.accrualDate ?? entry.cashDate;
  if (from && (!date || date < from)) return false;
  if (to && (!date || date > to)) return false;
  return true;
}

export function buildPnl(
  entries: Entry[],
  options: {
    from?: string | null;
    to?: string | null;
    buCode?: string | null;
    projectId?: string | null;
  } = {}
): PnlResult {
  const scoped = entries.filter(e => {
    if (!inScope(e, options.from, options.to)) return false;
    if (options.buCode && e.buCode !== options.buCode) return false;
    if (options.projectId && e.projectId !== options.projectId) return false;
    return true;
  });

  let revenue = 0;
  let cogs = 0;
  let sga = 0;
  let nonOperating = 0;
  let passThrough = 0;
  let directCost = 0;
  let commonAllocated = 0;
  const attributionCodes: string[] = [];
  let attributionAmount = 0;

  for (const entry of scoped) {
    const account = findAccount(entry.accountCode);
    if (!account) continue; // 계정이 없으면 전표가 없고 손익에도 못 들어간다
    const amount = entry.amount ?? 0;

    // ── 회계 계단 ──
    if (account.type === "매출") revenue += amount;
    else if (account.type === "매출원가") cogs += amount;
    else if (account.type === "판관비") sga += amount;
    else if (account.type === "영업외수익") nonOperating += amount;
    else if (account.type === "영업외비용") nonOperating -= amount;
    else continue; // 자산·부채·자본은 손익이 아니다

    // ── 관리 계단 ──
    // 영업이익까지가 두 계단의 일치 구간이므로 영업외는 넣지 않는다.
    // 매출원가 + 판관비를 원가성격(통과/직접/공통)으로만 다시 가른다.
    if (account.type === "매출원가" || account.type === "판관비") {
      if (entry.nature === "통과원가") passThrough += amount;
      else if (entry.nature === "직접원가") directCost += amount;
      else commonAllocated += amount;

      if (
        entry.projectId == null &&
        (entry.nature === "통과원가" || entry.nature === "직접원가")
      ) {
        attributionCodes.push(entry.code);
        attributionAmount += amount;
      }
    }
  }

  const grossProfit = revenue - cogs;
  const operatingProfit = grossProfit - sga;
  const pretaxProfit = operatingProfit + nonOperating;

  // 총매출은 회계 계단의 매출과 같다. GMV는 비회계 지표라 어느 쪽에도 넣지 않는다 (원칙 6).
  const grossRevenue = revenue;
  const netRevenue = grossRevenue - passThrough;
  const contributionProfit = netRevenue - directCost;
  const managementOperating = contributionProfit - commonAllocated;

  const blockers: string[] = [];
  if (attributionCodes.length > 0) {
    blockers.push(
      `확정 건 중 귀속 미지정 ${attributionCodes.length}건 — 사업부 손익·프로젝트 마진에서 빠집니다 (승인 대기·판정 대기 포함 시 더 많습니다)`
    );
  }
  const noAccount = scoped.filter(e => !findAccount(e.accountCode)).length;
  if (noAccount > 0)
    blockers.push(
      `계정 미지정 ${noAccount}건 — 전표가 없어 손익에 들어가지 않습니다`
    );

  return {
    from: options.from ?? null,
    to: options.to ?? null,
    accounting: {
      revenue,
      cogs,
      grossProfit,
      sga,
      operatingProfit,
      nonOperating,
      pretaxProfit,
    },
    management: {
      grossRevenue,
      passThrough,
      netRevenue,
      directCost,
      contributionProfit,
      commonAllocated,
      operatingProfit: managementOperating,
    },
    // 0이어야 한다. 0이 아니면 배부 로직이 틀린 것이다 (§9.7).
    operatingProfitGap: managementOperating - operatingProfit,
    attributionMissing: {
      count: attributionCodes.length,
      amount: attributionAmount,
      codes: attributionCodes,
    },
    blockers,
  };
}

export interface SegmentPnl {
  key: string;
  label: string;
  netRevenue: number;
  directCost: number;
  contributionProfit: number;
  commonAllocated: number;
  operatingProfit: number;
  entryCount: number;
}

/** 사업부 손익 · 프로젝트 마진 — 귀속으로 접은 것 */
export function segmentPnl(
  entries: Entry[],
  by: "buCode" | "projectId",
  options: { from?: string | null; to?: string | null } = {}
): SegmentPnl[] {
  const keys = Array.from(
    new Set(
      entries
        .filter(e => inScope(e, options.from, options.to))
        .map(e => e[by] ?? "미지정")
    )
  );
  return keys
    .map(key => {
      const scoped = entries.filter(e => (e[by] ?? "미지정") === key);
      const pnl = buildPnl(scoped, options);
      return {
        key: String(key),
        label: String(key),
        netRevenue: pnl.management.netRevenue,
        directCost: pnl.management.directCost,
        contributionProfit: pnl.management.contributionProfit,
        commonAllocated: pnl.management.commonAllocated,
        operatingProfit: pnl.management.operatingProfit,
        entryCount: scoped.filter(e => inScope(e, options.from, options.to))
          .length,
      };
    })
    .sort((a, b) => b.contributionProfit - a.contributionProfit);
}
