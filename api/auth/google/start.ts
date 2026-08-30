/**
 * GET /api/auth/google/start — 구글 동의 화면으로 보낸다.
 * state는 쿠키에 함께 심어 CSRF를 막는다.
 */
import {
  authorizeUrl,
  googleConfigured,
  redirectUriFrom,
} from "../../../server/auth/google.js";
import { STATE_COOKIE, serializeCookie } from "../../../server/auth/session.js";

export function GET(req: Request): Response {
  if (!googleConfigured()) {
    return new Response(
      "구글 SSO가 설정되지 않았습니다 (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)",
      {
        status: 500,
      }
    );
  }
  const url = new URL(req.url);
  const next = url.searchParams.get("next") ?? "/erp";
  const nonce = crypto.randomUUID();
  // state 안에 돌아갈 경로를 함께 넣는다 — 콜백에서 쿠키와 대조한 뒤에만 신뢰한다
  const state = `${nonce}|${next}`;
  const secure = url.protocol === "https:";

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl(redirectUriFrom(url.origin), state),
      "Set-Cookie": serializeCookie(STATE_COOKIE, state, {
        maxAge: 600,
        secure,
      }),
      "Cache-Control": "no-store",
    },
  });
}
