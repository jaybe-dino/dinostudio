/**
 * §11.1 슬랙 지출요청 파싱 — 양식을 새로 만들지 않는다.
 *
 * #지출-네트워크-사업부는 봇이 이미 정형 메시지를 생성하고 있어 그 메시지를 파싱하면 되고,
 * #지출-ip-사업부는 수기라 파싱 실패를 허용한다 — 실패하면 버리지 않고 검수함에 남긴다.
 *
 * 승인은 슬랙에서 하지 않는다. 👍는 참고 이력일 뿐이고 원장의 승인은 시스템 안에서만 이뤄진다.
 */

export interface SlackExpenseFields {
  /** 기업명 → party 매칭 */
  partyName: string | null;
  /** 지출 내용 → title */
  title: string | null;
  startDate: string | null;
  deliverDate: string | null;
  requestDate: string | null;
  amount: number | null;
  amountSupply: number | null;
  amountVat: number | null;
  /** "(vat별도)" · "(VAT 포함)" 원문 표기 — B3가 확정되기 전까지 분리하지 않고 보존한다 */
  vatNotation: string | null;
  bankAccount: string | null;
  invoiceIssued: boolean | null;
  roundNo: number | null;
  buCode: string | null;
  linkedRevenueCode: string | null;
}

export interface SlackParseResult {
  fields: SlackExpenseFields;
  /** 필수 항목 중 비어 있는 것 (§11.1 필수 열) */
  missingRequired: string[];
  /** 사람이 봐야 하는 것 */
  warnings: string[];
  /** 규칙 파서가 알아본 필드 수 — 0이면 비정형이므로 AI에 넘긴다 */
  matchedFields: number;
  ok: boolean;
}

const EMPTY: SlackExpenseFields = {
  partyName: null,
  title: null,
  startDate: null,
  deliverDate: null,
  requestDate: null,
  amount: null,
  amountSupply: null,
  amountVat: null,
  vatNotation: null,
  bankAccount: null,
  invoiceIssued: null,
  roundNo: null,
  buCode: null,
  linkedRevenueCode: null,
};

/** §11.1 필수 필드 — 하나라도 비면 원장에 바로 올리지 않고 검수함에 세운다 */
export const REQUIRED_FIELDS: (keyof SlackExpenseFields)[] = [
  "partyName",
  "title",
  "amount",
  "requestDate",
  "bankAccount",
  "invoiceIssued",
];

const LABELS: Record<string, keyof SlackExpenseFields> = {
  기업명: "partyName",
  업체명: "partyName",
  거래처: "partyName",
  지출내용: "title",
  내용: "title",
  항목: "title",
  착수일: "startDate",
  최종업로드일: "deliverDate",
  업로드일: "deliverDate",
  지출요청일: "requestDate",
  요청일: "requestDate",
  금액: "amount",
  입금계좌: "bankAccount",
  계좌: "bankAccount",
  계산서발행: "invoiceIssued",
  세금계산서: "invoiceIssued",
  회차: "roundNo",
  사업부: "buCode",
  대응매출: "linkedRevenueCode",
};

const BU_ALIASES: Record<string, string> = {
  ip: "IP",
  아이피: "IP",
  네트워크: "NET",
  net: "NET",
  커머스: "COM",
  com: "COM",
  글로벡: "GLV",
  glovek: "GLV",
  glv: "GLV",
  공통: "CMN",
  cmn: "CMN",
};

export function parseKoreanAmount(raw: string): number | null {
  const text = raw.replace(/\s/g, "");
  // 1,100,000 · 110만원 · 1100000
  const man = /([0-9,.]+)\s*만\s*원?/.exec(text);
  if (man) {
    const value = Number(man[1].replace(/,/g, ""));
    if (Number.isFinite(value)) return Math.round(value * 10_000);
  }
  const digits = text.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const value = Number(digits);
  return Number.isFinite(value) ? value : null;
}

export function parseSlackDate(
  raw: string,
  fallbackYear: number
): string | null {
  const text = raw.trim();
  const full = /(\d{4})[-./년]\s*(\d{1,2})[-./월]\s*(\d{1,2})/.exec(text);
  if (full)
    return `${full[1]}-${full[2].padStart(2, "0")}-${full[3].padStart(2, "0")}`;
  const short = /(\d{1,2})[-./월]\s*(\d{1,2})/.exec(text);
  if (short)
    return `${fallbackYear}-${short[1].padStart(2, "0")}-${short[2].padStart(2, "0")}`;
  return null;
}

function normalizeLabel(label: string): string {
  return label.replace(/[\s*_·:：]/g, "").toLowerCase();
}

/**
 * 정형 메시지 파서 — `기업명: 디노스튜디오` 처럼 라벨이 있는 줄만 읽는다.
 * 라벨을 하나도 못 찾으면 matchedFields = 0이 되고, 그때 AI 파서로 넘어간다.
 */
export function parseSlackExpense(
  text: string,
  fallbackYear = new Date().getFullYear()
): SlackParseResult {
  const fields: SlackExpenseFields = { ...EMPTY };
  const warnings: string[] = [];
  let matched = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^[\s>*\-•]+/, "").trim();
    if (!line) continue;
    const separator = /[:：]/.exec(line);
    if (!separator) continue;
    const label = normalizeLabel(line.slice(0, separator.index));
    const value = line.slice(separator.index + 1).trim();
    if (!value) continue;

    const key = LABELS[label];
    if (!key) continue;
    matched += 1;

    switch (key) {
      case "amount": {
        // "(vat별도)" · "(VAT 포함)" 표기는 원문 그대로 보존한다 — 전사 기준이 아직 없다 (B3)
        const notation = /\((\s*vat[^)]*|\s*부가세[^)]*)\)/i.exec(value);
        if (notation)
          fields.vatNotation = notation[0].replace(/[()]/g, "").trim();
        // 공급가액과 세액이 둘 다 적혀 있을 때만 분리한다. 추정하지 않는다 (원칙 8)
        const supply = /공급\s*가?액?\s*[:：]?\s*([0-9,]+)/.exec(value);
        const vat = /(?:세액|부가세)\s*[:：]?\s*([0-9,]+)/.exec(value);
        if (supply && vat) {
          fields.amountSupply = parseKoreanAmount(supply[1]);
          fields.amountVat = parseKoreanAmount(vat[1]);
          fields.amount =
            fields.amountSupply != null && fields.amountVat != null
              ? fields.amountSupply + fields.amountVat
              : parseKoreanAmount(value);
        } else {
          fields.amount = parseKoreanAmount(value);
          if (fields.vatNotation) {
            warnings.push(
              `VAT 표기 "${fields.vatNotation}" — 전사 기준 미확정이라 공급가액·세액을 분리하지 않았습니다 (B3)`
            );
          }
        }
        break;
      }
      case "startDate":
      case "deliverDate":
      case "requestDate":
        fields[key] = parseSlackDate(value, fallbackYear);
        if (fields[key] == null)
          warnings.push(`${label} 날짜를 읽을 수 없습니다 — "${value}"`);
        break;
      case "invoiceIssued":
        fields.invoiceIssued = /^(o|ㅇ|예|y|yes|발행|필요|있음|true)/i.test(
          value
        )
          ? true
          : /^(x|아니|n|no|미발행|불필요|없음|false)/i.test(value)
            ? false
            : null;
        if (fields.invoiceIssued == null)
          warnings.push(`계산서 발행 여부를 읽을 수 없습니다 — "${value}"`);
        break;
      case "roundNo": {
        const digits = value.replace(/[^0-9]/g, "");
        fields.roundNo = digits ? Number(digits) : null;
        break;
      }
      case "buCode": {
        const alias = BU_ALIASES[value.replace(/\s|사업부/g, "").toLowerCase()];
        fields.buCode = alias ?? null;
        if (!alias) warnings.push(`사업부를 알아볼 수 없습니다 — "${value}"`);
        break;
      }
      default:
        fields[key] = value as never;
    }
  }

  const missingRequired = REQUIRED_FIELDS.filter(
    key => fields[key] == null || fields[key] === ""
  );
  return {
    fields,
    missingRequired,
    warnings,
    matchedFields: matched,
    ok: matched > 0 && missingRequired.length === 0,
  };
}

/** 슬랙 메시지가 지출 요청처럼 보이는가 — 잡담을 검수함에 쌓지 않기 위한 1차 관문 */
export function looksLikeExpenseRequest(text: string): boolean {
  if (!text || text.length < 10) return false;
  const hints = [
    "지출",
    "기업명",
    "금액",
    "입금계좌",
    "계산서",
    "요청일",
    "정산",
  ];
  return hints.filter(hint => text.includes(hint)).length >= 2;
}
