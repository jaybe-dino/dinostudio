/**
 * Vercel Serverless Function — 사이트 tRPC API (/api/trpc/*).
 *
 * 경영관리 시스템(erp.*)을 포함한 실제 appRouter를 그대로 서빙한다.
 * Express 전용 객체(req/res)는 이 어댑터에서 최소 형태로 채워 넣고,
 * 사용자는 구글 SSO 세션 쿠키에서 읽는다 — 익명 접근은 protectedProcedure가 막는다.
 */
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { User } from "../../drizzle/schema.js";
import { appRouter } from "../../server/routers.js";
import type { TrpcContext } from "../../server/_core/context.js";
import {
  SESSION_COOKIE,
  parseCookies,
  serializeCookie,
  verifySessionToken,
} from "../../server/auth/session.js";

/** Express Request/Response 중 라우터가 실제로 건드리는 부분만 흉내낸다. */
function shim(req: Request, cookies: string[]) {
  const url = new URL(req.url);
  const forwardedFor = req.headers.get("x-forwarded-for");
  const request = {
    ip: forwardedFor?.split(",")[0]?.trim() ?? null,
    protocol: url.protocol.replace(":", ""),
    hostname: url.hostname,
    headers: Object.fromEntries(req.headers.entries()),
  } as unknown as TrpcContext["req"];

  const response = {
    clearCookie: (name: string) => {
      cookies.push(
        serializeCookie(name, "", {
          maxAge: 0,
          secure: url.protocol === "https:",
        })
      );
    },
    cookie: (name: string, value: string) => {
      cookies.push(
        serializeCookie(name, value, { secure: url.protocol === "https:" })
      );
    },
  } as unknown as TrpcContext["res"];

  return { request, response };
}

async function sessionUser(req: Request): Promise<User | null> {
  const token = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE];
  if (!token) return null;
  const session = await verifySessionToken(token);
  if (!session) return null;
  // 세션이 곧 사용자다 — 별도 사용자 테이블 조회 없이 역할은 이메일로 해석한다 (§13.1)
  return {
    id: 0,
    openId: session.sub,
    name: session.name,
    email: session.email,
    loginMethod: "google",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  } as User;
}

async function handler(req: Request): Promise<Response> {
  const cookies: string[] = [];
  const { request, response } = shim(req, cookies);
  const user = await sessionUser(req);

  const result = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => ({ req: request, res: response, user }),
  });

  if (cookies.length === 0) return result;
  const headers = new Headers(result.headers);
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(result.body, { status: result.status, headers });
}

/*
 * Vercel 서버리스 런타임은 이 파일을 정적으로 훑어 어떤 HTTP 메서드를 다루는지 정한다.
 * `export { handler as GET }` 같은 별칭 재export 는 그 탐지에 잡히지 않아
 * FUNCTION_INVOCATION_FAILED 로 죽는다 — 그래서 메서드마다 선언형으로 내보낸다.
 */
export async function GET(req: Request): Promise<Response> {
  return handler(req);
}

export async function POST(req: Request): Promise<Response> {
  return handler(req);
}
