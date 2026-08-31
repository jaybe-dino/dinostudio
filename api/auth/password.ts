/**
 * POST /api/auth/password — 이메일 + 지정 비밀번호로 세션 쿠키를 만든다.
 * 구글 SSO를 붙이기 전까지 쓰는 임시 경로이고, 발급하는 쿠키는 SSO와 완전히 같다.
 */
import { verifyPasswordLogin } from "../../server/auth/password.js";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  serializeCookie,
} from "../../server/auth/session.js";

function json(body: unknown, status: number, extra: [string, string][] = []) {
  return new Response(JSON.stringify(body), {
    status,
    headers: [
      ["Content-Type", "application/json; charset=utf-8"],
      ["Cache-Control", "no-store"],
      ...extra,
    ],
  });
}

/*
 * Vercel 서버리스 런타임은 이 파일을 정적으로 훑어 어떤 HTTP 메서드를 다루는지 정한다.
 * `export { handler as GET }` 같은 별칭 재export 는 그 탐지에 잡히지 않아
 * FUNCTION_INVOCATION_FAILED 로 죽는다 — 그래서 메서드마다 선언형으로 내보낸다.
 */
export async function POST(req: Request): Promise<Response> {
  if (req.method !== "POST")
    return json({ ok: false, reason: "POST 로만 호출합니다." }, 405);

  // JSON 본문만 받는다 — 다른 사이트의 <form> 이 몰래 이 주소로 쏘는 것을 막는다
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json"))
    return json({ ok: false, reason: "잘못된 요청입니다." }, 415);

  let body: { email?: unknown; password?: unknown; next?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ ok: false, reason: "잘못된 요청입니다." }, 400);
  }

  const result = await verifyPasswordLogin(body.email, body.password);
  if (!result.ok)
    return json({ ok: false, reason: result.reason }, result.status);

  const token = await createSessionToken(result.identity);
  const url = new URL(req.url);
  const next = typeof body.next === "string" ? body.next : "/";
  // 외부 사이트로 튕겨 나가지 않도록 내부 경로만 허용한다
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  return json({ ok: true, next: safeNext }, 200, [
    [
      "Set-Cookie",
      serializeCookie(SESSION_COOKIE, token, {
        maxAge: SESSION_MAX_AGE_SECONDS,
        // 다른 사이트에서 넘어온 요청에는 세션을 실어 보내지 않는다
        sameSite: "Strict",
        secure: url.protocol === "https:",
      }),
    ],
  ]);
}
