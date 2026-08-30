/**
 * 비밀번호 로그인 — 임시 경로지만 잘못 열리면 급여·부채가 통째로 새므로,
 * "닫힌 것이 기본"인지를 회귀 테스트로 고정한다.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS,
  MIN_PASSWORD_LENGTH,
  passwordLoginConfigured,
  resetAttempts,
  verifyPasswordLogin,
} from "./password";

const GOOD = "dino-2026-management!";

function env(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  resetAttempts();
  env({
    ERP_PASSWORD: GOOD,
    ERP_PASSWORDS: undefined,
    ERP_ALLOWED_DOMAIN: "dinostudio.kr",
    ERP_ALLOWED_EMAILS: undefined,
  });
});

afterEach(() => {
  resetAttempts();
  env({
    ERP_PASSWORD: undefined,
    ERP_PASSWORDS: undefined,
    ERP_ALLOWED_DOMAIN: undefined,
    ERP_ALLOWED_EMAILS: undefined,
  });
});

describe("비밀번호 로그인", () => {
  it("설정되지 않았으면 꺼져 있다", () => {
    env({ ERP_PASSWORD: undefined });
    expect(passwordLoginConfigured()).toBe(false);
  });

  it("허용 도메인 이메일 + 맞는 비밀번호면 통과한다", async () => {
    const result = await verifyPasswordLogin("jaybe@dinostudio.kr", GOOD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.identity.email).toBe("jaybe@dinostudio.kr");
    // 구글 sub 와 섞이지 않아야 감사로그에서 로그인 경로가 구분된다
    expect(result.identity.sub).toBe("pw:jaybe@dinostudio.kr");
  });

  it("이메일 대소문자·공백은 정규화한다", async () => {
    const result = await verifyPasswordLogin("  JayBe@DinoStudio.KR ", GOOD);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.identity.email).toBe("jaybe@dinostudio.kr");
  });

  it("비밀번호가 틀리면 401", async () => {
    const result = await verifyPasswordLogin(
      "jaybe@dinostudio.kr",
      "틀린값입니다아아아"
    );
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it("허용 도메인 밖 이메일은 비밀번호가 맞아도 막힌다", async () => {
    const result = await verifyPasswordLogin("outsider@gmail.com", GOOD);
    expect(result.ok).toBe(false);
    // 실패 사유가 "그 이메일은 없다"와 구분되면 안 된다 — 계정 존재 여부가 새어 나간다
    if (!result.ok)
      expect(result.reason).toBe("이메일 또는 비밀번호가 맞지 않습니다.");
  });

  it("허용 도메인·계정이 아예 없으면 아무도 못 들어온다", async () => {
    env({ ERP_ALLOWED_DOMAIN: undefined, ERP_ALLOWED_EMAILS: undefined });
    const result = await verifyPasswordLogin("jaybe@dinostudio.kr", GOOD);
    expect(result).toMatchObject({ ok: false, status: 500 });
  });

  it("ERP_ALLOWED_EMAILS 로 개별 지정한 계정도 들어온다", async () => {
    env({
      ERP_ALLOWED_DOMAIN: undefined,
      ERP_ALLOWED_EMAILS: "tax@partner.co.kr",
    });
    const result = await verifyPasswordLogin("tax@partner.co.kr", GOOD);
    expect(result.ok).toBe(true);
  });

  it(`비밀번호가 ${MIN_PASSWORD_LENGTH}자 미만이면 로그인 자체를 켜지 않는다`, async () => {
    env({ ERP_PASSWORD: "짧음" });
    const result = await verifyPasswordLogin("jaybe@dinostudio.kr", "짧음");
    expect(result).toMatchObject({ ok: false, status: 500 });
  });

  it("사람별 비밀번호가 공용 비밀번호보다 우선한다", async () => {
    env({
      ERP_PASSWORDS: JSON.stringify({
        "cfo@dinostudio.kr": "cfo-only-password",
      }),
    });
    await expect(
      verifyPasswordLogin("cfo@dinostudio.kr", "cfo-only-password")
    ).resolves.toMatchObject({ ok: true });
    // 사람별 값이 지정된 계정은 공용 비밀번호로 들어올 수 없다
    await expect(
      verifyPasswordLogin("cfo@dinostudio.kr", GOOD)
    ).resolves.toMatchObject({ ok: false, status: 401 });
    // 지정되지 않은 계정은 공용 비밀번호를 그대로 쓴다
    await expect(
      verifyPasswordLogin("jaybe@dinostudio.kr", GOOD)
    ).resolves.toMatchObject({ ok: true });
  });

  it("빈 비밀번호로는 통과할 수 없다", async () => {
    await expect(
      verifyPasswordLogin("jaybe@dinostudio.kr", "")
    ).resolves.toMatchObject({ ok: false, status: 400 });
  });

  it(`연속 ${MAX_ATTEMPTS}회 실패하면 잠긴다`, async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i += 1)
      await verifyPasswordLogin("jaybe@dinostudio.kr", "wrong-password-here");
    const locked = await verifyPasswordLogin("jaybe@dinostudio.kr", GOOD);
    expect(locked).toMatchObject({ ok: false, status: 429 });
  });

  it("잠금 시간이 지나면 다시 시도할 수 있다", async () => {
    const now = Date.now();
    for (let i = 0; i < MAX_ATTEMPTS; i += 1)
      await verifyPasswordLogin(
        "jaybe@dinostudio.kr",
        "wrong-password-here",
        now
      );
    const later = now + 11 * 60 * 1000;
    await expect(
      verifyPasswordLogin("jaybe@dinostudio.kr", GOOD, later)
    ).resolves.toMatchObject({ ok: true });
  });

  it("성공하면 실패 카운터가 초기화된다", async () => {
    for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1)
      await verifyPasswordLogin("jaybe@dinostudio.kr", "wrong-password-here");
    await verifyPasswordLogin("jaybe@dinostudio.kr", GOOD);
    for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1)
      await verifyPasswordLogin("jaybe@dinostudio.kr", "wrong-password-here");
    // 카운터가 남아 있었다면 여기서 429가 났을 것이다
    await expect(
      verifyPasswordLogin("jaybe@dinostudio.kr", GOOD)
    ).resolves.toMatchObject({ ok: true });
  });
});
