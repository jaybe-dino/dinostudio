/**
 * 대조 — 「이 글이 원장의 어느 건인가」.
 *
 * 지출결의서와 계약서 서명요청은 **금액이 없거나 양식이 없다.** 그래서 원장
 * 건으로 만들 수가 없다. 대신 이미 원장에 있는 건과 짝을 지어 「반영됐다 /
 * 아직 안 들어왔다」를 말해 주는 것이 쓸모다.
 *
 * **자동으로 잇지 않는다.** 잘못 이으면 같은 지출이 두 번 잡히거나(이중계상),
 * 결재가 끝난 것처럼 보이는데 실제로는 다른 건이 결재된 상태가 된다. 점수를
 * 매겨 후보를 나란히 보여 주고, 잇는 것은 사람이 한다 (원칙 7).
 */
import type { Entry } from "./types.js";

/** 붙여 쓰기·법인격·따옴표를 걷어낸 비교용 이름 */
export function normalizeName(raw: string): string {
  return raw
    .replace(/\(?주\)?식?회?사?\)?/g, "")
    .replace(/[(){}[\]<>"'`|/\\,.·・~\-_]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** 2글자 조각으로 자른다 — 한국어는 어절이 붙어 있어 조각 비교가 낫다 */
function bigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 1 < text.length; i += 1) out.add(text.slice(i, i + 2));
  if (text.length === 1) out.add(text);
  return out;
}

/**
 * 이름이 얼마나 닮았는가 (0~1).
 *
 * 한쪽이 다른 쪽에 통째로 들어 있으면(「액티브스」 ⊂ 「주식회사 액티브스」)
 * 1 로 본다. 그 밖에는 2글자 조각이 겹치는 비율을 쓴다.
 */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 1;

  const gx = bigrams(x);
  const gy = bigrams(y);
  let shared = 0;
  gx.forEach(g => {
    if (gy.has(g)) shared += 1;
  });
  return (2 * shared) / (gx.size + gy.size);
}

function daysApart(a: string, b: string): number {
  const x = Date.parse(`${a}T00:00:00Z`);
  const y = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(x) || !Number.isFinite(y))
    return Number.POSITIVE_INFINITY;
  return Math.abs(x - y) / 86_400_000;
}

export type MatchVerdict = "확실" | "유사" | "없음";

export interface MatchCandidate {
  code: string;
  title: string;
  amount: number | null;
  cashDate: string | null;
  /** 0~1 */
  score: number;
  /** 왜 이 점수인지 — 사람이 판단할 근거다 */
  reasons: string[];
}

export interface MatchQuery {
  /** 글에서 읽은 이름 (거래처 또는 항목) */
  name: string;
  /** 글에서 읽은 금액. 없으면 이름·날짜로만 본다 */
  amount?: number | null;
  /** 글의 날짜 */
  date?: string | null;
}

/** 금액이 정확히 같으면 이것만으로도 거의 확정이다 */
const AMOUNT_EXACT = 0.45;
/** 날짜가 가까우면 가산. 14일을 넘으면 0 */
const DATE_WINDOW = 14;

export function scoreEntry(query: MatchQuery, entry: Entry): MatchCandidate {
  const reasons: string[] = [];
  let score = 0;

  // 이름 — 항목명과 거래처명 중 더 닮은 쪽을 쓴다
  const name = Math.max(
    nameSimilarity(query.name, entry.title),
    entry.partyId ? nameSimilarity(query.name, entry.partyId) : 0
  );
  score += name * 0.5;
  if (name >= 0.9) reasons.push("이름이 같습니다");
  else if (name >= 0.5) reasons.push("이름이 비슷합니다");

  // 금액 — 정확히 같을 때만 준다. 「비슷한 금액」은 근거가 되지 않는다
  if (query.amount != null && entry.amount != null) {
    if (query.amount === entry.amount) {
      score += AMOUNT_EXACT;
      reasons.push("금액이 같습니다");
    } else {
      reasons.push(
        `금액이 다릅니다 (글 ${query.amount.toLocaleString("ko-KR")} · 원장 ${entry.amount.toLocaleString("ko-KR")})`
      );
    }
  }

  // 날짜 — 가까울수록 가산
  const entryDate = entry.cashDate ?? entry.accrualDate;
  if (query.date && entryDate) {
    const gap = daysApart(query.date, entryDate);
    if (gap <= DATE_WINDOW) {
      score += 0.05 * (1 - gap / DATE_WINDOW);
      if (gap === 0) reasons.push("같은 날입니다");
      else reasons.push(`${Math.round(gap)}일 차이입니다`);
    } else {
      reasons.push("날짜가 멉니다");
    }
  }

  return {
    code: entry.code,
    title: entry.title,
    amount: entry.amount,
    cashDate: entry.cashDate,
    score: Math.min(1, score),
    reasons,
  };
}

export interface MatchResult {
  verdict: MatchVerdict;
  candidates: MatchCandidate[];
  note: string;
}

/**
 * 후보를 점수순으로 돌려준다.
 *
 * 「확실」은 **이름이 같고 금액도 같을 때만** 준다. 이름만 같은 것은 회차가
 * 다른 같은 거래처일 수 있어서(「액티브스 1차」 · 「액티브스 2차」) 확실이라고
 * 하면 안 된다.
 */
export function matchEntries(
  query: MatchQuery,
  entries: Entry[],
  limit = 3
): MatchResult {
  const scored = entries
    .map(entry => scoreEntry(query, entry))
    .filter(c => c.score >= 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (scored.length === 0)
    return {
      verdict: "없음",
      candidates: [],
      note: "원장에서 짝을 찾지 못했습니다 — 아직 안 들어온 건일 수 있습니다",
    };

  const best = scored[0];
  const sure =
    best.reasons.includes("이름이 같습니다") &&
    best.reasons.includes("금액이 같습니다");

  return {
    verdict: sure ? "확실" : "유사",
    candidates: scored,
    note: sure
      ? "원장에 같은 건이 있습니다"
      : "닮은 건이 있습니다 — 같은 건인지 사람이 확인해야 합니다",
  };
}
