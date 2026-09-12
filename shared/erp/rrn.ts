/**
 * 주민등록번호 — 보관하되, 화면에는 가린다.
 *
 * 실비 정산 요청에는 주민등록번호가 평문으로 들어온다. **지우지 않는다** —
 * 원천징수 지급명세서(사업소득 3.3% · 기타소득 8.8%)에 실제로 들어가는 값이고,
 * 소득세법이 요구하는 항목이다. 없애면 신고를 못 한다.
 *
 * 대신 세 가지를 지킨다.
 *   ① 화면에는 `******-*******` 로만 나간다. **마스킹은 API 응답 단계**에서
 *      한다 — 프론트에서만 가리면 네트워크 탭에 그대로 보인다
 *   ② 원본은 비밀번호를 다시 받은 뒤에만(D7 재인증) 열린다
 *   ③ 누가 언제 누구 것을 열었는지 감사로그에 남는다
 *
 * 계좌번호는 건드리지 않는다 — 그 돈을 실제로 보내야 하는 값이다. 그래서 이
 * 모듈의 어려운 쪽은 「주민번호를 찾는 것」이 아니라 **「계좌번호를 주민번호로
 * 오인하지 않는 것」**이다. 지워진 계좌로는 송금할 수 없다.
 */

export const RRN_MASK = "******-*******";

/**
 * ① 구분자가 있는 형태 — 어디에 있든 주민번호로 본다.
 *
 * `930807-2071310`. 하이픈을 요구하는 것이 핵심이다. 카카오뱅크 계좌
 * (`3333059947514`) 는 13자리가 붙어 있어 여기에 걸리지 않는다.
 */
const WITH_SEPARATOR = /(?<!\d)(\d{6})-([1-8]\d{6})(?!\d)/g;

/**
 * ② 「주민」이라고 적힌 줄 — 그 줄의 13자리 숫자는 구분자가 없어도 주민번호다.
 *
 * `주민번호:950706 2185314` 처럼 띄어쓰기로 적거나, 슬랙이 전화번호로 오인해
 * `<tel:9308072071310|930807-2071310>` 로 감싸 놓는 경우가 있다. 줄에 「주민」이
 * 있으면 그 줄에 계좌번호가 함께 있을 일은 없으므로 넓게 잡아도 안전하다.
 */
const RRN_LINE = /주민/;
const LOOSE = /(?<!\d)\d{6}[-\s]?\d{7}(?!\d)/g;
const SLACK_TEL = /<tel:\d+\|([^>]*)>/g;

function maskLine(line: string): { line: string; found: number } {
  let found = 0;
  const hit = () => {
    found += 1;
    return RRN_MASK;
  };

  if (RRN_LINE.test(line)) {
    // 슬랙이 감싼 <tel:...> 안에는 구분자 없는 13자리가 들어 있다
    return { line: line.replace(SLACK_TEL, hit).replace(LOOSE, hit), found };
  }
  return { line: line.replace(WITH_SEPARATOR, hit), found };
}

/** 주민번호를 `******-*******` 로 바꾼 본문. 그 밖의 글자는 한 자도 안 바꾼다 */
export function maskRrn(text: string): { text: string; found: number } {
  let found = 0;
  const lines = text.split("\n").map(line => {
    const masked = maskLine(line);
    found += masked.found;
    return masked.line;
  });
  return { text: lines.join("\n"), found };
}

/** 이 본문에 가려야 할 것이 있는가 — 화면의 「원본 보기」 버튼을 띄울지 정한다 */
export function hasRrn(text: string | null | undefined): boolean {
  return text ? maskRrn(text).found > 0 : false;
}
