/**
 * QA-005 재오픈 — **껍데기도 막는지 본다.**
 *
 * 검사는 `runRestoreChecks` 안에 있지만, 사람이 실제로 치는 것은 CLI 다.
 * 인자 파싱이 빈 값을 「안 줬다」로 바꿔 버리면 안쪽 검사에 닿지도 않는다.
 * 그래서 **진짜로 실행해서** 끝값을 본다.
 *
 * DB 에는 붙지 않는다 — 인자 검사는 연결보다 먼저 일어난다.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CLI = join(
  import.meta.dirname,
  "..",
  "..",
  "scripts",
  "verify-restore.mjs"
);

function run(args: string[], env: Record<string, string> = {}) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: "", RESTORE_DATABASE_URL: "", ...env },
  });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

const URL = "postgres://user:pw@example.invalid/restore";

describe("verify-restore CLI — 인자", () => {
  it("연결 문자열이 없으면 2", () => {
    const r = run([]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("연결 문자열");
  });

  it("**운영과 같으면 2** — 운영을 확인하고 「복구됩니다」가 가장 위험하다", () => {
    const r = run([URL], { DATABASE_URL: URL });
    expect(r.code).toBe(2);
    expect(r.out).toContain("운영 DATABASE_URL");
  });

  it("**날짜가 아닌 기준시각은 2** — 연결하기 전에 막는다", () => {
    const r = run([URL, "--as-of=not-a-date"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("날짜로 읽을 수 없습니다");
  });

  it("**빈 값은 「안 줬다」가 아니라 2다**", () => {
    expect(run([URL, "--entries="]).code).toBe(2);
    expect(run([URL, "--as-of="]).code).toBe(2);
    expect(run([URL, "--settled-total="]).code).toBe(2);
  });

  it("음수·소수는 2이고, 틀린 것을 **전부** 알려 준다", () => {
    const r = run([URL, "--entries=-3", "--settled-total=1.5"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("0 보다 작습니다");
    expect(r.out).toContain("소수를 쓸 수 없습니다");
  });

  it("미래 기준시각은 2 — 연도 오타를 통과시키지 않는다", () => {
    const r = run([URL, "--as-of=2126-09-20T00:00:00Z"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("미래");
  });

  it("환경변수로 준 기준값도 같은 검사를 받는다", () => {
    const r = run([URL], { RESTORE_EXPECT_AS_OF: "nope" });
    expect(r.code).toBe(2);
    expect(r.out).toContain("날짜로 읽을 수 없습니다");
  });

  it("쓸 수 있는 기준값이면 **인자 단계를 지나 연결까지 간다**", () => {
    // 여기서는 붙을 DB 가 없으므로 연결 실패(1)로 끝난다.
    // 중요한 것은 **2 가 아니라는 것** — 인자 검사를 통과했다는 뜻이다.
    const r = run([
      URL,
      "--as-of=2026-09-20T09:00:00+09:00",
      "--entries=61",
      "--settled-total=12,345,678",
    ]);
    expect(r.code).not.toBe(2);
    expect(r.out).toContain("복구 리허설 검증");
  }, 30_000);
});
