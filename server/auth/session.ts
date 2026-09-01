/**
 * 세션 — 구글 워크스페이스 SSO로 로그인한 사용자를 서명된 쿠키 하나로 들고 다닌다.
 *
 * 경영관리 시스템은 급여·부채를 다루므로 외부 공개가 없어야 하고(§14),
 * 누가 언제 승인했는지가 감사로그에 남아야 하므로(§11.1) 신원이 반드시 필요하다.
 */
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "ds_session";
export const STATE_COOKIE = "ds_oauth_state";
/** 세션 수명 — 10명 내외 내부 사용이라 짧게 잡고 재로그인이 싸다 */
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
/**
 * 민감 조회의 재인증 유효 시간 (docs/erp-qa.md D7).
 *
 * 세션 12시간은 「오늘 하루 일한다」에 맞춘 값이다. 급여 원장이나 세무 제출
 * 파일은 그보다 짧아야 한다 — 자리를 비운 노트북에서 열리면 안 된다.
 * 그래서 세션과 별도로 「방금 비밀번호를 다시 넣었는가」를 본다.
 */
export const STEP_UP_MAX_AGE_SECONDS = 15 * 60;

export interface SessionPayload {
  /** 구글 sub — 이메일이 바뀌어도 사람은 같다 */
  sub: string;
  email: string;
  name: string;
  /** 구글 워크스페이스 도메인 (hd 클레임) */
  hd: string | null;
  picture: string | null;
  /**
   * 마지막 재인증 시각 (초 단위 epoch). 민감 조회는 이 값이 신선할 때만 열린다 (D7).
   * 로그인 자체도 재인증이므로 로그인 시점에 채워진다.
   */
  stepUpAt?: number | null;
}

/** 재인증이 아직 유효한가 (D7) */
export function stepUpFresh(
  payload: Pick<SessionPayload, "stepUpAt"> | null | undefined,
  nowSeconds = Math.floor(Date.now() / 1000)
): boolean {
  const at = payload?.stepUpAt;
  if (at == null) return false;
  return nowSeconds - at <= STEP_UP_MAX_AGE_SECONDS;
}

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET ?? process.env.JWT_SECRET;
  if (!value) {
    throw new Error(
      "SESSION_SECRET이 설정되지 않았습니다 — 세션을 서명할 수 없습니다"
    );
  }
  return new TextEncoder().encode(value);
}

export function hasSessionSecret(): boolean {
  return Boolean(process.env.SESSION_SECRET ?? process.env.JWT_SECRET);
}

export async function createSessionToken(
  payload: SessionPayload
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .setSubject(payload.sub)
    .sign(secret());
}

export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.email !== "string" || typeof payload.sub !== "string")
      return null;
    return {
      sub: payload.sub,
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : payload.email,
      hd: typeof payload.hd === "string" ? payload.hd : null,
      picture: typeof payload.picture === "string" ? payload.picture : null,
      stepUpAt: typeof payload.stepUpAt === "number" ? payload.stepUpAt : null,
    };
  } catch {
    return null;
  }
}

export function parseCookies(
  header: string | null | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function serializeCookie(
  name: string,
  value: string,
  options: {
    maxAge?: number;
    secure?: boolean;
    sameSite?: "Lax" | "Strict" | "None";
  } = {}
): string {
  // 기본을 Lax 로 두는 이유는 STATE_COOKIE 때문이다 — 구글에서 돌아오는
  // 교차 사이트 이동에서 살아남아야 한다. 세션 쿠키는 호출부에서 Strict 를 준다.
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly"];
  parts.push(`SameSite=${options.sameSite ?? "Lax"}`);
  if (options.secure !== false) parts.push("Secure");
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join("; ");
}

/**
 * 이 이메일이 들어와도 되는가.
 * ERP_ALLOWED_DOMAIN(구글 워크스페이스 도메인)과 ERP_ALLOWED_EMAILS 둘 다 비어 있으면
 * 아무도 들어올 수 없다 — 열어두는 것이 기본값이면 안 되기 때문이다.
 */
export function isAllowedIdentity(
  email: string,
  hd: string | null
): { ok: boolean; reason?: string } {
  const domain = (process.env.ERP_ALLOWED_DOMAIN ?? "").trim().toLowerCase();
  const emails = (process.env.ERP_ALLOWED_EMAILS ?? "")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);

  if (!domain && emails.length === 0) {
    return {
      ok: false,
      reason: "허용 도메인·계정이 설정되지 않았습니다 (ERP_ALLOWED_DOMAIN)",
    };
  }
  const normalized = email.trim().toLowerCase();
  if (emails.includes(normalized)) return { ok: true };
  if (domain) {
    const emailDomain = normalized.split("@")[1] ?? "";
    // hd 클레임이 있으면 그것도 함께 본다 — 개인 지메일로 회사 주소를 흉내낼 수 없게
    if (emailDomain === domain && (hd == null || hd.toLowerCase() === domain))
      return { ok: true };
  }
  return { ok: false, reason: `${email} 은(는) 허용된 계정이 아닙니다` };
}
