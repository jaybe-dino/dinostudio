/**
 * §8 계정과목 · 자동 판정
 *
 * 일반기업회계기준(K-GAAP). 계정과목 하나를 정하면 나머지 세 가지가 자동으로 정해진다 —
 * 지급 우선순위(§8.2) · 현금흐름 3구간(§8.3) · 운영비 포함 여부(§8.4). 사람은 계정만 고른다.
 */
import type { Account, CashflowSection, Entry, Priority } from "./types.js";

/** §8.1 계정과목 마스터 (초기 적재) */
export const ACCOUNTS: Account[] = [
  // 4000 매출
  a("4100", "용역매출", "매출", "영업", false, null),
  a("4200", "상품매출", "매출", "영업", false, null),
  a("4300", "구독매출", "매출", "영업", false, null),
  // 5000 매출원가
  a("5140", "플랫폼·운영 수수료", "매출원가", "영업", false, "P2"),
  a("5210", "외주용역비", "매출원가", "영업", true, "P2"),
  a("5220", "크리에이터·실비 정산", "매출원가", "영업", false, "P2"),
  a("5310", "상품매입", "매출원가", "투자", false, "P2"),
  // 6000 판매비와관리비
  a("6110", "급여", "판관비", "영업", true, "P0"),
  a("6120", "상여금", "판관비", "영업", true, "P0"),
  a("6130", "4대보험 사용자분", "판관비", "영업", true, "P0"),
  a("6140", "퇴직급여", "판관비", "영업", true, "P0"),
  a("6210", "광고선전비", "판관비", "영업", true, "P3"),
  a("6310", "지급수수료", "판관비", "영업", true, "P2"),
  a("6320", "구독·클라우드", "판관비", "영업", true, "P3"),
  a("6410", "지급임차료", "판관비", "영업", true, "P1"),
  a("6420", "수도광열·관리비", "판관비", "영업", true, "P1"),
  a("6510", "여비교통비", "판관비", "영업", true, "P3"),
  a("6520", "세금과공과", "판관비", "영업", true, "P1"),
  a("6530", "감가상각비", "판관비", "현금유출없음", false, null),
  // 7000 · 8000 영업외
  a("7110", "이자수익", "영업외수익", "영업", false, null),
  a("8110", "이자비용", "영업외비용", "영업", true, "P0"),
  a("8120", "기타영업외비용", "영업외비용", "영업", true, "P1"),
  // 1000 자산 · 2000 부채 · 3000 자본 — 손익 아님
  //
  // 1110 · 2120은 §8.1 마스터에 없다. 전표 자동 생성(T1 ⑤)에는 상대계정이 반드시 필요하므로
  // 결제수단에 대응하는 두 계정을 추가했다. docs/erp-spec-gaps.md 참조.
  a("1110", "보통예금", "자산", "영업", false, null),
  a("2120", "미지급금 (법인카드)", "부채", "영업", false, null),
  a("1210", "비품·장비", "유형자산", "투자", false, "P3"),
  a("1310", "보증금", "기타자산", "투자", false, "P3"),
  a("1450", "부가세대급금 (매입세액)", "자산", "영업", false, "P1"),
  a("2130", "예수부가세", "부채", "영업", false, "P1"),
  // 원천징수 예수금 — 다음 달 10일에 납부한다 (docs/erp-qa.md A2)
  a("2131", "예수금 (원천세)", "부채", "영업", false, "P1"),
  a("2132", "예수금 (4대보험)", "부채", "영업", false, "P1"),
  a("2140", "선수금", "부채", "영업", false, null),
  a("2210", "단기차입금", "부채", "재무", false, "P1"),
  a("2310", "장기차입금", "부채", "재무", false, "P1"),
  a("3100", "자본금", "자본", "재무", false, null),
  a("9900", "미분류", "미분류", "판정불가", false, null),
];

function a(
  code: string,
  name: string,
  type: string,
  cfSection: CashflowSection,
  isOpex: boolean,
  defaultPriority: Priority | null
): Account {
  return {
    code,
    name,
    type,
    parentCode: null,
    cfSection,
    isOpex,
    defaultPriority,
    active: true,
  };
}

const BY_CODE = new Map(ACCOUNTS.map(acc => [acc.code, acc]));

export function findAccount(
  code: string | null | undefined
): Account | undefined {
  return code ? BY_CODE.get(code) : undefined;
}

export function accountLabel(code: string | null | undefined): string {
  const acc = findAccount(code);
  return acc ? `${acc.code} ${acc.name}` : "미지정";
}

/**
 * §8.2 판정 1 · 계정 → 지급 우선순위 (사양서 본문의 autoPriority 그대로)
 *
 * 주의 — 이 함수와 §8.1 마스터의 `기본 우선순위` 컬럼이 6310 지급수수료에서 갈린다
 * (마스터 P2 / 함수 P3). §6.3이 "자동 판정 3종은 전부 account 테이블 컬럼에서 나온다"고
 * 규정하므로 실사용 값은 마스터 컬럼(defaultPriority)을 우선하고, 이 함수는 마스터가
 * 비어 있는 계정의 폴백으로만 쓴다. resolvePriority() 참조.
 */
export function autoPriority(code: string): Priority {
  // P0 — 기업 신용과 직결된 절대적인 것
  if (/^(6110|6120|6130|6140|8110)$/.test(code)) return "P0";
  // P1 — 법적인 것 (세금 · 임차 · 부가세 · 차입 원금)
  if (/^(6520|6410|6420|2130|1450|2210|2310|8120)$/.test(code)) return "P1";
  // P2 — 매출원가성 실비
  if (/^5\d{3}$/.test(code)) return "P2";
  return "P3";
}

/** 계정만으로 정해지는 기본 우선순위 — 마스터 컬럼 우선, 없으면 §8.2 함수 */
export function defaultPriorityOf(
  code: string | null | undefined
): Priority | null {
  if (!code) return null;
  const acc = findAccount(code);
  if (acc) return acc.defaultPriority ?? autoPriority(code);
  return autoPriority(code);
}

/**
 * 실제 사용값 = priority_override ?? priority (§8.2)
 * priority가 비어 있으면 계정 기본값으로 되돌아간다 — 계정 기본값은 지우지 않고
 * override만 덮어쓰기 때문에 언제든 되돌릴 수 있다.
 */
export function resolvePriority(
  entry: Pick<Entry, "priority" | "priorityOverride" | "accountCode">
): Priority | null {
  return (
    entry.priorityOverride ??
    entry.priority ??
    defaultPriorityOf(entry.accountCode)
  );
}

/** P0 → 0 … P3 → 3. 부족액 단계 비교용 */
export function priorityRank(p: Priority | null): number {
  return p ? Number(p.slice(1)) : Number.POSITIVE_INFINITY;
}

/** §8.3 판정 2 · 계정 → 현금흐름 3구간 */
export function cashflowSection(
  code: string | null | undefined
): CashflowSection {
  const acc = findAccount(code);
  return acc ? acc.cfSection : "판정불가";
}

/**
 * §8.4 판정 3 · 계정 → 운영비 포함 여부
 * 월 운영비(= 월 번레이트) = 총지출 − (통과원가 + 차입 원금 + 부가세 + 자산 취득)
 */
export function isOpex(
  entry: Pick<Entry, "status" | "amount" | "nature" | "accountCode">
): boolean {
  if (entry.status !== "confirmed") return false; // 원칙 7 — 승인 없이는 지표가 아니다
  if (entry.amount == null) return false; // 원칙 8 — 모르면 계산불가
  if (entry.nature === "통과원가") return false; // 받아야 나감
  const acc = findAccount(entry.accountCode);
  return acc ? acc.isOpex : false; // §8.1 마스터 컬럼
}

/** 전표 상대계정 — 결제수단에 대응한다 (§6.3 journal_line) */
export const CASH_ACCOUNT = "1110";
export const CARD_PAYABLE_ACCOUNT = "2120";

export function counterAccountFor(
  payMethod: string | null | undefined
): string {
  return payMethod === "법인카드" || payMethod === "개인카드선결제"
    ? CARD_PAYABLE_ACCOUNT
    : CASH_ACCOUNT;
}
