/**
 * 로컬 개발 서버(Express)에도 Vercel과 같은 구글 SSO 경로를 붙인다 —
 * 배포와 로컬의 로그인 동작이 달라지면 권한 버그를 로컬에서 잡을 수 없다.
 */
import type { Express, Request, Response } from "express";
import {
  authorizeUrl,
  exchangeCode,
  googleConfigured,
  redirectUriFrom,
} from "./google";
import { passwordLoginConfigured, verifyPasswordLogin } from "./password";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  STATE_COOKIE,
  createSessionToken,
  isAllowedIdentity,
  serializeCookie,
} from "./session";

function originOf(req: Request): string {
  const proto =
    (req.headers["x-forwarded-proto"] as string)?.split(",")[0] ?? req.protocol;
  return `${proto}://${req.headers.host}`;
}

export function registerGoogleAuthRoutes(app: Express) {
  app.get("/api/auth/methods", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      google: googleConfigured(),
      password: passwordLoginConfigured(),
    });
  });

  // 구글 SSO를 붙이기 전까지 쓰는 임시 경로 — 발급하는 쿠키는 SSO와 완전히 같다
  app.post("/api/auth/password", async (req: Request, res: Response) => {
    const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
    if (!contentType.includes("application/json")) {
      res.status(415).json({ ok: false, reason: "잘못된 요청입니다." });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await verifyPasswordLogin(body.email, body.password);
    res.setHeader("Cache-Control", "no-store");
    if (!result.ok) {
      res.status(result.status).json({ ok: false, reason: result.reason });
      return;
    }
    const secure = originOf(req).startsWith("https");
    const token = await createSessionToken(result.identity);
    const next = typeof body.next === "string" ? body.next : "/";
    const safeNext =
      next.startsWith("/") && !next.startsWith("//") ? next : "/";
    res.setHeader(
      "Set-Cookie",
      serializeCookie(SESSION_COOKIE, token, {
        maxAge: SESSION_MAX_AGE_SECONDS,
        secure,
      })
    );
    res.json({ ok: true, next: safeNext });
  });

  app.get("/api/auth/google/start", (req: Request, res: Response) => {
    if (!googleConfigured()) {
      res
        .status(500)
        .send(
          "구글 SSO가 설정되지 않았습니다 (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)"
        );
      return;
    }
    const origin = originOf(req);
    const next = typeof req.query.next === "string" ? req.query.next : "/erp";
    const state = `${crypto.randomUUID()}|${next}`;
    const secure = origin.startsWith("https");
    res.setHeader(
      "Set-Cookie",
      serializeCookie(STATE_COOKIE, state, { maxAge: 600, secure })
    );
    res.redirect(302, authorizeUrl(redirectUriFrom(origin), state));
  });

  app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
    const origin = originOf(req);
    const secure = origin.startsWith("https");
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;
    const cookieState = /(?:^|;\s*)ds_oauth_state=([^;]+)/.exec(
      req.headers.cookie ?? ""
    )?.[1];

    if (!code || !state) {
      res.status(400).send("잘못된 콜백 요청입니다.");
      return;
    }
    if (!cookieState || decodeURIComponent(cookieState) !== state) {
      res.status(400).send("로그인 요청이 만료되었거나 위조되었습니다.");
      return;
    }

    try {
      const identity = await exchangeCode(code, redirectUriFrom(origin));
      const allowed = isAllowedIdentity(identity.email, identity.hd);
      if (!allowed.ok) {
        res.status(403).send(allowed.reason ?? "허용된 계정이 아닙니다.");
        return;
      }
      const token = await createSessionToken(identity);
      const next = state.split("|").slice(1).join("|") || "/erp";
      const safeNext =
        next.startsWith("/") && !next.startsWith("//") ? next : "/erp";
      res.setHeader("Set-Cookie", [
        serializeCookie(SESSION_COOKIE, token, {
          maxAge: SESSION_MAX_AGE_SECONDS,
          secure,
        }),
        serializeCookie(STATE_COOKIE, "", { maxAge: 0, secure }),
      ]);
      res.redirect(302, safeNext);
    } catch (error) {
      res
        .status(400)
        .send(
          error instanceof Error ? error.message : "구글 인증에 실패했습니다."
        );
    }
  });

  app.all("/api/auth/logout", (req: Request, res: Response) => {
    const secure = originOf(req).startsWith("https");
    res.setHeader(
      "Set-Cookie",
      serializeCookie(SESSION_COOKIE, "", { maxAge: 0, secure })
    );
    res.redirect(302, "/");
  });
}
