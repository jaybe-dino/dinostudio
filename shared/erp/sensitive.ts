/**
 * 민감정보 — 보관하되 가린다.
 *
 * 집행·정산 요청 메시지에는 **주민등록번호와 계좌번호**가 평문으로 들어온다.
 * 둘 다 **지우지 않는다.** 주민번호는 원천징수 지급명세서(사업소득 3.3% ·
 * 기타소득 8.8%)에, 계좌번호는 실제 송금에 쓰는 값이다. 없애면 일이 안 된다.
 *
 * 대신 세 가지를 지킨다.
 *   ① 화면에는 가려서 나간다. **마스킹은 API 응답 단계**에서 한다 —
 *      프론트에서만 가리면 네트워크 탭에 그대로 보인다
 *   ② 원본은 비밀번호를 다시 받은 뒤에만(D7 재인증) 열린다
 *   ③ 누가 언제 어느 건을 열었는지 감사로그에 남는다
 *
 * **찾는 방법은 라벨을 따라간다.** 계좌번호는 은행마다 자릿수와 구분자가 전부
 * 달라서(`1002-251-156248` · `3333059947514` · `063-095494-01-014` ·
 * `302-0356-7784-11` · `110-256-31-3127` …) 모양으로는 구분이 안 된다.
 * 다행히 사람은 항상 「계좌」나 은행 이름을 붙여서 적는다. 그 줄의 숫자만
 * 가리면 금액·날짜·사업자번호를 잘못 건드리지 않는다.
 */

export const RRN_MASK = "******-*******";
export const ACCOUNT_MASK = "****-****-****";

/** 주민번호가 적힌 줄 */
const RRN_LINE = /주민/;

/** 계좌번호가 적힌 줄 — 라벨이거나 은행 이름이 있다 */
const ACCOUNT_LINE =
  /계좌|예금주|입금\s*은행|은행명|농협|기업은행|국민은행|신한|우리은행|하나은행|카카오\s*뱅크|케이뱅크|토스뱅크|새마을|우체국|수협|신협|산업은행|씨티|SC제일|부산은행|대구은행|광주은행|전북은행|경남은행|제주은행/;

/**
 * ① 구분자가 있는 주민번호 — 어디에 있든 가린다.
 *
 * `930807-2071310`. 하이픈을 요구하는 것이 핵심이다. 카카오뱅크 계좌
 * (`3333059947514`) 는 13자리가 붙어 있어 여기에 걸리지 않는다.
 */
const RRN_WITH_SEPARATOR = /(?<!\d)\d{6}-[1-8]\d{6}(?!\d)/g;

/**
 * ② 「주민」이 적힌 줄이면 구분자가 없어도 주민번호다.
 *
 * `주민번호:950706 2185314` 처럼 띄어 쓰거나, 슬랙이 전화번호로 오인해
 * `<tel:9308072071310|930807-2071310>` 로 감싸 놓는 경우가 있다.
 */
const RRN_LOOSE = /(?<!\d)\d{6}[-\s]?\d{7}(?!\d)/g;
const SLACK_TEL = /<tel:[^|>]*\|?([^>]*)>/g;

/**
 * ③ 계좌번호 — 숫자와 구분자(`-` · 공백)로 이어진 덩어리 중 **숫자가 8자리
 * 이상**인 것. 쉼표는 일부러 뺐다. 금액은 `1,500,000` 처럼 쉼표를 쓰므로
 * 쉼표를 허용하지 않으면 금액과 섞이지 않는다.
 */
const ACCOUNT_NUMBER = /\d[\d\s-]*\d/g;
const MIN_ACCOUNT_DIGITS = 8;

export type SensitiveKind = "주민번호" | "계좌번호";

function maskLine(line: string): { line: string; found: SensitiveKind[] } {
  const found: SensitiveKind[] = [];

  if (RRN_LINE.test(line)) {
    // 슬랙이 감싼 <tel:...> 안에는 구분자 없는 13자리가 들어 있다
    const out = line
      .replace(SLACK_TEL, () => {
        found.push("주민번호");
        return RRN_MASK;
      })
      .replace(RRN_LOOSE, () => {
        found.push("주민번호");
        return RRN_MASK;
      });
    return { line: out, found };
  }

  let out = line.replace(RRN_WITH_SEPARATOR, () => {
    found.push("주민번호");
    return RRN_MASK;
  });

  if (ACCOUNT_LINE.test(out)) {
    out = out.replace(ACCOUNT_NUMBER, match => {
      const digits = match.replace(/\D/g, "");
      if (digits.length < MIN_ACCOUNT_DIGITS) return match;
      found.push("계좌번호");
      return ACCOUNT_MASK;
    });
  }

  return { line: out, found };
}

/** 민감정보를 가린 본문. 그 밖의 글자는 한 자도 바꾸지 않는다 */
export function maskSensitive(text: string): {
  text: string;
  found: number;
  kinds: SensitiveKind[];
} {
  const kinds: SensitiveKind[] = [];
  const lines = text.split("\n").map(line => {
    const masked = maskLine(line);
    kinds.push(...masked.found);
    return masked.line;
  });
  return {
    text: lines.join("\n"),
    found: kinds.length,
    kinds: Array.from(new Set(kinds)),
  };
}

/** 이 본문에 가릴 것이 있는가 — 화면의 「원본 보기」 버튼을 띄울지 정한다 */
export function hasSensitive(text: string | null | undefined): boolean {
  return text ? maskSensitive(text).found > 0 : false;
}
