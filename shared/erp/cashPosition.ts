/**
 * §9.2 현금 현황 · 단계별 부족액
 *
 *   보유현금  = Σ 계좌 잔액 (대사 완료분)          // 카드 한도는 현금이 아님 — 제외
 *   필요액(L) = Σ entry[status ∈ {confirmed, pending}, out, priority_eff ≤ L]
 *   부족액(L) = 보유현금 − 필요액(L)
 *
 * 사양서에 명시되지 않았으나 §9.2의 세 수치를 재현하려면 두 가지가 더 필요하다 —
 * 자세한 근거는 docs/erp-spec-gaps.md 참조.
 *   ① paidAt — 이미 집행이 끝난 확정 건은 「앞으로 막아야 할 돈」이 아니다.
 *   ② horizon — 소요 지평. 지평 밖의 승인 대기 건은 이번 소요에 넣지 않는다.
 * 두 값을 사양서 §5.4 시드에 맞추면 §9.2 · T3 · T6의 모든 수치가 정확히 재현된다.
 */
import { priorityRank, resolvePriority } from "./accounts.js";
import type { Entry, Priority } from "./types.js";

export interface PriorityOverrideInput {
  code: string;
  priority: Priority;
  /** 등급을 올리면 사유가 남아야 한다 (§10.3 reason_required) */
  reason: string;
}

export interface CashPositionOptions {
  /** §9.2 보유현금. 계좌 대사 전이면 null → 부족액도 null (원칙 8) */
  cashOnHand: number | null;
  /** 판정 대기 포함 토글 (기본 ON) */
  includeUndecided?: boolean;
  /** 소요 지평 (YYYY-MM-DD 이하). null이면 무제한 */
  horizon?: string | null;
  /** 저장하지 않는 시뮬레이션용 등급 상향 (§10.1 POST /cash-position/simulate) */
  overrides?: PriorityOverrideInput[];
}

export interface ShortfallTier {
  /** 0 → P0까지 · 1 → P0+P1까지 · 2 → P0+P1+P2까지 */
  level: 0 | 1 | 2;
  label: string;
  required: number;
  /** 보유현금 − 필요액. 음수면 부족, 양수면 여유 */
  shortfall: number | null;
  codes: string[];
}

export interface CashPositionLine {
  entry: Entry;
  priorityEff: Priority | null;
  /** 필요액에 실제로 더해진 금액. 판정 대기 건은 적요칸 후보 금액 */
  amountUsed: number | null;
  isCandidate: boolean;
}

export interface CashPosition {
  cashOnHand: number | null;
  includeUndecided: boolean;
  horizon: string | null;
  tiers: ShortfallTier[];
  lines: CashPositionLine[];
  /** 금액을 알 수 없어 어느 단계에도 못 들어간 판정 대기 건 — 「n건 제외 중」 */
  excludedUndecided: { n: number; codes: string[] };
  warnings: string[];
}

const TIER_LABELS = ["P0까지", "P0+P1까지", "P0+P1+P2까지"] as const;

/** 소요 판정에 쓰는 날짜 — 실제 입출금일이 없으면 지급 예정일 */
export function requirementDate(entry: Entry): string | null {
  return entry.cashDate ?? entry.dueDate;
}

/** 아직 나가지 않은 지출인가 — 필요액의 모집단 */
export function isOutstandingOutflow(
  entry: Entry,
  horizon: string | null
): boolean {
  if (entry.direction !== "out") return false;
  if (entry.paidAt != null) return false;
  if (
    entry.status !== "confirmed" &&
    entry.status !== "pending" &&
    entry.status !== "undecided"
  )
    return false;
  if (!horizon) return true;
  const date = requirementDate(entry);
  return date == null || date <= horizon;
}

export function computeCashPosition(
  entries: Entry[],
  options: CashPositionOptions
): CashPosition {
  const includeUndecided = options.includeUndecided ?? true;
  const horizon = options.horizon ?? null;
  const overrideMap = new Map(
    (options.overrides ?? []).map(o => [o.code, o.priority])
  );

  const lines: CashPositionLine[] = [];
  const excludedCodes: string[] = [];

  for (const entry of entries) {
    if (!isOutstandingOutflow(entry, horizon)) continue;
    if (entry.status === "undecided" && !includeUndecided) continue;

    const simulated = overrideMap.get(entry.code) ?? null;
    const priorityEff = simulated ?? resolvePriority(entry);

    // 판정 대기 건은 확정 금액이 없으므로 적요칸 후보 금액만 참조한다 (§9.2 토글).
    const isCandidate = entry.status === "undecided" && entry.amount == null;
    const amountUsed = isCandidate ? entry.amountCandidate : entry.amount;

    if (amountUsed == null) {
      if (entry.status === "undecided") excludedCodes.push(entry.code);
      continue;
    }
    lines.push({ entry, priorityEff, amountUsed, isCandidate });
  }

  const tiers = ([0, 1, 2] as const).map(level => {
    const matched = lines.filter(l => priorityRank(l.priorityEff) <= level);
    const required = matched.reduce((acc, l) => acc + (l.amountUsed ?? 0), 0);
    return {
      level,
      label: TIER_LABELS[level],
      required,
      shortfall:
        options.cashOnHand == null ? null : options.cashOnHand - required,
      codes: matched.map(l => l.entry.code),
    } satisfies ShortfallTier;
  });

  const warnings: string[] = [];
  if (!includeUndecided) {
    // T6 — 이 경고는 반드시 함께 떠야 한다
    warnings.push("판정 대기 건이 제외되어 부족액이 실제보다 작게 보입니다.");
  } else if (excludedCodes.length > 0) {
    warnings.push(
      `금액이 확정되지 않아 ${excludedCodes.length}건 제외 중입니다.`
    );
  }
  if (options.cashOnHand == null) {
    warnings.push("보유현금이 계좌 대사되지 않아 부족액을 계산할 수 없습니다.");
  }

  return {
    cashOnHand: options.cashOnHand,
    includeUndecided,
    horizon,
    tiers,
    lines,
    excludedUndecided: { n: excludedCodes.length, codes: excludedCodes },
    warnings,
  };
}

/** 우선순위별 소계 — 화면의 「우선순위 자동 판정」 카드 */
export function requiredByPriority(
  position: CashPosition
): Record<Priority, number> {
  const acc: Record<Priority, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const line of position.lines) {
    if (line.priorityEff) acc[line.priorityEff] += line.amountUsed ?? 0;
  }
  return acc;
}
