/**
 * §11.1 슬랙 지출요청 파싱 — 양식을 새로 만들지 않는다.
 *
 * #지출-네트워크-사업부는 봇이 이미 정형 메시지를 생성하고 있어 그 메시지를 파싱하면 되고,
 * #지출-ip-사업부는 수기라 파싱 실패를 허용한다 — 실패하면 버리지 않고 검수함에 남긴다.
 *
 * 승인은 슬랙에서 하지 않는다. 👍는 참고 이력일 뿐이고 원장의 승인은 시스템 안에서만 이뤄진다.
 */
import { kstToday } from "./time.js";

export interface SlackExpenseFields {
  /**
   * 돈이 나가는가 들어오는가.
   *
   * 같은 워크플로 채널이라도 양식이 두 가지다 — 지출 집행 요청(나감)과
   * 계산서 발행 요청(들어옴). 둘을 같은 방향으로 적재하면 **매출이 지출로
   * 잡혀 손익 부호가 통째로 뒤집힌다.**
   */
  direction: "in" | "out";
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
  direction: "out",
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

/*
 * 라벨 사전 — **실제 채널에 올라오는 말**을 기준으로 한다.
 *
 * 처음에는 사양서의 예시 양식(지출내용 · 입금계좌 · 요청일)만 넣어 두었는데,
 * 실제 #재무-집행요청 · #결제요청방 글을 보니 쓰는 말이 달랐다. 그대로 두면
 * 메시지는 검수함에 들어오지만 칸이 거의 비어서 사람이 전부 다시 친다 —
 * 연동이 붙어 있는데 일을 하지 않는 상태가 된다.
 *
 * 양식을 새로 만들어 사람들에게 지키라고 하지 않는다 (§11.1). 쓰던 말을
 * 사전에 넣는 쪽이 맞다.
 */
const LABELS: Record<string, keyof SlackExpenseFields> = {
  // 거래처 — 실제 글은 「예금주」로 적는 경우가 많다
  기업명: "partyName",
  업체명: "partyName",
  거래처: "partyName",
  예금주: "partyName",

  // 무엇에 쓰는 돈인가 — 실제 글은 「목적」이다
  지출내용: "title",
  목적: "title",
  내용: "title",
  항목: "title",
  // 계산서 발행 요청 양식 — 「품목명」
  품목명: "title",

  착수일: "startDate",
  최종업로드일: "deliverDate",
  최종업로드: "deliverDate",
  업로드일: "deliverDate",

  // 지급 요청일 — 「(입금) 요청 날짜」 「날짜」로도 적는다
  지출요청일: "requestDate",
  요청일: "requestDate",
  요청날짜: "requestDate",
  "(입금)요청날짜": "requestDate",
  입금요청날짜: "requestDate",
  날짜: "requestDate",
  정산신청날짜: "requestDate",
  // 계산서 발행 요청 양식 — 돈이 **들어올** 날이다
  입금예정일: "requestDate",

  // 금액 — 「정산금액」이 실제로 가장 많이 쓰인다
  금액: "amount",
  정산금액: "amount",
  결제금액: "amount",
  지급액: "amount",
  // 워크플로 양식 — 「지출 금액(VAT 포함)」
  지출금액: "amount",
  총지급액: "amount",
  입금액: "amount",
  청구금액: "amount",
  // 계산서 발행 요청 양식 — 「금액(부가세 포함)」은 괄호를 벗기면 「금액」이다

  입금계좌: "bankAccount",
  계좌: "bankAccount",
  계좌번호: "bankAccount",
  입금은행: "bankAccount",

  계산서발행: "invoiceIssued",
  세금계산서: "invoiceIssued",
  // 워크플로 양식 — 「계산서 발행 여부」
  계산서발행여부: "invoiceIssued",
  계산서: "invoiceIssued",
  회차: "roundNo",
  사업부: "buCode",
  대응매출: "linkedRevenueCode",
};

/**
 * 라벨 없이 한 줄로 적는 계산서 표기를 읽는다.
 *
 * 실제 글은 「계산서 발행완료」 「* 입금 후 계산서 자동발행」처럼 콜론 없이
 * 적는다. 라벨 파서는 콜론이 있어야 읽으므로 이 줄들을 통째로 놓치고 있었다.
 * 계산서 발행 여부는 미수 판정의 근거이므로(원칙 4) 놓치면 안 된다.
 */
function scanInvoiceMention(text: string): boolean | null {
  const flat = text.replace(/\s/g, "");
  if (!flat.includes("계산서")) return null;
  if (/계산서(자동)?발행(완료|함|했|예정)?/.test(flat)) return true;
  if (/계산서(미발행|발행안|발행불가|없음)/.test(flat)) return false;
  return null;
}

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
 * 이 글이 나가는 돈인가 들어오는 돈인가.
 *
 * 같은 워크스페이스에 양식이 두 가지다.
 *
 *   · **지출 집행 요청** — 우리가 거래처에 보낸다 (나감)
 *   · **계산서 발행 요청** — 우리가 거래처에 청구한다. 「입금 예정일」이 있고
 *     「청구발행」·「영수발행」이라고 적는다 (들어옴)
 *
 * 둘을 같은 방향으로 적재하면 매출이 지출로 잡혀 손익 부호가 뒤집힌다.
 * 그래서 **들어오는 쪽의 표시가 있을 때만** 수입으로 본다. 애매하면 지출이다 —
 * 이 회사에서 워크플로로 접수되는 것의 대부분이 지출이고, 잘못 넣더라도
 * 검수함에서 사람이 보게 된다.
 */
export function inferDirection(text: string): "in" | "out" {
  const flat = text.replace(/\s/g, "");
  if (
    /입금예정일|청구발행|영수발행|계산서발행요청|세금계산서발행요청/.test(flat)
  )
    return "in";
  return "out";
}

/**
 * 라벨 찾기 — 정확히 일치하는 것을 먼저 보고, 없으면 **정해진 순서로만** 깎는다.
 *
 * 실제 워크플로 양식이 `지출 금액(VAT 포함):` · `계산서 발행 여부:` 처럼
 * 괄호와 꼬리말을 달고 온다. 그렇다고 「포함하면 통과」로 느슨하게 하면
 * `계좌번호` 가 `번호` 에 걸리는 식의 오매칭이 생긴다. 그래서 깎는 방법을
 * 둘로 못 박았다 — ① 괄호 통째로 ② 꼬리 「여부」. 그 이상은 하지 않는다.
 */
function lookupLabel(label: string): keyof SlackExpenseFields | undefined {
  const direct = LABELS[label];
  if (direct) return direct;
  const noParen = label.replace(/\([^)]*\)/g, "");
  if (LABELS[noParen]) return LABELS[noParen];
  return LABELS[noParen.replace(/여부$/, "")];
}

/**
 * 정형 메시지 파서 — `기업명: 디노스튜디오` 처럼 라벨이 있는 줄만 읽는다.
 * 라벨을 하나도 못 찾으면 matchedFields = 0이 되고, 그때 AI 파서로 넘어간다.
 */
export function parseSlackExpense(
  text: string,
  fallbackYear = new Date().getFullYear()
): SlackParseResult {
  const fields: SlackExpenseFields = {
    ...EMPTY,
    direction: inferDirection(text),
  };
  const warnings: string[] = [];
  let matched = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^[\s>*\-•]+/, "").trim();
    if (!line) continue;
    const separator = /[:：]/.exec(line);
    if (!separator) continue;
    const rawLabel = line.slice(0, separator.index).trim();
    const label = normalizeLabel(rawLabel);
    const value = line.slice(separator.index + 1).trim();
    if (!value) continue;

    const key = lookupLabel(label);
    if (!key) continue;
    matched += 1;

    switch (key) {
      case "amount": {
        /*
         * "(vat별도)" · "(VAT 포함)" 표기는 원문 그대로 보존한다 — 전사 기준이
         * 아직 없다 (B3).
         *
         * 값에 붙는 경우(`1,000,000원 (vat별도)`)와 **라벨에 붙는 경우**
         * (`지출 금액(VAT 포함): 총 1,000,000원`)가 둘 다 있다. 뒤쪽이 지금
         * 실제로 쓰는 워크플로 양식이라, 값만 보면 표기를 통째로 잃는다.
         */
        const notation =
          /\((\s*vat[^)]*|\s*부가세[^)]*)\)/i.exec(value) ??
          /\((\s*vat[^)]*|\s*부가세[^)]*)\)/i.exec(rawLabel);
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

  // 라벨로 못 읽었으면 콜론 없는 한 줄 표기를 본다 (「계산서 발행완료」 등)
  if (fields.invoiceIssued == null) {
    const scanned = scanInvoiceMention(text);
    if (scanned != null) {
      fields.invoiceIssued = scanned;
      matched += 1;
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
  /*
   * 실제 채널에서 쓰는 말을 넣었다. 처음 목록(지출·기업명·입금계좌·요청일)은
   * 사양서 예시 기준이라 실제 글과 거의 겹치지 않았고, 「계산서」가 우연히
   * 들어간 글만 통과하고 있었다 — 계산서 얘기를 안 쓴 요청은 조용히 버려졌다.
   *
   * 두 개 이상을 요구하는 것은 그대로다. 하나로 낮추면 잡담이 들어온다.
   */
  const hints = [
    "지출",
    "집행요청",
    "결제요청",
    "정산",
    "기업명",
    "업체명",
    "품목명",
    "입금예정일",
    "청구발행",
    "예금주",
    "금액",
    "입금계좌",
    "계좌번호",
    "입금",
    "계산서",
    "요청일",
    "사업부",
  ];
  return hints.filter(hint => text.includes(hint)).length >= 2;
}
