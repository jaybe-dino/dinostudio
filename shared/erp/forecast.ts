/**
 * §9.5 13주 자금계획
 *
 *   주차별 잔액(w) = 잔액(w−1) + 예정입금(w) − 예정지출(w)
 *   예정입금 = 미수 due_date + (파이프라인 × 성사확률)
 *   예정지출 = 확정 예정건 + 반복 고정지출 + debt_schedule(원리금)
 *   시나리오 3종: Base / Stress(회수 −30%, 지출 +10%) / Upside
 *   예상런웨이 = 잔액이 처음 음수가 되는 주차
 *
 * 성사확률(B10)이 확정되지 않았고 debt_schedule이 비어 있으므로(B2),
 * 파이프라인과 상환 라인은 계산에서 빠지고 그 사실을 blockers로 노출한다 (원칙 8).
 */
import { addDays, daysBetween, isUncollected } from "./ar";
import type { DebtSchedule, Entry } from "./types";

export type Scenario = "Base" | "Stress" | "Upside";

export interface ForecastWeek {
  index: number;
  start: string;
  end: string;
  open: number | null;
  inflow: number;
  outflow: number;
  close: number | null;
  inflowCodes: string[];
  outflowCodes: string[];
}

export interface ForecastResult {
  scenario: Scenario;
  weeks: ForecastWeek[];
  /** 잔액이 처음 음수가 되는 주차. 없으면 null */
  firstNegativeWeek: number | null;
  /** 예상런웨이 — 주 단위. 분모가 아니라 시점이므로 번레이트 없이도 나온다 */
  expectedRunwayWeeks: number | null;
  /**
   * 입금예정일이 이미 지난 미수 — 어느 주차에도 들어가지 않는다.
   * 언제 들어올지 모르는 돈을 임의의 주차에 얹으면 계획이 낙관 쪽으로 흐려지기 때문이다 (원칙 8).
   */
  overdueNotScheduled: { amount: number; codes: string[] };
  blockers: string[];
}

const FACTORS: Record<Scenario, { inflow: number; outflow: number }> = {
  Base: { inflow: 1, outflow: 1 },
  // Stress — 회수 −30%, 지출 +10%
  Stress: { inflow: 0.7, outflow: 1.1 },
  Upside: { inflow: 1.1, outflow: 1 },
};

/** 월요일 기준 주차 시작일 */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // 월=0
  return addDays(date, -day);
}

export function buildForecast(
  entries: Entry[],
  debtSchedules: DebtSchedule[],
  options: {
    today: string;
    openingCash: number | null;
    scenario?: Scenario;
    /** B10 — 상/중/하 성사확률. null이면 파이프라인을 넣지 않는다 */
    pipelineProbability: Record<string, number> | null;
    weeks?: number;
  }
): ForecastResult {
  const scenario = options.scenario ?? "Base";
  const factor = FACTORS[scenario];
  const weekCount = options.weeks ?? 13;
  const start = weekStart(options.today);

  const blockers: string[] = [];
  if (options.openingCash == null)
    blockers.push("보유현금이 대사되지 않아 주차 잔액을 시작할 수 없습니다");
  if (options.pipelineProbability == null) {
    blockers.push(
      "성사 가능성 환산율이 확정되지 않아 파이프라인(발행 대기)을 예정입금에 넣지 않았습니다 (B10)"
    );
  }
  if (debtSchedules.length === 0) {
    blockers.push(
      "차입 만기가 확인되지 않아 상환 라인(원리금)이 비어 있습니다 (B2)"
    );
  }

  const weeks: ForecastWeek[] = [];
  let balance = options.openingCash;

  for (let i = 0; i < weekCount; i += 1) {
    const from = addDays(start, i * 7);
    const to = addDays(from, 6);

    // 예정입금 — 계산서가 발행된 미수의 입금예정일만. 발행 전은 넣지 않는다 (원칙 4)
    const inflowEntries = entries.filter(
      e =>
        isUncollected(e) &&
        e.invoiceIssued === true &&
        e.amount != null &&
        e.dueDate != null &&
        e.dueDate >= from &&
        e.dueDate <= to
    );
    // 예정지출 — 확정·승인 대기 중 아직 나가지 않은 건
    const outflowEntries = entries.filter(
      e =>
        e.direction === "out" &&
        e.paidAt == null &&
        e.amount != null &&
        (e.status === "confirmed" || e.status === "pending") &&
        (e.cashDate ?? e.dueDate) != null &&
        (e.cashDate ?? e.dueDate)! >= from &&
        (e.cashDate ?? e.dueDate)! <= to
    );
    const repayments = debtSchedules.filter(
      s => s.dueDate >= from && s.dueDate <= to
    );

    const inflow = Math.round(
      inflowEntries.reduce((acc, e) => acc + (e.amount ?? 0), 0) * factor.inflow
    );
    const outflow = Math.round(
      (outflowEntries.reduce((acc, e) => acc + (e.amount ?? 0), 0) +
        repayments.reduce((acc, s) => acc + s.principal + s.interest, 0)) *
        factor.outflow
    );

    const open = balance;
    const close = open == null ? null : open + inflow - outflow;
    weeks.push({
      index: i + 1,
      start: from,
      end: to,
      open,
      inflow,
      outflow,
      close,
      inflowCodes: inflowEntries.map(e => e.code),
      outflowCodes: outflowEntries.map(e => e.code),
    });
    balance = close;
  }

  const overdue = entries.filter(
    e =>
      isUncollected(e) &&
      e.invoiceIssued === true &&
      e.amount != null &&
      e.dueDate != null &&
      e.dueDate < start
  );
  if (overdue.length > 0) {
    blockers.push(
      `입금예정일이 지난 미수 ${overdue.length}건은 어느 주차에도 반영되지 않았습니다 — 회수 일정이 잡히면 그 주차에 들어갑니다`
    );
  }

  const firstNegative = weeks.find(w => w.close != null && w.close < 0) ?? null;
  return {
    scenario,
    weeks,
    firstNegativeWeek: firstNegative?.index ?? null,
    expectedRunwayWeeks:
      options.openingCash == null
        ? null
        : firstNegative
          ? firstNegative.index - 1
          : weekCount,
    overdueNotScheduled: {
      amount: overdue.reduce((acc, e) => acc + (e.amount ?? 0), 0),
      codes: overdue.map(e => e.code),
    },
    blockers,
  };
}

/** 연체 일수 — 채권 화면과 13주가 같은 기준을 쓰도록 공유 */
export { daysBetween };
