/**
 * §11.1 슬랙 과거 메시지 백필.
 *
 * Events API 는 **구독을 켠 다음**에 올라온 메시지만 보낸다. 한 달 전 집행요청을
 * 원장에 넣으려면 `conversations.history` 로 따로 긁어와야 한다. 이 파일은 그
 * 호출부만 담당하고, 무엇을 수집할지(채널 허용)와 어떻게 읽을지(파싱)는
 * 기존 경로를 그대로 쓴다 — 수집 규칙이 두 벌이 되면 반드시 갈라진다.
 *
 * 속도 제한을 특히 조심해야 한다. 슬랙은 2025-05-29 이후에 만들어진 앱의
 * `conversations.history` 를 **분당 1회 · 회당 15건**까지로 낮췄다. 그래서
 * 여기서는 절대 기다리지 않는다 — 429 를 받으면 그 자리에서 멈추고 커서를
 * 돌려준다. 호출한 쪽이 나중에 이어서 부르면 된다.
 */

export interface SlackHistoryMessage {
  type?: string;
  subtype?: string;
  text?: string;
  ts?: string;
  user?: string;
  bot_id?: string;
}

export interface SlackApiFailure {
  /** 슬랙이 준 error 코드 (missing_scope · not_in_channel 등) */
  error: string;
  /** 429 인 경우에만. 이 초만큼 지난 뒤 다시 부르면 된다 */
  retryAfterSec?: number;
}

function describeSlackError(error: string): string {
  switch (error) {
    case "missing_scope":
    case "not_allowed_token_type":
      return "슬랙 앱에 권한이 없습니다 — OAuth & Permissions 에서 channels:history · channels:read (비공개 채널이면 groups:history · groups:read) 를 추가하고 재설치하십시오";
    case "not_in_channel":
      return "봇이 그 채널에 없습니다 — 채널에서 /invite 하십시오";
    case "channel_not_found":
      return "채널을 찾을 수 없습니다 — 채널 ID 를 확인하십시오";
    case "invalid_auth":
    case "token_revoked":
    case "account_inactive":
      return "SLACK_BOT_TOKEN 이 더 이상 유효하지 않습니다 — 앱을 재설치하고 토큰을 다시 넣으십시오";
    case "ratelimited":
      return "슬랙이 속도 제한을 걸었습니다 — 잠시 뒤 이어서 가져오십시오";
    default:
      return `슬랙 API 오류 — ${error}`;
  }
}

export function slackErrorMessage(failure: SlackApiFailure): string {
  const base = describeSlackError(failure.error);
  return failure.retryAfterSec
    ? `${base} (${failure.retryAfterSec}초 뒤)`
    : base;
}

interface SlackEnvelope {
  ok?: boolean;
  error?: string;
  channels?: { id?: string; name?: string }[];
  messages?: SlackHistoryMessage[];
  response_metadata?: { next_cursor?: string };
}

async function slackGet(
  method: string,
  params: Record<string, string>,
  token: string
): Promise<
  { ok: true; body: SlackEnvelope } | ({ ok: false } & SlackApiFailure)
> {
  const query = new URLSearchParams(params).toString();
  let response: Response;
  try {
    response = await fetch(`https://slack.com/api/${method}?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "네트워크 오류",
    };
  }

  // 429 는 본문이 비어 있을 수 있다. 헤더가 유일하게 믿을 수 있는 값이다.
  if (response.status === 429) {
    const header = Number(response.headers.get("retry-after"));
    return {
      ok: false,
      error: "ratelimited",
      retryAfterSec: Number.isFinite(header) && header > 0 ? header : 60,
    };
  }

  let body: SlackEnvelope;
  try {
    body = (await response.json()) as SlackEnvelope;
  } catch {
    return {
      ok: false,
      error: `응답을 읽지 못했습니다 (HTTP ${response.status})`,
    };
  }
  if (!body.ok) return { ok: false, error: body.error ?? "unknown" };
  return { ok: true, body };
}

/**
 * 봇이 들어가 있는 채널 목록.
 *
 * `SLACK_EXPENSE_CHANNELS=*` 의 뜻이 「봇을 초대한 채널이 곧 수집 대상」이므로,
 * 백필도 같은 기준을 써야 한다. 채널 ID 를 저장소에 박아 두지 않는 이유이기도
 * 하다 — 채널이 늘면 초대만으로 따라와야 한다.
 */
export async function listBotChannels(
  token: string,
  fetchPage = slackGet
): Promise<
  { channels: { id: string; name: string | null }[] } | SlackApiFailure
> {
  const found: { id: string; name: string | null }[] = [];
  let cursor = "";
  // 페이지가 끝없이 돌지 않도록 상한을 둔다 (200 × 10 = 2,000채널)
  for (let page = 0; page < 10; page += 1) {
    const params: Record<string, string> = {
      types: "public_channel,private_channel",
      exclude_archived: "true",
      limit: "200",
    };
    if (cursor) params.cursor = cursor;

    const result = await fetchPage("users.conversations", params, token);
    if (!result.ok) return result;

    for (const channel of result.body.channels ?? []) {
      if (channel.id)
        found.push({ id: channel.id, name: channel.name ?? null });
    }
    cursor = result.body.response_metadata?.next_cursor ?? "";
    if (!cursor) break;
  }
  return { channels: found };
}

/**
 * 한 채널의 과거 메시지 한 페이지.
 *
 * `oldest` 는 슬랙 ts (초). 그 시각 **이후**만 돌려준다. 커서가 없으면 끝이다.
 */
export async function fetchHistoryPage(
  args: {
    token: string;
    channel: string;
    oldest: string;
    cursor?: string | null;
    limit?: number;
  },
  fetchPage = slackGet
): Promise<
  | { messages: SlackHistoryMessage[]; nextCursor: string | null }
  | SlackApiFailure
> {
  const params: Record<string, string> = {
    channel: args.channel,
    oldest: args.oldest,
    limit: String(args.limit ?? 200),
    inclusive: "false",
  };
  if (args.cursor) params.cursor = args.cursor;

  const result = await fetchPage("conversations.history", params, args.token);
  if (!result.ok) return result;

  return {
    messages: result.body.messages ?? [],
    nextCursor: result.body.response_metadata?.next_cursor || null,
  };
}

/** 사람이 쓴 지출 요청으로 볼 만한 메시지인가 — 봇 글·참여 알림 등을 건너뛴다 */
export function isCollectableMessage(message: SlackHistoryMessage): boolean {
  if (message.type && message.type !== "message") return false;
  if (message.subtype) return false; // channel_join · bot_message · 파일 공유 등
  if (message.bot_id) return false;
  return Boolean(message.text && message.ts);
}
