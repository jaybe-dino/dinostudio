/**
 * 파일 이름도 자료다.
 *
 * 슬랙에 붙는 파일 이름이 이미 많은 것을 말해 준다 —
 * `틱톡샵_온보딩운영_통합계약서_닥터브라이언_0825.pdf` 안에는 사업·계약 종류·
 * 상대·날짜가 다 들어 있다. 본문을 해독하기 전에, **이름만으로도** 원장 대조에
 * 쓸 수 있는 만큼은 먼저 뽑는다.
 *
 * 본문 해독은 돈과 시간이 든다(모델 호출). 이름 파싱은 공짜다. 그래서 먼저
 * 한다 — 그리고 해독에 실패해도 이만큼은 남는다.
 */

export interface FileNameHints {
  /** 확장자를 뗀 이름 */
  base: string;
  /** `_` · `-` · 공백으로 끊은 토막 */
  tokens: string[];
  /** 문서 종류 — 계약서 · 견적서 · 세금계산서 … */
  docType: string | null;
  /** 이름에 적힌 날짜 (YYYY-MM-DD). 두 자리(0825)는 연도를 붙여 준다 */
  date: string | null;
  /** 거래처·상대로 볼 만한 토막 */
  partyCandidates: string[];
}

const DOC_TYPES = [
  "통합계약서",
  "계약서",
  "견적서",
  "세금계산서",
  "계산서",
  "거래명세서",
  "영수증",
  "지출결의서",
  "품의서",
  "정산서",
  "청구서",
  "발주서",
  "합의서",
  "각서",
  "확인서",
  "명세서",
];

/** 문서 종류·사업 이름처럼 거래처가 아닌 것이 분명한 토막 */
const NOT_A_PARTY = new Set([
  ...DOC_TYPES,
  "틱톡샵",
  "온보딩운영",
  "온보딩",
  "운영",
  "최종",
  "수정본",
  "사본",
  "원본",
  "서명",
  "날인",
  "final",
  "draft",
  "copy",
]);

function splitTokens(base: string): string[] {
  return base
    .split(/[_\-\s.]+/)
    .map(t => t.trim())
    .filter(Boolean);
}

/**
 * 이름 안의 날짜.
 *
 * `20260825` · `2026-08-25` · `260825` · `0825` 네 가지를 본다. 마지막 두 자리
 * 형태는 연도가 없으므로 **넘겨받은 연도**를 쓴다 — 추측하지 않는다.
 */
export function dateFromName(base: string, year: number): string | null {
  const full = /(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/.exec(base);
  if (full) return `${full[1]}-${full[2]}-${full[3]}`;

  const short = /(?<!\d)(\d{2})(\d{2})(\d{2})(?!\d)/.exec(base);
  if (short) return `20${short[1]}-${short[2]}-${short[3]}`;

  const md = /(?<!\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/.exec(base);
  if (md) return `${year}-${md[1]}-${md[2]}`;

  return null;
}

export function readFileName(name: string, year: number): FileNameHints {
  const base = name.replace(/\.[A-Za-z0-9]{1,6}$/, "");
  const tokens = splitTokens(base);
  const flat = base.replace(/\s/g, "");

  // 긴 이름부터 본다 — 「통합계약서」가 「계약서」보다 먼저 걸려야 한다
  const docType =
    DOC_TYPES.find(type => flat.includes(type.replace(/\s/g, ""))) ?? null;

  const partyCandidates = tokens.filter(
    token =>
      token.length >= 2 &&
      !/^\d+$/.test(token) &&
      !NOT_A_PARTY.has(token) &&
      !DOC_TYPES.some(type => token.includes(type))
  );

  return {
    base,
    tokens,
    docType,
    date: dateFromName(base, year),
    partyCandidates,
  };
}
