/**
 * 은행 대사 (docs/erp-qa.md C6)
 *
 * 상단바의 「대사 차액 0」은 지금까지 표시일 뿐이었다. 이 모듈이 그것을 사실로 만든다.
 *
 * **입구를 갈아끼울 수 있게 짠다.** 지금은 기업은행 인터넷뱅킹에서 받은 CSV 를
 * 붙여넣지만, 나중에 은행 API 가 붙으면 `parseBankStatement` 앞단만 바뀌고
 * 대사 로직(`reconcile`)은 그대로 쓴다. 대사를 API 에 묶어 짜면 나중에 다시 짜야 한다.
 *
 * 대사의 목적은 「맞추기」가 아니라 **「안 맞는 것만 남기기」** 다.
 * 자동으로 맞춘 것은 조용히 넘기고, 사람이 봐야 하는 것만 화면에 올린다.
 */
import { parseAmount, parseDate, splitTable } from "./sheetImport.js";
import type { Entry } from "./types.js";

/** 은행 거래내역 한 줄 — 어느 은행에서 왔든 이 모양으로 바꾼다 */
export interface BankTxn {
  /** 거래일 YYYY-MM-DD */
  date: string;
  /** 적요 · 거래처명 */
  description: string;
  /** 출금액 (양수) */
  out: number | null;
  /** 입금액 (양수) */
  in: number | null;
  /** 거래 후 잔액 — 있으면 잔액 체인 검증에 쓴다 */
  balance: number | null;
  /** 원본 줄 — 사람이 확인할 때 쓴다 */
  raw: string;
}

export interface BankParseResult {
  txns: BankTxn[];
  /** 읽지 못한 줄 — 버리지 않고 그대로 돌려준다 */
  skipped: { line: string; why: string }[];
}

/** 기업은행 거래내역 헤더에서 자주 보이는 이름들 */
const COLUMN_HINTS: Record<keyof BankTxn, string[]> = {
  date: ["거래일자", "거래일시", "거래일", "일자", "날짜"],
  description: ["적요", "내용", "거래내용", "기재내용", "거래기록사항", "비고"],
  out: ["출금", "출금액", "지급", "출금금액", "차변"],
  in: ["입금", "입금액", "입금금액", "대변"],
  balance: ["잔액", "거래후잔액", "잔고"],
  raw: [],
};

function findColumn(header: string[], key: keyof BankTxn): number | null {
  const normalized = header.map(h => h.replace(/\s|\(|\)/g, ""));
  for (const hint of COLUMN_HINTS[key]) {
    const index = normalized.findIndex(h => h.includes(hint));
    if (index >= 0) return index;
  }
  return null;
}

/**
 * 붙여넣은 거래내역을 표준 모양으로 바꾼다.
 *
 * 은행마다 컬럼 이름이 다르므로 헤더에서 찾는다. 못 찾으면 그 줄을 버리지 않고
 * skipped 에 이유와 함께 남긴다 — 조용히 사라지면 잔액이 안 맞는 이유를 못 찾는다.
 */
export function parseBankStatement(
  text: string,
  fallbackYear: number
): BankParseResult {
  const rows = splitTable(text);
  const skipped: { line: string; why: string }[] = [];
  if (rows.length === 0) return { txns: [], skipped };

  const header = rows[0];
  const dateAt = findColumn(header, "date");
  const hasHeader = dateAt != null;
  if (!hasHeader)
    return {
      txns: [],
      skipped: [
        {
          line: header.join(" | "),
          why: "첫 줄에서 거래일자 컬럼을 찾지 못했습니다 — 헤더를 포함해 붙여넣으십시오",
        },
      ],
    };

  const cols = {
    date: dateAt,
    description: findColumn(header, "description"),
    out: findColumn(header, "out"),
    in: findColumn(header, "in"),
    balance: findColumn(header, "balance"),
  };

  if (cols.out == null && cols.in == null)
    return {
      txns: [],
      skipped: [
        {
          line: header.join(" | "),
          why: "출금·입금 컬럼을 찾지 못했습니다",
        },
      ],
    };

  const txns: BankTxn[] = [];
  for (const row of rows.slice(1)) {
    const raw = row.join(" | ");
    const rawDate = row[cols.date] ?? "";
    // 「2026-09-01 14:23:11」처럼 시각이 붙어 오는 은행이 있다
    const date = parseDate(rawDate.split(/[ T]/)[0], fallbackYear);
    if (!date) {
      skipped.push({
        line: raw,
        why: `거래일자를 읽지 못했습니다: "${rawDate}"`,
      });
      continue;
    }
    const out = cols.out != null ? parseAmount(row[cols.out]) : null;
    const inAmount = cols.in != null ? parseAmount(row[cols.in]) : null;
    if (!out && !inAmount) {
      skipped.push({ line: raw, why: "출금·입금이 모두 비어 있습니다" });
      continue;
    }
    txns.push({
      date,
      description:
        cols.description != null ? (row[cols.description] ?? "") : "",
      out: out || null,
      in: inAmount || null,
      balance: cols.balance != null ? parseAmount(row[cols.balance]) : null,
      raw,
    });
  }
  return { txns, skipped };
}

/** 대사 결과 한 건 */
export interface MatchPair {
  txn: BankTxn;
  entry: Entry | null;
  /** exact = 날짜·금액 일치 · near = 금액 같고 날짜가 며칠 어긋남 */
  kind: "exact" | "near" | "none";
  /** near 일 때 며칠 차이인지 */
  dayGap: number | null;
}

export interface ReconcileResult {
  matched: MatchPair[];
  /** 통장에 있는데 원장에 없는 것 — 입력 누락이다 */
  bankOnly: BankTxn[];
  /** 원장에 있는데 통장에 없는 것 — 아직 안 나갔거나 잘못 넣었다 */
  ledgerOnly: Entry[];
  /** 통장 출금 합 − 원장 지출 합 */
  difference: {
    bankOut: number;
    bankIn: number;
    ledgerOut: number;
    ledgerIn: number;
    outGap: number;
    inGap: number;
  };
}

/** 날짜가 며칠 떨어져 있나 */
function dayDistance(a: string, b: string): number {
  const ms =
    new Date(`${a}T00:00:00+09:00`).getTime() -
    new Date(`${b}T00:00:00+09:00`).getTime();
  return Math.abs(Math.round(ms / 86_400_000));
}

/** 며칠까지 같은 거래로 볼 것인가 — 카드 매입은 며칠 밀려 찍힌다 */
export const NEAR_MATCH_DAYS = 3;

/**
 * 통장과 원장을 맞춘다.
 *
 * 금액이 같은 것부터 짝을 짓고, 같은 금액이 여럿이면 날짜가 가까운 것을 고른다.
 * 한 원장 건은 한 번만 쓰인다 — 같은 건에 두 거래가 붙으면 잔액이 두 번 빠진다.
 */
export function reconcile(
  txns: BankTxn[],
  entries: Entry[],
  options: { accountFilter?: string | null } = {}
): ReconcileResult {
  // 대사 대상은 실제로 돈이 움직인 건이다 — 승인 대기는 아직 통장에 없다
  const candidates = entries.filter(
    e =>
      e.status === "confirmed" &&
      e.amount != null &&
      e.cashDate != null &&
      (options.accountFilter == null ||
        e.bankAccount == null ||
        e.bankAccount === options.accountFilter)
  );

  const used = new Set<string>();
  const matched: MatchPair[] = [];
  const bankOnly: BankTxn[] = [];

  for (const txn of txns) {
    const amount = txn.out ?? txn.in ?? 0;
    const direction = txn.out ? "out" : "in";

    const pool = candidates.filter(
      e =>
        !used.has(e.id) &&
        e.direction === direction &&
        Math.abs(e.amount ?? 0) === amount
    );

    if (pool.length === 0) {
      bankOnly.push(txn);
      continue;
    }

    // 날짜가 가장 가까운 것을 고른다
    pool.sort(
      (a, b) =>
        dayDistance(txn.date, a.cashDate!) - dayDistance(txn.date, b.cashDate!)
    );
    const best = pool[0];
    const gap = dayDistance(txn.date, best.cashDate!);

    if (gap === 0) {
      used.add(best.id);
      matched.push({ txn, entry: best, kind: "exact", dayGap: 0 });
    } else if (gap <= NEAR_MATCH_DAYS) {
      used.add(best.id);
      matched.push({ txn, entry: best, kind: "near", dayGap: gap });
    } else {
      // 금액은 같은데 날짜가 너무 멀다 — 같은 거래라고 단정하지 않는다
      bankOnly.push(txn);
    }
  }

  const ledgerOnly = candidates.filter(e => !used.has(e.id));

  const sum = (list: { amount?: number | null }[], sign: "out" | "in") =>
    list.reduce((acc, x) => acc + (x.amount ?? 0), 0) *
    (sign === "out" ? 1 : 1);

  const bankOut = txns.reduce((acc, t) => acc + (t.out ?? 0), 0);
  const bankIn = txns.reduce((acc, t) => acc + (t.in ?? 0), 0);
  const ledgerOut = sum(
    candidates.filter(e => e.direction === "out"),
    "out"
  );
  const ledgerIn = sum(
    candidates.filter(e => e.direction === "in"),
    "in"
  );

  return {
    matched,
    bankOnly,
    ledgerOnly,
    difference: {
      bankOut,
      bankIn,
      ledgerOut,
      ledgerIn,
      outGap: bankOut - ledgerOut,
      inGap: bankIn - ledgerIn,
    },
  };
}

/**
 * 통장 잔액 체인이 이어지는가.
 *
 * 은행이 준 「거래 후 잔액」끼리 맞는지 본다. 여기가 깨지면 붙여넣기가
 * 잘렸거나 줄이 빠진 것이다 — 대사를 하기 전에 먼저 알아야 한다.
 */
export function checkBalanceChain(txns: BankTxn[]): {
  ok: boolean;
  breaks: { at: string; expected: number; actual: number }[];
} {
  const breaks: { at: string; expected: number; actual: number }[] = [];
  const withBalance = txns.filter(t => t.balance != null);
  for (let i = 1; i < withBalance.length; i += 1) {
    const prev = withBalance[i - 1];
    const cur = withBalance[i];
    const expected = prev.balance! - (cur.out ?? 0) + (cur.in ?? 0);
    if (expected !== cur.balance)
      breaks.push({ at: cur.date, expected, actual: cur.balance! });
  }
  return { ok: breaks.length === 0, breaks };
}
