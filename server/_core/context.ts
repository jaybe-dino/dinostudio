import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema.js";
import {
  SESSION_COOKIE,
  parseCookies,
  stepUpFresh,
  verifySessionToken,
} from "../auth/session.js";
import { sdk } from "./sdk.js";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  /**
   * 방금 비밀번호를 다시 넣었는가 (docs/erp-qa.md D7).
   * 급여 원장·세무 제출 파일은 세션 12시간이 아니라 이 값으로 열린다.
   */
  stepUpFresh?: boolean;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let fresh = false;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  // 구글 워크스페이스 SSO 세션 — 경영관리 시스템이 쓰는 경로.
  if (!user) {
    const token = parseCookies(opts.req.headers.cookie)[SESSION_COOKIE];
    const session = token ? await verifySessionToken(token) : null;
    if (session) {
      fresh = stepUpFresh(session);
      user = {
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
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    stepUpFresh: fresh,
  };
}
