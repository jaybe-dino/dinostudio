/**
 * 4차 마무리 항목 (docs/erp-qa.md A7·A8·A10·A13·A14·A16·C4·C7·C8·D6)
 *
 * 개별로는 작지만 전부 「사람이 손으로 메우고 있던」 것들이다.
 */
import { ACCOUNTS, findAccount } from "./accounts.js";
import { parseCode } from "./codes.js";
import type { Entry, Journal } from "./types.js";

/* ── A14 전표 번호 ─────────────────────────────────────────────────────── */

/**
 * 전표 번호 — `2026-08-0001` 형태 연월-순번.
 *
 * UUID 는 감사·세무조정에서 사람이 참조할 수 없다. 「8월 12번 전표 좀 봅시다」가
 * 안 된다. UUID 는 내부 키로 남기고 사람이 읽는 번호를 따로 둔다.
 */
export function journalNumber(journalDate: string, sequence: number): string {
  const ym = journalDate.slice(0, 7);
  return `${ym}-${String(sequence).padStart(4, "0")}`;
}

/** 같은 달의 기존 전표 번호에서 다음 순번을 찾는다 */
export function nextJournalNumber(
  journalDate: string,
  existing: (string | null | undefined)[]
): string {
  const ym = journalDate.slice(0, 7);
  const used = existing
    .filter((n): n is string => typeof n === "string" && n.startsWith(ym))
    .map(n => Number(n.slice(8)))
    .filter(n => Number.isFinite(n));
  const next = used.length === 0 ? 1 : Math.max(...used) + 1;
  return journalNumber(journalDate, next);
}

/* ── A10 계정과목 결산 매핑 ────────────────────────────────────────────── */

/** 재무제표에서 이 계정이 앉는 줄 */
export type FsLine =
  | "유동자산"
  | "비유동자산"
  | "유동부채"
  | "비유동부채"
  | "자본"
  | "매출"
  | "매출원가"
  | "판매비와관리비"
  | "영업외수익"
  | "영업외비용"
  | "미분류";

/**
 * 계정 → 재무제표 줄.
 *
 * 지금까지 이 매핑이 코드 여러 곳에 흩어져 있었다. 한 곳에 모으면
 * 재무제표 5종이 이것만 보면 되고, 계정을 추가할 때 고칠 자리가 하나가 된다.
 */
export function fsLineOf(accountCode: string | null | undefined): FsLine {
  const account = findAccount(accountCode ?? "");
  if (!account) return "미분류";
  switch (account.type) {
    case "매출":
      return "매출";
    case "매출원가":
      return "매출원가";
    case "판관비":
      return "판매비와관리비";
    case "영업외수익":
      return "영업외수익";
    case "영업외비용":
      return "영업외비용";
    case "자본":
      return "자본";
    case "유형자산":
    case "기타자산":
      return "비유동자산";
    case "자산":
      return "유동자산";
    case "부채":
      // 장기차입금만 비유동으로 본다. 나머지는 1년 내 결제된다
      return accountCode === "2310" ? "비유동부채" : "유동부채";
    default:
      return "미분류";
  }
}

/** 결산 매핑 전체 — 화면에서 표로 보여 준다 */
export function fsMapping(): { code: string; name: string; fsLine: FsLine }[] {
  return ACCOUNTS.map(a => ({
    code: a.code,
    name: a.name,
    fsLine: fsLineOf(a.code),
  }));
}

/* ── A13 계정별 보조부 (총계정원장) ────────────────────────────────────── */

export interface LedgerRow {
  journalId: string;
  journalNo: string | null;
  date: string;
  memo: string | null;
  debit: number;
  credit: number;
  /** 이 줄까지의 누계 잔액 */
  balance: number;
  entryId: string;
}

export interface AccountLedger {
  accountCode: string;
  accountName: string;
  /** 자산·비용은 차변이 플러스, 부채·자본·수익은 대변이 플러스 */
  normalSide: "차변" | "대변";
  opening: number;
  rows: LedgerRow[];
  closing: number;
}

function normalSideOf(accountCode: string): "차변" | "대변" {
  const account = findAccount(accountCode);
  if (!account) return "차변";
  return ["부채", "자본", "매출", "영업외수익"].includes(account.type)
    ? "대변"
    : "차변";
}

/**
 * 계정별 원장 (A13).
 *
 * 계정과목 체계는 있었지만 「그 계정에 무엇이 들어왔나」를 볼 방법이 없었다.
 * 잔액이 이상할 때 이 화면 없이는 원인을 찾을 수 없다.
 */
export function accountLedger(
  accountCode: string,
  journals: Journal[],
  options: { from?: string | null; to?: string | null } = {}
): AccountLedger {
  const side = normalSideOf(accountCode);
  const sign = (debit: number, credit: number) =>
    side === "차변" ? debit - credit : credit - debit;

  const all = journals
    .flatMap(j =>
      j.lines
        .filter(l => l.accountCode === accountCode)
        .map(l => ({ journal: j, line: l }))
    )
    .sort((a, b) =>
      `${a.journal.journalDate}${a.journal.id}` <
      `${b.journal.journalDate}${b.journal.id}`
        ? -1
        : 1
    );

  // 기간 시작 전 누계가 기초잔액이다
  const before = options.from
    ? all.filter(x => x.journal.journalDate < options.from!)
    : [];
  const opening = before.reduce(
    (sum, x) => sum + sign(x.line.debit, x.line.credit),
    0
  );

  const inRange = all.filter(
    x =>
      (!options.from || x.journal.journalDate >= options.from) &&
      (!options.to || x.journal.journalDate <= options.to)
  );

  let balance = opening;
  const rows: LedgerRow[] = inRange.map(x => {
    balance += sign(x.line.debit, x.line.credit);
    return {
      journalId: x.journal.id,
      journalNo: x.journal.journalNo ?? null,
      date: x.journal.journalDate,
      memo: x.journal.memo,
      debit: x.line.debit,
      credit: x.line.credit,
      balance,
      entryId: x.journal.entryId,
    };
  });

  return {
    accountCode,
    accountName: findAccount(accountCode)?.name ?? accountCode,
    normalSide: side,
    opening,
    rows,
    closing: balance,
  };
}

/* ── A7 선급비용 · 선수수익 이연 ───────────────────────────────────────── */

export interface DeferralSchedule {
  month: string;
  amount: number;
}

/**
 * 이연 배분 (A7) — 연간 결제를 월할로 나눈다.
 *
 * 연간 SaaS 를 결제월에 전액 잡으면 그 달만 손익이 튀고 나머지 11개월은
 * 실제보다 좋아 보인다.
 *
 * 반올림 잔차는 **마지막 달에** 몰아 넣는다. 매달 조금씩 흘리면 합이 원금과 어긋난다.
 */
export function deferralSchedule(
  amount: number,
  startMonth: string,
  months: number
): DeferralSchedule[] {
  if (months <= 0) return [];
  const per = Math.floor(Math.abs(amount) / months);
  const sign = amount < 0 ? -1 : 1;
  const rows: DeferralSchedule[] = [];
  let assigned = 0;

  const [year, month] = startMonth.split("-").map(Number);
  for (let i = 0; i < months; i += 1) {
    const m = month + i;
    const y = year + Math.floor((m - 1) / 12);
    const mm = ((m - 1) % 12) + 1;
    const last = i === months - 1;
    const value = last ? Math.abs(amount) - assigned : per;
    assigned += value;
    rows.push({
      month: `${y}-${String(mm).padStart(2, "0")}`,
      amount: sign * value,
    });
  }
  return rows;
}

/* ── A8 외화 ───────────────────────────────────────────────────────────── */

export interface FxInput {
  amount: number;
  currency: string;
  /** 1 외화당 원화 */
  rate: number | null;
}

/**
 * 외화를 원화로 환산한다 (A8).
 * 환율을 모르면 환산하지 않는다 — 임의 환율로 원장에 넣으면 나중에 못 고친다.
 */
export function toKrw(input: FxInput): {
  krw: number | null;
  reason: string | null;
} {
  if (input.currency === "KRW") return { krw: input.amount, reason: null };
  if (input.rate == null || input.rate <= 0)
    return {
      krw: null,
      reason: `${input.currency} 환율이 입력되지 않았습니다 — 임의 환율로 원장에 넣지 않습니다`,
    };
  return { krw: Math.round(input.amount * input.rate), reason: null };
}

/* ── C4 여신 · 한도 ────────────────────────────────────────────────────── */

export interface CreditLine {
  id: string;
  name: string;
  kind: "마이너스통장" | "법인카드" | "기타";
  limit: number;
  used: number;
}

export interface CreditSummary {
  lines: (CreditLine & { available: number; usageRate: number })[];
  totalLimit: number;
  totalUsed: number;
  totalAvailable: number;
}

/**
 * 여신 한도 (C4).
 * 마이너스통장·카드 한도는 실질 유동성인데 현금 현황에 안 보였다.
 * 「즉시 동원 가능액」을 알아야 부족액의 의미가 달라진다.
 */
export function creditSummary(lines: CreditLine[]): CreditSummary {
  const rows = lines.map(l => ({
    ...l,
    available: Math.max(0, l.limit - l.used),
    usageRate: l.limit > 0 ? Math.round((l.used / l.limit) * 1000) / 10 : 0,
  }));
  return {
    lines: rows,
    totalLimit: rows.reduce((s, l) => s + l.limit, 0),
    totalUsed: rows.reduce((s, l) => s + l.used, 0),
    totalAvailable: rows.reduce((s, l) => s + l.available, 0),
  };
}

/* ── C7 채권 연령 구간 ─────────────────────────────────────────────────── */

/** 기본 구간. 업종에 따라 다르므로 설정값으로 덮을 수 있다 */
export const DEFAULT_AGING_BUCKETS = [30, 60, 90] as const;

export function agingBucketLabel(
  days: number,
  buckets: readonly number[] = DEFAULT_AGING_BUCKETS
): string {
  const sorted = [...buckets].sort((a, b) => a - b);
  for (const b of sorted) if (days <= b) return `${b}일 이내`;
  return `${sorted[sorted.length - 1]}일 초과`;
}

/* ── C8 같은 등급 안에서의 지급 순서 ──────────────────────────────────── */

/**
 * 같은 우선순위 안에서 무엇을 먼저 낼 것인가 (C8).
 *
 * 순서 — ① 기한이 이미 지난 것 ② 기한이 가까운 것 ③ 금액이 큰 것.
 * 연체는 이자·신뢰 비용이 붙으므로 먼저다. 금액을 마지막에 두는 이유는
 * 큰 건을 먼저 내면 작은 건 여러 개가 동시에 연체되기 때문이다.
 */
export function paymentOrder(entries: Entry[], today: string): Entry[] {
  return [...entries].sort((a, b) => {
    const dueA = a.dueDate ?? a.cashDate ?? "9999-12-31";
    const dueB = b.dueDate ?? b.cashDate ?? "9999-12-31";
    const lateA = dueA < today ? 0 : 1;
    const lateB = dueB < today ? 0 : 1;
    if (lateA !== lateB) return lateA - lateB;
    if (dueA !== dueB) return dueA < dueB ? -1 : 1;
    return (b.amount ?? 0) - (a.amount ?? 0);
  });
}

/* ── D6 취소 사유 분류 ────────────────────────────────────────────────── */

/** 취소 사유 — 코드화하면 통계가 개선 근거가 된다 */
export const CANCEL_REASONS = [
  { code: "duplicate", label: "중복 입력", improve: "수집 중복 탐지를 조인다" },
  { code: "mistake", label: "오기재", improve: "입력 폼 검증을 늘린다" },
  {
    code: "cancelled",
    label: "거래 자체 취소",
    improve: "시스템 문제가 아니다",
  },
  {
    code: "reclassify",
    label: "계정 재분류",
    improve: "계정 판정 규칙을 손본다",
  },
  { code: "other", label: "기타", improve: "사유를 적어야 한다" },
] as const;

export type CancelReasonCode = (typeof CANCEL_REASONS)[number]["code"];

export function cancelReasonLabel(code: string): string {
  return CANCEL_REASONS.find(r => r.code === code)?.label ?? code;
}

/* ── A16 전표 대응 (원본 · 역분개 · 재분개) ──────────────────────────────── */

export interface JournalChainRow {
  role: "원본" | "역분개" | "재분개";
  journalId: string;
  journalNo: string | null;
  entryCode: string;
  journalDate: string;
  memo: string | null;
  /** 이 전표가 되돌리는 전표 — 역분개만 값이 있다 */
  reverses: string | null;
  debitTotal: number;
}

export interface JournalChain {
  baseCode: string;
  rows: JournalChainRow[];
  /** 원본이 죽고 재분개가 살아 있는지 — 순액이 두 번 잡히지 않았는지 */
  netEffect: number;
  balanced: boolean;
}

/**
 * 수정 이력이 전표에서 어떻게 대응되는지 (A16).
 *
 * 확정 후 계정을 바꾸면 `-R1` 수정본이 생기고 기존 전표는 역분개된다. 동작은
 * 맞았는데 **어느 전표가 어느 수정본에 대응하는지**를 화면에서 따라갈 수 없었다.
 * 감사·세무조정에서 이것을 못 보여 주면 「원장을 두 번 잡은 것 아니냐」는 질문에
 * 답할 방법이 없다.
 *
 * 순액을 같이 낸다 — 원본 + 역분개 = 0 이어야 하고, 남는 것은 재분개뿐이다.
 */
export function journalChains(
  journals: (Journal & { entryCode: string })[]
): JournalChain[] {
  const byBase = new Map<string, (Journal & { entryCode: string })[]>();
  for (const journal of journals) {
    const base = parseCode(journal.entryCode)?.baseCode ?? journal.entryCode;
    const list = byBase.get(base);
    if (list) list.push(journal);
    else byBase.set(base, [journal]);
  }

  const chains: JournalChain[] = [];
  for (const [baseCode, list] of Array.from(byBase.entries())) {
    // 수정이 한 번도 없었던 건은 대응표가 필요 없다
    const hasRevision = list.some(j => j.reversedBy != null);
    if (!hasRevision) continue;

    const sorted = [...list].sort((a, b) =>
      `${a.journalDate}${a.id}` < `${b.journalDate}${b.id}` ? -1 : 1
    );
    const reversedIds = new Set(
      sorted.map(j => j.reversedBy).filter((id): id is string => id != null)
    );

    const rows: JournalChainRow[] = sorted.map(j => ({
      role:
        j.reversedBy != null
          ? "역분개"
          : reversedIds.has(j.id)
            ? "원본"
            : "재분개",
      journalId: j.id,
      journalNo: j.journalNo ?? null,
      entryCode: j.entryCode,
      journalDate: j.journalDate,
      memo: j.memo,
      reverses: j.reversedBy ?? null,
      debitTotal: j.lines.reduce((sum, l) => sum + l.debit, 0),
    }));

    // 원본과 역분개는 서로 지워져야 한다 — 남는 것은 재분개 금액뿐이다
    const netEffect = rows.reduce(
      (sum, r) => sum + (r.role === "역분개" ? -r.debitTotal : r.debitTotal),
      0
    );
    const reissued = rows
      .filter(r => r.role === "재분개")
      .reduce((sum, r) => sum + r.debitTotal, 0);

    chains.push({
      baseCode,
      rows,
      netEffect,
      balanced: netEffect === reissued,
    });
  }
  return chains.sort((a, b) => a.baseCode.localeCompare(b.baseCode));
}
