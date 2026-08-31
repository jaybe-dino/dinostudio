/**
 * §9.1 현금흐름표
 *
 *   day_open(d)  = day_close(d−1)
 *   지출계(d)    = Σ entry[cash_date=d, out, confirmed, amount≠null]
 *   입금계(d)    = Σ entry[cash_date=d, in,  confirmed, amount≠null]
 *   day_close(d) = day_open(d) + 입금계 − 지출계
 *
 * 미확정 승계 — 판정 대기가 하나라도 남은 날부터 종료 잔액을 확정하지 않고
 * 이후 일자로 null을 승계한다. 버그가 아니라 요구사항이다 (원칙 8 · T5).
 *
 * 파생 뷰는 계산 결과이고 저장하지 않는다 (§4). 이 파일에 부수효과가 없어야 한다.
 */
import { countsInCashflow } from "./status.js";
import type { DaySnapshot, Entry } from "./types.js";

export type CashflowUnit = "day" | "month" | "year";

export interface UndecidedRef {
  code: string;
  reason: string;
}

export interface CashflowBlock {
  unit: CashflowUnit;
  /** day: 2026-08-28 · month: 2026-08 · year: 2026 */
  key: string;
  open: number | null;
  inSum: number;
  outSum: number;
  close: number | null;
  /** §10.2 ① — null이면 왜 null인지가 함께 온다 */
  nullReason: string | null;
  undecided: UndecidedRef[];
  /** 지출은 왼쪽, 수입은 오른쪽 (§9.1) */
  outEntries: Entry[];
  inEntries: Entry[];
  /** 승인 대기 — 블록마다 분리된 패널 (§9.1 · 원칙 13) */
  pendingEntries: Entry[];
  /** 이관 구간 배지 — 건별 조회·계정 태깅·전표 생성 불가 (§5.3) */
  isMigrated: boolean;
}

const UNDECIDED_CARRYOVER = "undecided_carryover";

export function blockKey(date: string, unit: CashflowUnit): string {
  if (unit === "day") return date;
  if (unit === "month") return date.slice(0, 7);
  return date.slice(0, 4);
}

function sum(entries: Entry[]): number {
  let total = 0;
  for (const e of entries) if (e.amount != null) total += e.amount;
  return total;
}

/**
 * 일별 체인을 만든다. 이관 구간(day_snapshot)은 일계를 그대로 쓰고,
 * DB 구간은 원장에서 접는다. 두 구간 사이는 전일 종료 = 당일 시작으로 이어진다.
 */
export function buildDailyBlocks(
  entries: Entry[],
  snapshots: DaySnapshot[]
): CashflowBlock[] {
  const byDate = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!e.cashDate) continue;
    const list = byDate.get(e.cashDate);
    if (list) list.push(e);
    else byDate.set(e.cashDate, [e]);
  }

  const snapByDate = new Map(snapshots.map(s => [s.date, s]));
  const dates = Array.from(
    new Set(Array.from(byDate.keys()).concat(Array.from(snapByDate.keys())))
  ).sort();

  const blocks: CashflowBlock[] = [];
  let carry: number | null = null;
  let carryNullReason: string | null = null;
  let first = true;

  for (const date of dates) {
    const snap = snapByDate.get(date);
    const dayEntries = byDate.get(date) ?? [];

    const outEntries = dayEntries.filter(
      e => e.direction === "out" && countsInCashflow(e.status, e.amount)
    );
    const inEntries = dayEntries.filter(
      e => e.direction === "in" && countsInCashflow(e.status, e.amount)
    );
    const pendingEntries = dayEntries.filter(e => e.status === "pending");
    const undecided: UndecidedRef[] = dayEntries
      .filter(e => e.status === "undecided")
      .map(e => ({ code: e.code, reason: e.undecidedReason ?? "판정 대기" }));

    // 이관 구간은 일계가 원본이다. DB 구간은 원장에서 접는다.
    const outSum = snap?.isMigrated ? snap.outSum : sum(outEntries);
    const inSum = snap?.isMigrated ? snap.inSum : sum(inEntries);

    let open: number | null;
    if (first) {
      open = snap?.open ?? null;
      first = false;
    } else {
      open = carry;
    }

    let close: number | null;
    let nullReason: string | null = null;
    if (undecided.length > 0) {
      // 미확정 승계 — 이 날부터 종료 잔액을 확정하지 않는다
      close = null;
      nullReason = UNDECIDED_CARRYOVER;
    } else if (open == null) {
      close = null;
      nullReason = carryNullReason ?? UNDECIDED_CARRYOVER;
    } else {
      close = open + inSum - outSum;
    }

    blocks.push({
      unit: "day",
      key: date,
      open,
      inSum,
      outSum,
      close,
      nullReason:
        open == null || close == null
          ? (nullReason ?? UNDECIDED_CARRYOVER)
          : null,
      undecided,
      outEntries,
      inEntries,
      pendingEntries,
      isMigrated: snap?.isMigrated ?? false,
    });

    carry = close;
    if (close == null) carryNullReason = nullReason ?? UNDECIDED_CARRYOVER;
  }

  return blocks;
}

/**
 * 월 · 연은 같은 식을 기간 단위로 접는다 —
 * open = 기간 첫날 open, close = 기간 마지막날 close (§9.1). 블록 구조는 동일하다 (T14).
 */
export function foldBlocks(
  daily: CashflowBlock[],
  unit: CashflowUnit
): CashflowBlock[] {
  if (unit === "day") return daily;

  const groups = new Map<string, CashflowBlock[]>();
  for (const block of daily) {
    const key = blockKey(block.key, unit);
    const list = groups.get(key);
    if (list) list.push(block);
    else groups.set(key, [block]);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, days]: [string, CashflowBlock[]]) => {
      const firstDay = days[0];
      const lastDay = days[days.length - 1];
      const undecided = days.flatMap(d => d.undecided);
      return {
        unit,
        key,
        open: firstDay.open,
        inSum: days.reduce((acc, d) => acc + d.inSum, 0),
        outSum: days.reduce((acc, d) => acc + d.outSum, 0),
        close: lastDay.close,
        nullReason:
          lastDay.close == null
            ? (lastDay.nullReason ?? UNDECIDED_CARRYOVER)
            : null,
        undecided,
        outEntries: days.flatMap(d => d.outEntries),
        inEntries: days.flatMap(d => d.inEntries),
        pendingEntries: days.flatMap(d => d.pendingEntries),
        isMigrated: days.some(d => d.isMigrated),
      } satisfies CashflowBlock;
    });
}

export function buildCashflow(
  entries: Entry[],
  snapshots: DaySnapshot[],
  unit: CashflowUnit = "month"
): CashflowBlock[] {
  return foldBlocks(buildDailyBlocks(entries, snapshots), unit);
}

/** §10.2 ③ 확정 지출·수입 합계 + 무엇이 빠졌는지 */
export function confirmedTotals(entries: Entry[], direction: "out" | "in") {
  const scoped = entries.filter(e => e.direction === direction);
  const confirmed = scoped.filter(e => countsInCashflow(e.status, e.amount));
  const pending = scoped.filter(e => e.status === "pending");
  const undecided = scoped.filter(e => e.status === "undecided");
  const pendingAmount = pending.filter(e => e.amount != null);
  return {
    sum: sum(confirmed),
    count: confirmed.length,
    excluded: {
      pending: {
        n: pending.length,
        amount: pendingAmount.length > 0 ? sum(pendingAmount) : null,
      },
      undecided: {
        n: undecided.length,
        // 금액이 확정되지 않았으므로 합계가 아니라 null이다 (원칙 8)
        amount: null,
      },
    },
  };
}
