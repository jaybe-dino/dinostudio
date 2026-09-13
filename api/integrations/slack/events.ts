/**
 * POST /api/integrations/slack/events — 슬랙 Events API 수신구.
 *
 * 승인은 슬랙에서 하지 않는다 (§11.1). 여기서는 수집만 하고, 원장 적재는
 * 검수함에서 사람이 확인한 뒤에 이뤄진다.
 */
import { getLedgerService, resolveErpRole } from "../../../server/erp/index.js";
import {
  isWatchedChannel,
  verifySlackSignature,
  type SlackEventEnvelope,
} from "../../../server/integrations/slack.js";
import { isCollectableMessage } from "../../../server/integrations/slackHistory.js";

export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();
  const check = verifySlackSignature(
    raw,
    req.headers.get("x-slack-signature"),
    req.headers.get("x-slack-request-timestamp")
  );
  if (!check.ok)
    return new Response(check.reason ?? "unauthorized", { status: 401 });

  let payload: SlackEventEnvelope;
  try {
    payload = JSON.parse(raw) as SlackEventEnvelope;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  // 슬랙 앱 등록 시 한 번 오는 확인 요청
  if (payload.type === "url_verification" && payload.challenge) {
    return new Response(payload.challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const event = payload.event;
  if (
    !event ||
    event.type !== "message" ||
    !isCollectableMessage(event) ||
    !event.channel
  ) {
    return new Response("ok", { status: 200 });
  }
  if (!isWatchedChannel(event.channel))
    return new Response("ok", { status: 200 });
  /*
   * 우리가 보낸 알림을 우리가 다시 주워 오면 안 된다.
   *
   * 봇 글을 받기 시작했으므로(사내 지출 요청이 워크플로 봇 글이다) 이 고리가
   * 실제로 생길 수 있다. 알림을 내보내는 채널은 수집하지 않는 것으로 끊는다 —
   * 봇 ID 를 환경변수로 또 받는 것보다 틀릴 여지가 적다.
   */
  if (event.channel === process.env.SLACK_NOTIFY_CHANNEL)
    return new Response("ok", { status: 200 });

  // 수집은 시스템 행위다 — 사람 승인과 구분되도록 별도 actor로 감사로그에 남긴다
  const role =
    resolveErpRole(process.env.SLACK_INTAKE_ACTOR_EMAIL ?? null) ?? "재무";
  try {
    await getLedgerService().collectSlackMessage(
      {
        channel: event.channel,
        ts: event.ts,
        text: event.text,
        user: event.user ?? event.bot_id ?? null,
        files: event.files,
      },
      {
        id: process.env.SLACK_INTAKE_ACTOR_EMAIL ?? "slack-bot",
        role,
        ip: null,
      }
    );
  } catch (error) {
    // 슬랙은 3초 안에 200을 못 받으면 재전송한다. 실패도 200으로 닫고 로그만 남긴다.
    console.error("[Slack] 수집 실패:", error);
  }
  return new Response("ok", { status: 200 });
}
