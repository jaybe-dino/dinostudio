/**
 * §5.2 시트 → 원장 컬럼 매핑 — 구글 시트에서 복사한 표를 원장 건으로 바꾼다.
 *
 * 지금은 시트를 계속 쓰고 나중에 이 시스템으로 넘어오므로, 넘어오는 그 시점에
 * 「시트만 있던 구간」을 한 번 들여오는 경로가 필요하다. 이 파서가 그 경로다.
 *
 * 지켜야 할 것 (§5.2 · 원칙 8)
 *   · 적요 칸에 숫자가 있고 금액 칸이 비면 **금액으로 승격하지 않는다**. 후보로만 남긴다
 *   · 단위가 불명한 값(80 · 350 · 1,200)은 후보로도 올리지 않는다
 *   · 항목이 공란이면 판정 대기
 *   · 행을 버리지 않는다 — 파싱 실패도 판정 대기로 적재한다
 */
import { defaultPriorityOf } from "./accounts";
import { nextCode } from "./codes";
import type { DaySnapshot, Direction, Entry } from "./types";

/** 이 금액 미만이 적요 칸에만 있으면 단위(원/만원)를 판정할 수 없다고 본다 */
export const UNIT_UNKNOWN_BELOW = 10_000;

export interface SheetRow {
  /** 일자 — 실제 입출금일 */
  date: string;
  /** 항목 — 원문 그대로. 정리하지 않는다 */
  title: string;
  /** 적요 — 원문 보존 */
  note: string;
  /** 지출 금액 칸 */
  outAmount: string;
  /** 수입 금액 칸 */
  inAmount: string;
  /** 시작 잔액 */
  dayOpen: string;
  /** 종료 잔액 */
  dayClose: string;
}

export const SHEET_COLUMNS: {
  key: keyof SheetRow;
  label: string;
  required: boolean;
}[] = [
  { key: "date", label: "일자", required: true },
  { key: "title", label: "항목", required: true },
  { key: "note", label: "적요", required: false },
  { key: "outAmount", label: "지출", required: false },
  { key: "inAmount", label: "수입", required: false },
  { key: "dayOpen", label: "시작잔액", required: false },
  { key: "dayClose", label: "종료잔액", required: false },
];

/** "1,240,000" · "1240000원" · "-" → 숫자 또는 null */
export function parseAmount(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value);
}

/** 2026-08-26 · 2026.08.26 · 8/26 · 08/26 → YYYY-MM-DD */
export function parseDate(raw: string, fallbackYear: number): string | null {
  const text = raw.trim();
  if (!text) return null;
  const full = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(text);
  if (full)
    return `${full[1]}-${full[2].padStart(2, "0")}-${full[3].padStart(2, "0")}`;
  const short = /^(\d{1,2})[-./](\d{1,2})$/.exec(text);
  if (short) {
    return `${fallbackYear}-${short[1].padStart(2, "0")}-${short[2].padStart(2, "0")}`;
  }
  return null;
}

/** 적요에서 금액 후보를 뽑는다. 단위가 불명하면 올리지 않는다. */
export function candidateFromNote(note: string): number | null {
  const matches = note.match(/[0-9][0-9,]{2,}/g);
  if (!matches) return null;
  const values = matches
    .map(m => parseAmount(m))
    .filter((v): v is number => v != null);
  if (values.length === 0) return null;
  const largest = Math.max(...values);
  // 80 · 350 · 1,200 처럼 작은 수는 만원인지 원인지 알 수 없다 (§5.2)
  return largest >= UNIT_UNKNOWN_BELOW ? largest : null;
}

export interface ImportedEntry {
  entry: Entry;
  /** 사람이 봐야 하는 것 — 화면의 「검수」 열 */
  flags: string[];
  sourceLine: number;
}

export interface SheetImportResult {
  entries: ImportedEntry[];
  snapshots: DaySnapshot[];
  /** 열 매핑이나 일자 파싱에 실패해 적재할 수 없는 줄 */
  rejected: { line: number; raw: string; reason: string }[];
  summary: {
    total: number;
    ready: number;
    undecided: number;
    outSum: number;
    inSum: number;
  };
}

export interface SheetImportOptions {
  /** 이미 원장에 있는 코드 — 새 코드가 겹치지 않게 */
  existingCodes: string[];
  /** 이 날짜 이후만 들여온다 (시트 동결 시점). 없으면 전부 */
  from?: string | null;
  fallbackYear?: number;
  actor: string;
}

/** 탭 또는 쉼표로 구분된 표를 행 배열로 — 구글 시트에서 복사하면 탭 구분이다 */
export function splitTable(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter(line => line.trim() !== "")
    .map(line =>
      (line.includes("\t") ? line.split("\t") : line.split(",")).map(cell =>
        cell.trim()
      )
    );
}

/** 첫 줄을 헤더로 보고 §5.2 컬럼에 맞춘다. 못 찾은 컬럼은 순서대로 배정한다. */
export function detectColumns(
  header: string[]
): Partial<Record<keyof SheetRow, number>> {
  const map: Partial<Record<keyof SheetRow, number>> = {};
  const norm = header.map(h => h.replace(/\s/g, ""));
  const find = (...names: string[]) =>
    norm.findIndex(h => names.some(name => h.includes(name)));

  const date = find("일자", "날짜");
  const title = find("항목", "내용");
  const note = find("적요", "비고", "메모");
  const out = find("지출", "출금");
  const income = find("수입", "입금");
  const open = find("시작", "기초", "이월");
  // "시작잔액"에도 「잔액」이 들어 있으므로 종료/기말을 먼저 찾고, 없을 때만 시작 열이 아닌 「잔액」을 쓴다
  let close = find("종료", "기말");
  if (close < 0)
    close = norm.findIndex((h, i) => i !== open && h.includes("잔액"));

  if (date >= 0) map.date = date;
  if (title >= 0) map.title = title;
  if (note >= 0) map.note = note;
  if (out >= 0) map.outAmount = out;
  if (income >= 0) map.inAmount = income;
  if (open >= 0) map.dayOpen = open;
  if (close >= 0 && close !== open) map.dayClose = close;
  return map;
}

export function importSheet(
  text: string,
  options: SheetImportOptions
): SheetImportResult {
  const rows = splitTable(text);
  const rejected: SheetImportResult["rejected"] = [];
  if (rows.length === 0) {
    return {
      entries: [],
      snapshots: [],
      rejected,
      summary: { total: 0, ready: 0, undecided: 0, outSum: 0, inSum: 0 },
    };
  }

  const columns = detectColumns(rows[0]);
  const hasHeader = Object.keys(columns).length >= 2;
  const body = hasHeader ? rows.slice(1) : rows;
  const index = hasHeader
    ? columns
    : ({
        date: 0,
        title: 1,
        note: 2,
        outAmount: 3,
        inAmount: 4,
        dayOpen: 5,
        dayClose: 6,
      } as const);
  const fallbackYear = options.fallbackYear ?? new Date().getFullYear();

  const codes = [...options.existingCodes];
  const entries: ImportedEntry[] = [];
  const snapshotByDate = new Map<string, DaySnapshot>();

  body.forEach((cells, i) => {
    const line = i + (hasHeader ? 2 : 1);
    const raw = cells.join(" | ");
    const cell = (key: keyof SheetRow) => {
      const at = (index as Partial<Record<keyof SheetRow, number>>)[key];
      return at == null ? "" : (cells[at] ?? "");
    };

    const date = parseDate(cell("date"), fallbackYear);
    if (!date) {
      // 행을 버리지 않는다 — 왜 못 넣었는지를 남긴다 (§5.2)
      rejected.push({ line, raw, reason: "일자를 읽을 수 없습니다" });
      return;
    }
    if (options.from && date < options.from) return;

    const title = cell("title");
    const note = cell("note");
    const outAmount = parseAmount(cell("outAmount"));
    const inAmount = parseAmount(cell("inAmount"));

    // 일자만 있고 금액이 양쪽 다 없으면 잔액 행으로 본다
    const open = parseAmount(cell("dayOpen"));
    const close = parseAmount(cell("dayClose"));
    if (open != null || close != null) {
      const existing = snapshotByDate.get(date);
      snapshotByDate.set(date, {
        date,
        open: existing?.open ?? open,
        inSum: (existing?.inSum ?? 0) + (inAmount ?? 0),
        outSum: (existing?.outSum ?? 0) + (outAmount ?? 0),
        close: close ?? existing?.close ?? null,
        note: null,
        isMigrated: true,
      });
    }

    if (outAmount == null && inAmount == null && !title.trim() && !note.trim())
      return;

    const direction: Direction =
      inAmount != null && outAmount == null ? "in" : "out";
    const amount = direction === "in" ? inAmount : outAmount;
    const candidate = amount == null ? candidateFromNote(note) : null;

    const flags: string[] = [];
    let undecidedReason: string | null = null;
    if (!title.trim()) {
      undecidedReason = "항목명 없음";
      flags.push("항목명 없음");
    } else if (amount == null) {
      undecidedReason = candidate != null ? "적요칸 금액" : "단위 불명";
      flags.push(
        candidate != null
          ? "적요칸 금액 — 승격하지 않음"
          : "금액 없음 · 단위 불명"
      );
    }
    if (amount == null && candidate == null && /\d/.test(note)) {
      flags.push("적요에 숫자가 있으나 단위 판정 불가");
    }

    const code = nextCode(direction === "in" ? "IN" : "EX", date, codes);
    codes.push(code);

    entries.push({
      sourceLine: line,
      flags,
      entry: {
        id: code,
        code,
        parentCode: null,
        direction,
        status: undecidedReason ? "undecided" : "pending",
        title,
        noteRaw: note || null,
        note: null,
        amount,
        amountCandidate: candidate,
        amountSupply: null,
        amountVat: null,
        currency: "KRW",
        cashDate: date,
        accrualDate: date,
        startDate: null,
        deliverDate: null,
        requestDate: null,
        dueDate: date,
        paidAt: null,
        // 시트에는 계정·귀속이 없다. 비워 두고 사람이 태깅한다 (§5.2)
        accountCode: null,
        nature: "미지정",
        buCode: null,
        projectId: null,
        partyId: null,
        contractId: null,
        priority: direction === "in" ? null : defaultPriorityOf(null),
        priorityOverride: null,
        priorityReason: null,
        payMethod: null,
        bankAccount: null,
        invoiceIssued: null,
        invoiceNo: null,
        invoiceDate: null,
        source: "migration",
        sourceRef: `sheet:${date}:${line}`,
        undecidedReason,
        hasEvidence: false,
        isPersonal: false,
        version: 1,
        createdAt: new Date().toISOString(),
        createdBy: options.actor,
      },
    });
  });

  const ready = entries.filter(e => e.entry.status === "pending").length;
  return {
    entries,
    snapshots: Array.from(snapshotByDate.values()).sort((a, b) =>
      a.date < b.date ? -1 : 1
    ),
    rejected,
    summary: {
      total: entries.length,
      ready,
      undecided: entries.length - ready,
      outSum: entries
        .filter(e => e.entry.direction === "out")
        .reduce((acc, e) => acc + (e.entry.amount ?? 0), 0),
      inSum: entries
        .filter(e => e.entry.direction === "in")
        .reduce((acc, e) => acc + (e.entry.amount ?? 0), 0),
    },
  };
}
