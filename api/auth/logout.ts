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

export { handler as GET, handler as POST };
