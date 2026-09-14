/**
 * 붙은 파일에서 **글자를 꺼낸다.**
 *
 * 계약서 PDF 와 캡처 이미지가 지출·계약의 실제 내용을 담고 있다. 본문만 읽고
 * 파일을 버리면 「계약서 서명 부탁드립니다」 한 줄만 남는다.
 *
 * 세 갈래로 나눈다.
 *   · **글자 파일**은 그냥 읽는다. 모델을 부를 이유가 없다
 *   · **PDF · 이미지**는 Claude 에 그대로 넘긴다 (document · image 블록).
 *     별도 PDF 라이브러리를 붙이지 않는다 — 서버리스에서 무겁고, 스캔본은
 *     어차피 못 읽는다
 *   · 그 밖은 **이름만** 남긴다
 *
 * 지키는 것 — 모델에게 **요약하지 말고 옮겨 적으라**고 시킨다. 요약하면 금액과
 * 날짜가 사라지고, 그 둘이 우리가 필요한 전부다. 그리고 없는 값을 지어내지
 * 않게 한다 (원칙 8).
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  classifyFile,
  downloadSlackFile,
  type SlackFileMeta,
} from "./slackFiles.js";
import { AI_MODEL } from "./aiParser.js";

export interface ReadFileResult {
  name: string;
  mimetype: string | null;
  size: number | null;
  permalink: string | null;
  /** 꺼낸 글자. 못 꺼냈으면 null */
  text: string | null;
  /** 왜 못 꺼냈나 — 사람이 보고 판단할 수 있어야 한다 */
  reason: string | null;
}

const EXTRACT_PROMPT = [
  "첨부된 문서에 적힌 내용을 **그대로 옮겨 적으십시오.**",
  "",
  "· 요약하지 마십시오. 금액·날짜·거래처·계좌·기간·수량은 한 글자도 바꾸지 말고 그대로 적으십시오.",
  "· 표는 줄 단위로 펴서 적으십시오.",
  "· 문서에 없는 값을 지어내지 마십시오. 안 보이면 그 자리를 비워 두십시오.",
  "· 도장·서명 이미지처럼 글자가 아닌 것은 [서명] 처럼 표시만 하십시오.",
].join("\n");

/** 모델이 돌려줄 글자의 상한 — 계약서 한 부를 담을 만큼 */
const MAX_OUTPUT_TOKENS = 16_000;

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/**
 * 파일 하나를 읽는다.
 *
 * 모델 호출은 `client` 를 주입받는다 — 테스트가 진짜 API 를 부르지 않아야 한다.
 */
export async function readSlackFile(
  file: SlackFileMeta,
  options: {
    token: string | undefined;
    client?: Anthropic | null;
    doFetch?: typeof fetch;
  }
): Promise<ReadFileResult> {
  const base: ReadFileResult = {
    name: file.name ?? file.title ?? "이름 없는 파일",
    mimetype: file.mimetype ?? null,
    size: file.size ?? null,
    permalink: file.permalink ?? null,
    text: null,
    reason: null,
  };

  const kind = classifyFile(file);
  if (kind === "unsupported")
    return { ...base, reason: "아직 읽지 못하는 형식입니다 — 이름만 남깁니다" };
  if (!options.token)
    return {
      ...base,
      reason: "SLACK_BOT_TOKEN 이 없어 파일을 받지 못했습니다",
    };

  const downloaded = await downloadSlackFile(
    file,
    options.token,
    options.doFetch
  );
  if ("error" in downloaded) return { ...base, reason: downloaded.error };

  if (kind === "text") {
    const text = decodeText(downloaded.bytes).trim();
    return text
      ? { ...base, text }
      : { ...base, reason: "내용이 비어 있습니다" };
  }

  // PDF · 이미지 — 모델에게 옮겨 적게 한다
  const client = options.client ?? defaultClient();
  if (!client)
    return {
      ...base,
      reason:
        "ANTHROPIC_API_KEY 가 없어 PDF·이미지를 읽지 못했습니다 — 파일 이름은 남았습니다",
    };

  try {
    const block: Anthropic.ContentBlockParam =
      kind === "pdf"
        ? {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: toBase64(downloaded.bytes),
            },
          }
        : {
            type: "image",
            source: {
              type: "base64",
              media_type: downloaded.mimetype as
                | "image/png"
                | "image/jpeg"
                | "image/gif"
                | "image/webp",
              data: toBase64(downloaded.bytes),
            },
          };

    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [
        {
          role: "user",
          content: [block, { type: "text", text: EXTRACT_PROMPT }],
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map(b => b.text)
      .join("\n")
      .trim();

    return text
      ? { ...base, text }
      : { ...base, reason: "문서에서 글자를 찾지 못했습니다" };
  } catch (error) {
    return {
      ...base,
      reason: error instanceof Error ? error.message : "문서를 읽지 못했습니다",
    };
  }
}

function defaultClient(): Anthropic | null {
  return process.env.ANTHROPIC_API_KEY ? new Anthropic({ timeout: 20_000, maxRetries: 0 }) : null;
}

/**
 * 메시지에 붙은 파일을 전부 읽는다.
 *
 * 하나가 실패해도 나머지는 계속한다 — 파일 하나 때문에 메시지 전체를 잃으면 안
 * 된다. 순서대로 처리한다: 동시에 여러 개를 모델에 보내면 서버리스 시간 안에
 * 못 끝난다.
 */
export async function readSlackFiles(
  files: SlackFileMeta[],
  options: {
    token: string | undefined;
    client?: Anthropic | null;
    doFetch?: typeof fetch;
  }
): Promise<ReadFileResult[]> {
  const out: ReadFileResult[] = [];
  for (const file of files) out.push(await readSlackFile(file, options));
  return out;
}
