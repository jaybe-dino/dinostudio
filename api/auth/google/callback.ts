/**
 * GET /api/auth/google/callback — 구글이 돌려보낸 code를 세션 쿠키로 바꾼다.
 * 허용 도메인·계정이 아니면 세션을 만들지 않는다. 열어두는 것이 기본값이면 안 된다.
 */
import { exchangeCode, redirectUriFrom } from "../../../server/auth/google";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  STATE_COOKIE,
  createSessionToken,
  isAllowedIdentity,
  parseCookies,
  serializeCookie,
} from "../../../server/auth/session";

function deny(message: string, status = 403): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>로그인 실패</title>` +
      `<div style="font:14px/1.6 system-ui;padding:40px;max-width:60ch">` +
      `<h1 style="font-size:18px">로그인할 수 없습니다</h1><p>${message}</p>` +
      `<p><a href="/api/auth/google/start">다시 시도</a></p></div>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }
  );
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookies = parseCookies(req.headers.get("cookie"));
  const secure = url.protocol === "https:";

  if (url.searchParams.get("error"))
    return deny(
      `구글이 로그인을 거부했습니다 — ${url.searchParams.get("error")}`
    );
  if (!code || !state) return deny("잘못된 콜백 요청입니다.", 400);
  if (cookies[STATE_COOKIE] !== state)
    return deny("로그인 요청이 만료되었거나 위조되었습니다.", 400);

  let identity;
  try {
    identity = await exchangeCode(code, redirectUriFrom(url.origin));
  } catch (error) {
    return deny(
      error instanceof Error ? error.message : "구글 인증에 실패했습니다.",
      400
    );
  }

  const allowed = isAllowedIdentity(identity.email, identity.hd);
  if (!allowed.ok) return deny(allowed.reason ?? "허용된 계정이 아닙니다.");

  const token = await createSessionToken(identity);
  const next = state.split("|").slice(1).join("|") || "/erp";
  // 외부 사이트로 튕겨 나가지 않도록 내부 경로만 허용한다
  const safeNext =
    next.startsWith("/") && !next.startsWith("//") ? next : "/erp";

  return new Response(null, {
    status: 302,
    headers: [
      ["Location", safeNext],
      [
        "Set-Cookie",
        serializeCookie(SESSION_COOKIE, token, {
          maxAge: SESSION_MAX_AGE_SECONDS,
          secure,
        }),
      ],
      ["Set-Cookie", serializeCookie(STATE_COOKIE, "", { maxAge: 0, secure })],
      ["Cache-Control", "no-store"],
    ],
  });
}
