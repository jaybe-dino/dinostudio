/** GET|POST /api/auth/logout — 세션 쿠키를 지운다. */
import { SESSION_COOKIE, serializeCookie } from "../../server/auth/session";

function handler(req: Request): Response {
  const url = new URL(req.url);
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": serializeCookie(SESSION_COOKIE, "", {
        maxAge: 0,
        secure: url.protocol === "https:",
      }),
      "Cache-Control": "no-store",
    },
  });
}

/*
 * Vercel 서버리스 런타임은 이 파일을 정적으로 훑어 어떤 HTTP 메서드를 다루는지 정한다.
 * `export { handler as GET }` 같은 별칭 재export 는 그 탐지에 잡히지 않아
 * FUNCTION_INVOCATION_FAILED 로 죽는다 — 그래서 메서드마다 선언형으로 내보낸다.
 */
export function GET(req: Request): Response {
  return handler(req);
}

export function POST(req: Request): Response {
  return handler(req);
}
