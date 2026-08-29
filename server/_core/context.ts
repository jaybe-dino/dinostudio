import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import {
  SESSION_COOKIE,
  parseCookies,
  verifySessionToken,
} from "../auth/session";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

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
  };
}
