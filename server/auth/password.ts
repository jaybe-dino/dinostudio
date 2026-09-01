/**
 * 비밀번호 로그인 — 구글 워크스페이스 SSO를 붙이기 전에 쓰는 임시 경로.
 *
 * 구글 SSO와 같은 세션 쿠키를 발급하므로 권한(§13.1)·감사로그(§11.1)는 그대로 돌아간다.
 * 다만 "누가 승인했는가"가 남으려면 사람이 구분되어야 하므로, 비밀번호만으로는 들어올 수
 * 없고 이메일을 함께 받는다. 이메일이 신원이고, 비밀번호는 문을 여는 열쇠다.
 *
 * 보안상 SSO보다 약하다는 점을 분명히 해 둔다 —
 *   · 공용 비밀번호는 퇴사자에게서 회수할 방법이 비밀번호 교체뿐이다
 *   · 2단계 인증이 없다
 *   · 서버리스라 시도 횟수 제한이 인스턴스별로만 걸린다 (아래 주석 참고)
 * 그래서 이것은 구글 SSO가 붙기 전까지의 임시 수단이고, docs/erp-deploy.md 에 회수 절차를 적어 둔다.
 */
import { isAllowedIdentity, type SessionPayload } from "./session.js";

/** 너무 짧은 비밀번호는 아예 켜지지 않게 한다 — 약한 값이 기본이 되면 안 된다 */
export const MIN_PASSWORD_LENGTH = 10;
/** 한 이메일당 연속 실패 허용 횟수 */
export const MAX_ATTEMPTS = 8;
/** 잠금 시간 */
export const LOCKOUT_MS = 10 * 60 * 1000;

export type PasswordLoginResult =
  | { ok: true; identity: SessionPayload }
  | { ok: false; status: number; reason: string };

function sharedPassword(): string | null {
  const value = (process.env.ERP_PASSWORD ?? "").trim();
  return value ? value : null;
}

/** 사람마다 다른 비밀번호를 주고 싶을 때 — {"a@b.kr":"..."} 형태. 공용 비밀번호보다 우선한다. */
function perUserPassword(email: string): string | null {
  const raw = process.env.ERP_PASSWORDS;
  if (!raw) return null;
  try {
    const map = JSON.parse(raw) as Record<string, string>;
    const found = map[email] ?? map[email.toLowerCase()];
    return typeof found === "string" && found.trim() ? found.trim() : null;
  } catch {
    // 값을 로그에 남기지 않는다 — 파싱에 실패해도 비밀번호가 콘솔에 찍히면 안 된다
    console.warn("[auth] ERP_PASSWORDS 파싱 실패 — 공용 비밀번호로 넘어갑니다");
    return null;
  }
}

export function passwordLoginConfigured(): boolean {
  return Boolean(sharedPassword() ?? process.env.ERP_PASSWORDS);
}

/**
 * 길이가 달라도 시간이 새지 않도록 양쪽을 SHA-256 으로 눌러서 비교한다.
 * (Node 의 timingSafeEqual 은 길이가 같아야 해서 길이 자체가 새어 나간다)
 */
async function constantTimeEquals(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const x = new Uint8Array(left);
  const y = new Uint8Array(right);
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}

/**
 * 시도 횟수 제한. 서버리스에서는 인스턴스마다 따로 세므로 완전하지 않다 —
 * 무차별 대입을 "느리게" 만들 뿐 막지는 못한다. 그래서 비밀번호 길이 하한(위)이 실제 방어선이고,
 * 이 카운터는 실수로 반복 입력하는 경우를 잡는 용도다.
 */
const attempts = new Map<string, { count: number; until: number }>();

export function attemptState(email: string, now = Date.now()) {
  const record = attempts.get(email);
  if (!record) return null;
  if (record.until <= now) {
    attempts.delete(email);
    return null;
  }
  return record;
}

function recordFailure(email: string, now = Date.now()) {
  const record = attemptState(email, now) ?? { count: 0, until: 0 };
  record.count += 1;
  record.until = now + LOCKOUT_MS;
  attempts.set(email, record);
}

export function resetAttempts(email?: string) {
  if (email) attempts.delete(email);
  else attempts.clear();
}

function displayName(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.replace(/[._-]+/g, " ").trim() || email;
}

export async function verifyPasswordLogin(
  rawEmail: unknown,
  rawPassword: unknown,
  now = Date.now()
): Promise<PasswordLoginResult> {
  if (!passwordLoginConfigured())
    return {
      ok: false,
      status: 500,
      reason: "비밀번호 로그인이 설정되지 않았습니다 (ERP_PASSWORD)",
    };

  const email =
    typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  const password = typeof rawPassword === "string" ? rawPassword : "";
  if (!email || !password)
    return {
      ok: false,
      status: 400,
      reason: "이메일과 비밀번호를 입력하십시오.",
    };

  const locked = attemptState(email, now);
  if (locked && locked.count >= MAX_ATTEMPTS)
    return {
      ok: false,
      status: 429,
      reason: `로그인 시도가 너무 많습니다. ${Math.ceil((locked.until - now) / 60000)}분 뒤에 다시 시도하십시오.`,
    };

  const expected = perUserPassword(email) ?? sharedPassword();
  if (expected && expected.length < MIN_PASSWORD_LENGTH)
    return {
      ok: false,
      status: 500,
      reason: `비밀번호가 너무 짧게 설정되어 로그인을 켤 수 없습니다 (${MIN_PASSWORD_LENGTH}자 이상).`,
    };

  // 허용 계정인지와 비밀번호가 맞는지를 하나의 실패 메시지로 합친다 —
  // "이 이메일은 있다"는 정보를 밖에서 알아낼 수 있으면 안 된다.
  const allowed = isAllowedIdentity(email, null);
  const matches = expected
    ? await constantTimeEquals(password, expected)
    : false;

  if (!allowed.ok || !matches) {
    recordFailure(email, now);
    // 허용 도메인 자체가 설정되지 않은 것은 사용자가 고칠 수 없는 설정 오류라 그대로 알린다
    if (!process.env.ERP_ALLOWED_DOMAIN && !process.env.ERP_ALLOWED_EMAILS)
      return {
        ok: false,
        status: 500,
        reason: "허용 도메인·계정이 설정되지 않았습니다 (ERP_ALLOWED_DOMAIN)",
      };
    return {
      ok: false,
      status: 401,
      reason: "이메일 또는 비밀번호가 맞지 않습니다.",
    };
  }

  resetAttempts(email);
  return {
    ok: true,
    identity: {
      // 구글 sub 와 섞이지 않도록 접두어를 붙인다 — 나중에 SSO 로 옮겨도 감사로그에서 구분된다
      sub: `pw:${email}`,
      email,
      name: displayName(email),
      hd: null,
      picture: null,
      // 로그인 자체가 재인증이다 — 이 시각부터 15분간 민감 조회가 열린다 (D7)
      stepUpAt: Math.floor(now / 1000),
    },
  };
}
