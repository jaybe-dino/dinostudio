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
  /**
   * **시트(일계)에 적혀 있는 종료 잔액** — 계산값이 아니라 기록이다.
   *
   * 계산 종료 잔액(`close`)은 판정 대기가 하나라도 있으면 null 이 된다
   * (원칙 8 — 모르면 계산하지 않는다). 그런데 이 회사의 현금흐름 시트에는
   * **그 날 실제 잔액이 사람 손으로 적혀** 있고, 대표님은 매일 그 숫자를
   * 보신다. 계산이 안 된다는 이유로 그 기록까지 감추면 화면이 시트보다
   * 못해진다.
   *
   * 그래서 둘을 **따로** 들고 간다. 지어내지도 않고, 적힌 것을 버리지도
   * 않는다. 어느 쪽인지는 화면이 이름으로 구분해 준다.
   */
  recordedClose: number | null;
  /** 그 기록이 **어느 날짜의 것인지** — 월·연 블록은 기간 안 마지막 기록일 */
  recordedAsOf: string | null;
  /**
   * 계산값 − 기록값. 둘 다 있을 때만 나온다.
   *
   * 0 이 아니면 **원장에 아직 안 들어온 돈이 그만큼 있다는 뜻**이다.
   * 숨기지 않는다 — 이 차이가 곧 남은 일의 크기다.
   */
  closeGap: number | null;
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
  /** 오늘 — 일별 보기에서 맨 위에 고정된다 */
  isToday?: boolean;
  /** 아직 오지 않은 날 — 시트에 미리 적어 둔 집행 예정분이다 */
  isFuture?: boolean;
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

    const recordedClose = snap?.close ?? null;

    blocks.push({
      unit: "day",
      key: date,
      open,
      inSum,
      outSum,
      close,
      recordedClose,
      recordedAsOf: recordedClose == null ? null : date,
      closeGap:
        close != null && recordedClose != null ? close - recordedClose : null,
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
      /*
       * 기록 잔액은 **기간 안에서 마지막으로 적힌 날**의 것을 쓴다.
       *
       * 마지막 날의 것을 그냥 쓰면 안 된다 — 시트의 마지막 날은 아직 종료
       * 잔액이 안 적혀 있을 수 있다 (9/22 가 그렇다). 그때 null 을 내보내면
       * 바로 전날 적혀 있는 잔액까지 함께 사라진다. 대신 며칠 자 기록인지를
       * `recordedAsOf` 로 함께 보낸다 — 화면이 「9/21 기준」이라고 말할 수
       * 있어야 한다.
       */
      const recorded = [...days].reverse().find(d => d.recordedClose != null);
      const recordedClose = recorded?.recordedClose ?? null;
      return {
        unit,
        key,
        open: firstDay.open,
        inSum: days.reduce((acc, d) => acc + d.inSum, 0),
        outSum: days.reduce((acc, d) => acc + d.outSum, 0),
        close: lastDay.close,
        recordedClose,
        recordedAsOf: recorded?.recordedAsOf ?? null,
        closeGap:
          lastDay.close != null && recordedClose != null
            ? lastDay.close - recordedClose
            : null,
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

/**
 * 블록 사이의 빈 구간 (일별 보기).
 *
 * 왜 필요한가 — 일별 보기는 **움직임이 있는 날만** 줄로 만든다. 그래서
 * 9월 1일 다음이 9월 30일이면 「왜 갑자기 뛰나」로 읽힌다. 실제로는 그 사이
 * 28일간 입출금이 없었던 것이고, 잔액은 그대로였다.
 *
 * 빈 날을 0원 줄로 채우지 않는다 — 30줄이 늘어나면 정작 움직인 날이 안 보인다.
 * 대신 「여기서 며칠 비었고 잔액은 그대로였다」를 한 줄로 끼운다.
 */
export interface CashflowGap {
  /** 앞 블록의 다음 날 */
  from: string;
  /** 뒤 블록의 전날 */
  to: string;
  /** 비어 있는 일수 */
  days: number;
  /** 그 구간 내내 유지된 잔액. 앞 블록의 종료 잔액이 null 이면 null */
  balance: number | null;
  /** 계산이 안 될 때 대신 보여 줄 **시트에 적힌** 잔액 */
  recordedBalance: number | null;
}

function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysApart(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * 이어지지 않는 두 일별 블록 사이의 빈 구간을 찾는다.
 * 일별 보기에서만 의미가 있다 — 월별·연별은 단위 자체가 구간이다.
 */
export function cashflowGap(
  previous: CashflowBlock,
  next: CashflowBlock
): CashflowGap | null {
  if (previous.unit !== "day" || next.unit !== "day") return null;
  const days = daysApart(previous.key, next.key) - 1;
  if (days <= 0) return null;
  return {
    from: shiftDay(previous.key, 1),
    to: shiftDay(next.key, -1),
    days,
    balance: previous.close,
    recordedBalance: previous.recordedClose,
  };
}

/**
 * 일별 보기를 **오늘 기준**으로 세운다.
 *
 * 왜 필요한가 — 블록은 「움직임이 있는 날」에만 생긴다. 그런데 이 회사의
 * 현금흐름 시트에는 **앞으로 나갈 돈이 미리 적혀 있다.** 그래서 최신순으로
 * 늘어놓으면 맨 위가 오늘이 아니라 제일 먼 예정일(예: 9/18)이 된다. 화면을
 * 열었을 때 오늘이 아닌 날짜가 먼저 보이면 그 숫자를 오늘 잔액으로 읽게 된다.
 *
 * 그래서 세 가지를 한다.
 *   ① 오늘 블록이 없으면 **만든다** — 움직임 0, 잔액은 직전 날에서 이어받는다
 *   ② 오늘을 맨 위에 둔다
 *   ③ 아직 오지 않은 날에 `isFuture` 를 붙인다. 지나간 실적과 앞으로 나갈
 *      예정을 화면에서 같은 것으로 보면 안 된다
 */
export function anchorToday(
  blocks: CashflowBlock[],
  today: string
): CashflowBlock[] {
  const marked = blocks.map(block => ({
    ...block,
    isToday: block.key === today,
    isFuture: block.key > today,
  }));

  if (!marked.some(block => block.isToday)) {
    // 오늘 직전까지의 마지막 블록에서 잔액을 이어받는다
    const previous = marked.filter(block => block.key < today).at(-1);
    marked.push({
      unit: "day",
      key: today,
      open: previous?.close ?? null,
      inSum: 0,
      outSum: 0,
      close: previous?.close ?? null,
      /*
       * 움직임이 없는 날이므로 기록 잔액도 직전 날 것을 그대로 이어받는다.
       * 「오늘 얼마 있나」에 답하려고 만든 줄인데 여기만 비어 있으면 그 줄이
       * 아무것도 안 알려 준다. 언제 적힌 잔액인지(`recordedAsOf`)도 직전
       * 날짜 그대로 들고 온다 — 오늘 자로 둔갑시키지 않는다.
       */
      recordedClose: previous?.recordedClose ?? null,
      recordedAsOf: previous?.recordedAsOf ?? null,
      closeGap: null,
      nullReason:
        previous?.close == null ? (previous?.nullReason ?? null) : null,
      undecided: [],
      outEntries: [],
      inEntries: [],
      pendingEntries: [],
      isMigrated: false,
      isToday: true,
      isFuture: false,
    });
  }

  const todayBlock = marked.find(block => block.isToday)!;
  const rest = marked
    .filter(block => !block.isToday)
    .sort((a, b) => (a.key < b.key ? 1 : -1));
  return [todayBlock, ...rest];
}
