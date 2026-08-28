/**
 * §7.1 코드 체계
 *
 *   EX-260827-03
 *   │      │       └ 그 날의 순번 (01부터 · 결번 허용)
 *   │      └ 발생일 YYMMDD
 *   └ 접두어  EX 지출 · IN 수입 · DB 부채이동 · CT 계약
 *
 * 코드는 불변이다. 금액이 바뀌어도 코드는 남고 -R1이 새로 생기며,
 * 취소는 -C가 반대 부호로 상계한다. 취소된 번호는 재사용하지 않고 결번으로 남긴다.
 */
import type { Direction } from "./types";

export type CodePrefix = "EX" | "IN" | "DB" | "CT";

export const CODE_RE = /^(EX|IN|DB|CT)-(\d{6})-(\d{2})(?:-(R\d+|C))?$/;

export interface ParsedCode {
  prefix: CodePrefix;
  yymmdd: string;
  seq: number;
  /** null = 원본 · "R1" = 1차 수정본 · "C" = 취소 */
  suffix: string | null;
  /** 수정본·취소본이면 원본 코드 */
  baseCode: string;
}

export function parseCode(code: string): ParsedCode | null {
  const m = CODE_RE.exec(code);
  if (!m) return null;
  const [, prefix, yymmdd, seq, suffix] = m;
  return {
    prefix: prefix as CodePrefix,
    yymmdd,
    seq: Number(seq),
    suffix: suffix ?? null,
    baseCode: `${prefix}-${yymmdd}-${seq}`,
  };
}

export function prefixFor(direction: Direction): CodePrefix {
  return direction === "in" ? "IN" : "EX";
}

/** YYYY-MM-DD → YYMMDD */
export function yymmdd(date: string): string {
  return date.slice(2).replace(/-/g, "");
}

/**
 * 발생일 기준 · 같은 날 순번으로 새 코드를 부여한다.
 * 결번은 허용하고 재사용은 금지하므로, 그 날 쓰인 최대 순번 + 1을 준다.
 */
export function nextCode(
  prefix: CodePrefix,
  date: string,
  existing: Iterable<string>
): string {
  const day = yymmdd(date);
  let max = 0;
  for (const code of Array.from(existing)) {
    const parsed = parseCode(code);
    if (!parsed) continue;
    if (parsed.prefix !== prefix || parsed.yymmdd !== day) continue;
    if (parsed.seq > max) max = parsed.seq;
  }
  return `${prefix}-${day}-${String(max + 1).padStart(2, "0")}`;
}

/** 다음 수정본 코드 — EX-260827-03 → EX-260827-03-R1 → -R2 */
export function nextRevisionCode(
  code: string,
  existing: Iterable<string>
): string {
  const base = parseCode(code)?.baseCode ?? code;
  let max = 0;
  for (const other of Array.from(existing)) {
    const parsed = parseCode(other);
    if (!parsed || parsed.baseCode !== base) continue;
    const rev = parsed.suffix?.startsWith("R")
      ? Number(parsed.suffix.slice(1))
      : 0;
    if (rev > max) max = rev;
  }
  return `${base}-R${max + 1}`;
}

/** 취소 코드 — EX-260827-03 → EX-260827-03-C */
export function cancelCode(code: string): string {
  const base = parseCode(code)?.baseCode ?? code;
  return `${base}-C`;
}
