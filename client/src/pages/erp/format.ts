/**
 * 표시 규약 — null과 0은 화면에서 다르게 보여야 한다 (§10.2).
 * null은 숫자가 아니라 「계산 불가 + 무엇이 필요한지」로 렌더링한다.
 */
export const NUMBER_FORMAT = new Intl.NumberFormat("ko-KR");

export function won(value: number | null | undefined): string | null {
  if (value == null) return null;
  return NUMBER_FORMAT.format(value);
}

export function signedWon(value: number | null | undefined): string | null {
  if (value == null) return null;
  const text = NUMBER_FORMAT.format(Math.abs(value));
  if (value === 0) return "0";
  return value < 0 ? `−${text}` : `+${text}`;
}

/** 2026-08-26 → 08/26 */
export function shortDate(date: string | null | undefined): string {
  if (!date) return "—";
  return date.length >= 10 ? `${date.slice(5, 7)}/${date.slice(8, 10)}` : date;
}

/** 블록 키 라벨 — 일 · 월 · 연 */
export function blockLabel(key: string): string {
  if (key.length === 4) return `${key}년`;
  if (key.length === 7)
    return `${key.slice(0, 4)}년 ${Number(key.slice(5, 7))}월`;
  return `${key.slice(5, 7)}/${key.slice(8, 10)}`;
}

export const NULL_REASON_TEXT: Record<string, string> = {
  undecided_carryover: "판정 대기 승계 — 종료 잔액 확정 불가",
  burn_rate_unavailable:
    "월 번레이트를 확정할 수 없습니다 — 급여 실액과 구독 원장이 필요합니다",
};

export function nullReasonText(reason: string | null | undefined): string {
  if (!reason) return "계산 불가";
  return NULL_REASON_TEXT[reason] ?? reason;
}

export type Tone = "ok" | "warn" | "alert" | "info" | "null" | undefined;

/** 부족액 색 — 음수는 경고, 양수는 여유 */
export function shortfallTone(value: number | null): Tone {
  if (value == null) return "null";
  return value < 0 ? "alert" : "ok";
}
