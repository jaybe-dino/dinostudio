/**
 * §13.2 · §10.3 duplicate_suspected — 같은 거래처 · 같은 금액 · 7일 이내
 *
 * 경고 후 강행은 가능하되 강행 사유가 감사로그에 남는다.
 */
import type { Entry } from "./types";

export const DUPLICATE_WINDOW_DAYS = 7;

function dayDiff(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.abs(ms) / 86_400_000;
}

/** 거래처가 아직 마스터에 없으면 항목명으로 대조한다 (이관 데이터는 party_id가 비어 있다). */
export function counterpartyKey(
  entry: Pick<Entry, "partyId" | "title">
): string {
  if (entry.partyId) return `party:${entry.partyId}`;
  const normalized = entry.title.replace(/\s+/g, "").toLowerCase();
  return `title:${normalized}`;
}

export interface DuplicateCandidate {
  code: string;
  date: string | null;
  amount: number | null;
  daysApart: number;
}

/** 후보 건과 같은 거래처·금액이 7일 이내에 이미 있는가 */
export function findDuplicateCandidates(
  candidate: Pick<Entry, "code" | "partyId" | "title" | "amount" | "cashDate">,
  entries: Entry[],
  windowDays = DUPLICATE_WINDOW_DAYS
): DuplicateCandidate[] {
  if (candidate.amount == null || !candidate.cashDate) return [];
  const key = counterpartyKey(candidate);
  const out: DuplicateCandidate[] = [];
  for (const other of entries) {
    if (other.code === candidate.code) continue;
    if (other.amount !== candidate.amount) continue;
    if (!other.cashDate) continue;
    if (counterpartyKey(other) !== key) continue;
    const daysApart = dayDiff(candidate.cashDate, other.cashDate);
    if (daysApart <= windowDays) {
      out.push({
        code: other.code,
        date: other.cashDate,
        amount: other.amount,
        daysApart,
      });
    }
  }
  return out;
}
