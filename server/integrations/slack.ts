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

function envList(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
}

/**
 * 수집 대상 채널 — 채널 밖 요청(DM·구두)은 접수하지 않는다.
 *
 * 세 가지 모드가 있다.
 *   ① 채널 ID 목록 — 적은 것만 수집한다. 가장 좁다
 *   ② `*` — **봇을 초대한 모든 채널**. 슬랙은 봇이 들어가 있는 채널의
 *      message.channels 만 보내므로, 초대 자체가 허용 목록이 된다.
 *      채널이 늘 때마다 환경변수를 고치지 않아도 된다
 *   ③ 비어 있음 — 아무 것도 수집하지 않는다. **기본값은 닫힘이다**
 *      (설치만으로 조용히 수집이 시작되면 안 된다)
 *
 * ② 를 쓰면 실수로 초대된 채널까지 들어오므로 SLACK_IGNORE_CHANNELS 로
 * 예외를 둔다 — 그쪽이 항상 이긴다. 다만 어느 모드든 검수함까지만 오고,
 * 사람이 확인해야 원장으로 올라간다 (원칙 7).
 */
export function isWatchedChannel(channelId: string): boolean {
  if (envList("SLACK_IGNORE_CHANNELS").includes(channelId)) return false;
  const list = envList("SLACK_EXPENSE_CHANNELS");
  if (list.length === 0) return false;
  if (list.includes("*")) return true;
  return list.includes(channelId);
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
