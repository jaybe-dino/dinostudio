/**
 * 구글 워크스페이스 SSO (OpenID Connect) — 추가 의존성 없이 표준 엔드포인트만 쓴다.
 * 승인·감사로그가 사람 신원에 묶여야 하므로 익명 접근은 어디에도 허용하지 않는다.
 */
import { createRemoteJWKSet, jwtVerify } from "jose";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function keySet() {
  if (!jwks)
    jwks = createRemoteJWKSet(
      new URL("https://www.googleapis.com/oauth2/v3/certs")
    );
  return jwks;
}

export function googleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  );
}

export function authorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    // 워크스페이스 도메인이 지정돼 있으면 계정 선택기에서 미리 좁혀 준다
    ...(process.env.ERP_ALLOWED_DOMAIN
      ? { hd: process.env.ERP_ALLOWED_DOMAIN }
      : {}),
    prompt: "select_account",
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
  hd: string | null;
  picture: string | null;
}

export async function exchangeCode(
  code: string,
  redirectUri: string
): Promise<GoogleIdentity> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    throw new Error(`구글 토큰 교환 실패 (${response.status})`);
  }
  const tokens = (await response.json()) as { id_token?: string };
  if (!tokens.id_token) throw new Error("구글 응답에 id_token이 없습니다");

  const { payload } = await jwtVerify(tokens.id_token, keySet(), {
    issuer: ISSUERS,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  if (payload.email_verified === false)
    throw new Error("이메일이 확인되지 않은 구글 계정입니다");
  const email = typeof payload.email === "string" ? payload.email : null;
  if (!email) throw new Error("구글 응답에 이메일이 없습니다");

  return {
    sub: String(payload.sub),
    email,
    name: typeof payload.name === "string" ? payload.name : email,
    hd: typeof payload.hd === "string" ? payload.hd : null,
    picture: typeof payload.picture === "string" ? payload.picture : null,
  };
}

/** 배포 주소를 요청에서 도출한다 — 미리보기 배포마다 리다이렉트 URI가 달라지기 때문 */
export function redirectUriFrom(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/auth/google/callback`;
}
