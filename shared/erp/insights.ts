/**
 * 경영 판단 지표 (docs/erp-qa.md E3 · E4 · E5 · E7)
 *
 * 여기 있는 것들은 회계 숫자가 아니라 **판단에 쓰는 숫자**다.
 * 그래서 회계 계단과 섞지 않고 별도로 둔다 (원칙 — 회계 계단과 관리 계단은 나란히 병기).
 *
 * 공통 원칙: 모르는 것은 0 이 아니라 null 이다. 0 은 「없다」로 읽히고,
 * null 은 「모른다」로 읽힌다. 판단에 쓰는 숫자에서 이 차이가 특히 크다.
 */
import type { Entry, Project } from "./types.js";

/* ── E3 이 건을 승인하면 런웨이가 며칠 줄어드는가 ─────────────────────────── */

/**
 * 승인 판단의 실제 단위는 금액이 아니라 **며칠**이다.
 * 1,100만원이 큰지 작은지는 사람마다 다르지만, 「런웨이 6일」은 누구에게나 같다.
 *
 * 일 번레이트를 모르면 계산하지 않는다 — 추정 분모로 나누면 그 숫자가
 * 승인 결정에 쓰이는데, 근거가 없다.
 */
export function runwayDaysCost(
  amount: number | null,
  monthlyBurn: number | null
): number | null {
  if (amount == null || monthlyBurn == null || monthlyBurn <= 0) return null;
  const dailyBurn = monthlyBurn / 30;
  return Math.round((Math.abs(amount) / dailyBurn) * 10) / 10;
}

/* ── E5 매출 집중도 ────────────────────────────────────────────────────── */

export interface ConcentrationRow {
  partyId: string | null;
  name: string;
  amount: number;
  share: number;
}

export interface Concentration {
  total: number;
  rows: ConcentrationRow[];
  /** 상위 1개 고객 비중 */
  top1: number | null;
  /** 상위 3개 합계 비중 */
  top3: number | null;
  /**
   * 허핀달 지수 (0~1). 1 에 가까울수록 한 곳에 몰려 있다.
   * 상위 비중만 보면 「2위와 3위가 비슷한지」를 못 본다.
   */
  hhi: number | null;
  /** 사람이 읽을 판정 */
  verdict: string;
}

/** 상위 1곳이 이 비중을 넘으면 경고 — 그 거래처를 잃으면 회사가 흔들린다 */
export const CONCENTRATION_WARN = 0.4;

/**
 * 고객 편중 (E5).
 * 투자 실사에서 반드시 묻는 숫자이고, 묻기 전에 우리가 알고 있어야 한다.
 */
export function revenueConcentration(
  entries: Entry[],
  partyNames: Map<string, string>,
  options: { from?: string | null; to?: string | null } = {}
): Concentration {
  const sales = entries.filter(
    e =>
      e.direction === "in" &&
      e.status === "confirmed" &&
      e.amount != null &&
      (!options.from || (e.accrualDate ?? e.cashDate ?? "") >= options.from) &&
      (!options.to || (e.accrualDate ?? e.cashDate ?? "") <= options.to)
  );

  const byParty = new Map<string, number>();
  for (const entry of sales) {
    // 거래처가 없는 건은 하나로 묶지 않는다 — 묶으면 없는 편중이 생긴다
    const key = entry.partyId ?? `__unknown__${entry.code}`;
    byParty.set(key, (byParty.get(key) ?? 0) + (entry.amount ?? 0));
  }

  const total = Array.from(byParty.values()).reduce((a, b) => a + b, 0);
  if (total <= 0)
    return {
      total: 0,
      rows: [],
      top1: null,
      top3: null,
      hhi: null,
      verdict: "확정 매출이 없어 판정할 수 없습니다",
    };

  const rows: ConcentrationRow[] = Array.from(byParty.entries())
    .map(([key, amount]) => ({
      partyId: key.startsWith("__unknown__") ? null : key,
      name: key.startsWith("__unknown__")
        ? "거래처 미지정"
        : (partyNames.get(key) ?? key),
      amount,
      share: amount / total,
    }))
    .sort((a, b) => b.amount - a.amount);

  const top1 = rows[0]?.share ?? null;
  const top3 = rows.slice(0, 3).reduce((sum, r) => sum + r.share, 0);
  const hhi = rows.reduce((sum, r) => sum + r.share * r.share, 0);

  const verdict =
    top1 != null && top1 > CONCENTRATION_WARN
      ? `상위 1곳이 매출의 ${Math.round(top1 * 100)}% 입니다 — 그 거래처를 잃으면 회사가 흔들립니다`
      : rows.length < 3
        ? `거래처가 ${rows.length}곳뿐입니다 — 비중 계산의 의미가 작습니다`
        : "특정 거래처에 몰려 있지 않습니다";

  return { total, rows, top1, top3, hhi, verdict };
}

/* ── E4 진행 중 프로젝트 예상 마진 ──────────────────────────────────────── */

export interface ProjectMargin {
  projectId: string;
  name: string;
  /** 계약 금액 */
  contractAmount: number | null;
  /** 지금까지 들어간 원가 */
  spent: number;
  /** 사람이 넣은 잔여 추정 원가 */
  remainingEstimate: number | null;
  /** 계약 − (기투입 + 잔여추정). 잔여추정이 없으면 null */
  expectedMargin: number | null;
  expectedMarginRate: number | null;
  /** 완료된 프로젝트인가 */
  done: boolean;
  /** 왜 계산할 수 없는지 */
  blockedBy: string | null;
}

/**
 * 프로젝트 마진 (E4).
 *
 * 지금까지는 완료 후에만 보였다. 진행 중에 안 보이면 **적자 프로젝트를
 * 끝날 때까지 모른다.** 잔여 원가는 시스템이 추정하지 않는다 — 사람이 넣는다.
 * 추정치를 시스템이 만들면 그 숫자에 근거가 없는데 판단에 쓰인다.
 */
export function projectMargins(
  projects: Project[],
  entries: Entry[],
  remainingEstimates: Map<string, number>
): ProjectMargin[] {
  return projects.map(project => {
    const own = entries.filter(
      e => e.projectId === project.id && e.status === "confirmed"
    );
    const spent = own
      .filter(e => e.direction === "out")
      .reduce((sum, e) => sum + (e.amount ?? 0), 0);

    const contractAmount = project.contractAmount ?? null;
    const remainingEstimate = remainingEstimates.get(project.id) ?? null;
    const done = project.status === "완료";

    // 완료된 것은 잔여가 0 이다 — 추정을 기다릴 필요가 없다
    const remaining = done ? 0 : remainingEstimate;

    let blockedBy: string | null = null;
    if (contractAmount == null) blockedBy = "계약 금액이 확정되지 않았습니다";
    else if (remaining == null)
      blockedBy = "잔여 원가 추정이 없습니다 — 사람이 넣어야 합니다";

    const expectedMargin =
      contractAmount != null && remaining != null
        ? contractAmount - (spent + remaining)
        : null;

    return {
      projectId: project.id,
      name: project.name,
      contractAmount,
      spent,
      remainingEstimate: remaining,
      expectedMargin,
      expectedMarginRate:
        expectedMargin != null && contractAmount != null && contractAmount !== 0
          ? Math.round((expectedMargin / contractAmount) * 1000) / 10
          : null,
      done,
      blockedBy,
    };
  });
}

/* ── E7 인당 생산성 ────────────────────────────────────────────────────── */

export interface Productivity {
  headcount: number | null;
  monthlyRevenue: number | null;
  monthlyProfit: number | null;
  revenuePerHead: number | null;
  profitPerHead: number | null;
  /** 왜 계산할 수 없는지 */
  blockedBy: string | null;
}

/**
 * 인당 생산성 (E7) — 채용 판단의 근거.
 *
 * 인원수를 모르면 계산하지 않는다. 「대략 몇 명」으로 나눈 숫자가
 * 채용 결정에 쓰이면 안 된다.
 */
export function productivity(input: {
  headcount: number | null;
  monthlyRevenue: number | null;
  monthlyProfit: number | null;
}): Productivity {
  const blocked =
    input.headcount == null || input.headcount <= 0
      ? "인원수가 설정되지 않았습니다 (기준값 화면에서 입력)"
      : input.monthlyRevenue == null
        ? "월 매출을 확정할 수 없습니다"
        : null;

  const per = (value: number | null) =>
    value != null && input.headcount != null && input.headcount > 0
      ? Math.round(value / input.headcount)
      : null;

  return {
    headcount: input.headcount,
    monthlyRevenue: input.monthlyRevenue,
    monthlyProfit: input.monthlyProfit,
    revenuePerHead: blocked ? null : per(input.monthlyRevenue),
    profitPerHead: blocked ? null : per(input.monthlyProfit),
    blockedBy: blocked,
  };
}
