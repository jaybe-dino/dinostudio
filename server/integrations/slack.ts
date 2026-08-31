/**
 * §11.1 슬랙 연동 — 수집만 하고 승인은 하지 않는다.
 * §12 발송 어댑터 — 도착지가 죽어 있어도 알림함에는 남는다 (B7).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Slack 서명 검증 (v0) — 이 요청이 정말 슬랙에서 왔는지 */
export function verifySlackSignature(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  secret = process.env.SLACK_SIGNING_SECRET
): { ok: boolean; reason?: string } {
  if (!secret)
    return { ok: false, reason: "SLACK_SIGNING_SECRET이 설정되지 않았습니다" };
  if (!signature || !timestamp)
    return { ok: false, reason: "서명 헤더가 없습니다" };

  // 5분이 지난 요청은 재전송 공격으로 본다
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > 300)
    return { ok: false, reason: "요청이 만료되었습니다" };

  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return { ok: false, reason: "서명이 일치하지 않습니다" };
  return { ok: true };
}

/** 수집 대상 채널 — 채널 밖 요청(DM·구두)은 접수하지 않는다 */
export function isWatchedChannel(channelId: string): boolean {
  const list = (process.env.SLACK_EXPENSE_CHANNELS ?? "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  return list.length === 0 ? false : list.includes(channelId);
}

export interface SlackEventEnvelope {
  type: string;
  challenge?: string;
  event?: {
    type: string;
    subtype?: string;
    channel?: string;
    user?: string;
    bot_id?: string;
    text?: string;
    ts?: string;
    thread_ts?: string;
  };
}

export function slackConfigured(): boolean {
  return Boolean(process.env.SLACK_BOT_TOKEN);
}

/**
 * §12 알림 발송 — 실패해도 예외를 던지지 않는다.
 * 도착지가 죽어 있어도 경보는 알림함에 남아야 하므로, 발송 결과만 돌려준다.
 */
export async function postSlackMessage(
  channel: string,
  text: string
): Promise<{ sent: boolean; error?: string }> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token)
    return {
      sent: false,
      error: "SLACK_BOT_TOKEN 없음 — 알림함에만 적재합니다",
    };
  try {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel, text }),
    });
    const data = (await response.json()) as { ok?: boolean; error?: string };
    return data.ok
      ? { sent: true }
      : { sent: false, error: data.error ?? "슬랙 응답 실패" };
  } catch (error) {
    return {
      sent: false,
      error: error instanceof Error ? error.message : "발송 실패",
    };
  }
}
