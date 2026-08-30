/**
 * AI 파서 — 규칙 파서가 못 읽은 비정형 메시지를 Claude가 구조화한다.
 *
 * #지출-ip-사업부는 수기라 양식이 제각각이다. 규칙 파서를 먼저 돌리고 실패한 것만 여기로 온다 —
 * 정형 메시지에 LLM을 쓰는 것은 비용과 비결정성만 늘린다.
 *
 * 지켜야 할 것
 *   · 모델이 금액을 **추정하지 않는다**. 모르면 null로 두고 왜 모르는지 적게 한다 (원칙 8)
 *   · 결과는 검수함에 서고, 사람이 확인해야 원장으로 올라간다 (원칙 7)
 *   · 단위가 불명한 숫자는 금액으로 올리지 않는다 (§5.2)
 */
import Anthropic from "@anthropic-ai/sdk";
import type { SlackExpenseFields } from "../../shared/erp/index.js";

export const AI_MODEL = "claude-opus-5";

/**
 * 구조화 추출 도구 — strict: true 로 스키마를 강제한다.
 * 모르는 값은 반드시 null이어야 하고, 그 이유를 uncertain에 적게 한다.
 */
const EXTRACT_TOOL: Anthropic.Beta.BetaTool = {
  name: "record_expense_request",
  description:
    "슬랙 지출 요청 메시지에서 원장 필드를 추출한다. 메시지에 명시되지 않은 값은 반드시 null로 두고 추측하지 않는다.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      partyName: {
        type: ["string", "null"],
        description: "기업명·거래처명. 없으면 null",
      },
      title: {
        type: ["string", "null"],
        description: "지출 내용. 원문 표현을 그대로 쓴다",
      },
      amount: {
        type: ["integer", "null"],
        description:
          "총 금액(원). 단위(원/만원)가 분명할 때만 채운다. '80' 처럼 단위를 알 수 없으면 null",
      },
      amountSupply: {
        type: ["integer", "null"],
        description: "공급가액. 메시지에 명시됐을 때만",
      },
      amountVat: {
        type: ["integer", "null"],
        description: "세액. 메시지에 명시됐을 때만",
      },
      vatNotation: {
        type: ["string", "null"],
        description: "'vat별도' · 'VAT 포함' 같은 원문 표기",
      },
      startDate: { type: ["string", "null"], description: "착수일 YYYY-MM-DD" },
      deliverDate: {
        type: ["string", "null"],
        description: "최종 업로드일(용역 완료일) YYYY-MM-DD",
      },
      requestDate: {
        type: ["string", "null"],
        description: "지출 요청일 YYYY-MM-DD",
      },
      bankAccount: { type: ["string", "null"], description: "입금계좌" },
      invoiceIssued: {
        type: ["boolean", "null"],
        description: "세금계산서 발행 여부",
      },
      roundNo: { type: ["integer", "null"], description: "회차" },
      buCode: {
        type: ["string", "null"],
        enum: ["IP", "NET", "COM", "GLV", "CMN", null],
        description: "사업부",
      },
      linkedRevenueCode: {
        type: ["string", "null"],
        description: "대응 매출 건 코드",
      },
      uncertain: {
        type: "array",
        items: { type: "string" },
        description:
          "채우지 못한 필드와 그 이유. 예: '금액 — 80이 만원인지 원인지 불명'",
      },
      isExpenseRequest: {
        type: "boolean",
        description: "이 메시지가 지출 요청인가. 잡담이면 false",
      },
    },
    required: [
      "partyName",
      "title",
      "amount",
      "amountSupply",
      "amountVat",
      "vatNotation",
      "startDate",
      "deliverDate",
      "requestDate",
      "bankAccount",
      "invoiceIssued",
      "roundNo",
      "buCode",
      "linkedRevenueCode",
      "uncertain",
      "isExpenseRequest",
    ],
  },
};

const SYSTEM = `당신은 디노스튜디오 경영관리 시스템의 지출 요청 파서입니다.
슬랙에 올라온 지출 요청 메시지를 읽고 원장 필드로 옮깁니다.

반드시 지킬 것
1. 메시지에 없는 값은 추측하지 말고 null로 둡니다. 비어 있는 것이 틀린 값보다 낫습니다.
2. 숫자의 단위(원 / 만원)가 분명하지 않으면 amount를 null로 두고 uncertain에 이유를 적습니다.
   예: "80"만 적혀 있으면 8십원인지 80만원인지 알 수 없으므로 null입니다.
3. 공급가액과 세액은 메시지에 둘 다 적혀 있을 때만 채웁니다. 총액에서 역산하지 않습니다.
4. 항목명(title)은 원문 표현을 그대로 씁니다. 정리하거나 요약하지 않습니다.
5. 날짜는 YYYY-MM-DD로 정규화합니다. 연도가 없으면 오늘 기준 연도를 씁니다.
6. 승인 여부·우선순위·계정과목은 판단하지 않습니다. 그것은 사람과 규칙이 정합니다.

이 결과는 곧바로 원장에 반영되지 않고 사람이 확인하는 검수함에 섭니다.`;

export interface AiParseResult {
  fields: SlackExpenseFields;
  uncertain: string[];
  isExpenseRequest: boolean;
  model: string;
  usage: { input: number; output: number } | null;
}

export function aiConfigured(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
  );
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export async function aiParseExpense(
  text: string,
  today: string
): Promise<AiParseResult | null> {
  if (!aiConfigured()) return null;

  const response = await getClient().beta.messages.create({
    model: AI_MODEL,
    max_tokens: 4096,
    // 추출은 무겁지 않다 — 적응형 사고를 켜되 effort는 낮게 잡아 비용을 아낀다
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    // 정책 거절 시 같은 요청을 대체 모델로 이어서 처리한다
    betas: ["server-side-fallback-2026-06-01"],
    fallbacks: [{ model: "claude-opus-4-8" }],
    system: [
      {
        type: "text",
        text: SYSTEM,
        // 시스템 프롬프트와 도구 정의는 매 요청 동일하다 — 프리픽스를 캐시한다
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: EXTRACT_TOOL.name },
    messages: [
      {
        role: "user",
        content: `오늘은 ${today}입니다. 아래 슬랙 메시지를 파싱하십시오.\n\n---\n${text}\n---`,
      },
    ],
  });

  if (response.stop_reason === "refusal") return null;

  const block = response.content.find(
    (item): item is Anthropic.Beta.BetaToolUseBlock => item.type === "tool_use"
  );
  if (!block) return null;

  // 도구 입력은 항상 파싱해서 읽는다 — 문자열 매칭 금지
  const input = block.input as Record<string, unknown>;
  const str = (key: string) =>
    typeof input[key] === "string" ? (input[key] as string) : null;
  const num = (key: string) =>
    typeof input[key] === "number" ? (input[key] as number) : null;

  return {
    fields: {
      partyName: str("partyName"),
      title: str("title"),
      startDate: str("startDate"),
      deliverDate: str("deliverDate"),
      requestDate: str("requestDate"),
      amount: num("amount"),
      amountSupply: num("amountSupply"),
      amountVat: num("amountVat"),
      vatNotation: str("vatNotation"),
      bankAccount: str("bankAccount"),
      invoiceIssued:
        typeof input.invoiceIssued === "boolean" ? input.invoiceIssued : null,
      roundNo: num("roundNo"),
      buCode: str("buCode"),
      linkedRevenueCode: str("linkedRevenueCode"),
    },
    uncertain: Array.isArray(input.uncertain)
      ? (input.uncertain as string[])
      : [],
    isExpenseRequest: input.isExpenseRequest === true,
    model: response.model,
    usage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
    },
  };
}
