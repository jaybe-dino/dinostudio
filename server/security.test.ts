/**
 * 보안 회귀 — 한 번 조인 것이 조용히 풀리지 않게 고정한다.
 *
 * 여기 있는 것들은 전부 「없어도 화면은 잘 돌아가는」 종류다.
 * 그래서 리팩터링 중에 소리 없이 사라진다 — 테스트가 유일한 방어선이다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { serializeCookie } from "./auth/session.js";

const REPO = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");

describe("세션 쿠키", () => {
  it("HttpOnly · Secure 가 기본이다", () => {
    const cookie = serializeCookie("ds_session", "x", { maxAge: 60 });
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
  });

  it("세션을 발급하는 모든 경로가 SameSite=Strict 를 준다", () => {
    // Lax 면 다른 사이트에서 시작된 이동에도 세션이 실려 나간다
    for (const path of [
      "api/auth/password.ts",
      "api/auth/google/callback.ts",
      "server/auth/routes.ts",
    ]) {
      const src = read(path);
      const sessionCookies = src.split("serializeCookie(SESSION_COOKIE, token");
      // 첫 조각은 호출 이전이므로 제외한다
      for (const chunk of sessionCookies.slice(1)) {
        const call = chunk.slice(0, 260);
        expect(call, `${path} 의 세션 쿠키`).toContain('sameSite: "Strict"');
      }
    }
  });

  it("OAuth state 쿠키는 Strict 가 아니어야 한다", () => {
    // 구글에서 돌아오는 교차 사이트 이동에서 살아남아야 한다.
    // 여기까지 Strict 로 바꾸면 로그인이 조용히 깨진다.
    const src =
      read("api/auth/google/start.ts") + read("server/auth/routes.ts");
    const stateCalls = src.split("serializeCookie(STATE_COOKIE, state");
    for (const chunk of stateCalls.slice(1))
      expect(chunk.slice(0, 200)).not.toContain('sameSite: "Strict"');
  });
});

describe("진단 엔드포인트", () => {
  it("인증 없이 열리지 않는다", () => {
    // 응답이 서버 모듈 구성과 어떤 비밀이 설정됐는지를 알려 준다 — 공격자에게는 지도다
    const src = read("api/diag.ts");
    expect(src).toContain("verifySessionToken");
    expect(src).toContain("status: 401");
  });

  it("환경변수 값을 절대 내보내지 않는다", () => {
    const src = read("api/diag.ts");
    // Boolean() 으로 감싸 유무만 본다
    expect(src).toContain("Boolean(process.env[key])");
    // 값을 그대로 넣는 패턴이 없어야 한다
    expect(src).not.toMatch(/env\[key\]\s*[,;}]/);
  });
});

describe("배포 헤더", () => {
  const cfg = JSON.parse(read("vercel.json")) as {
    headers: {
      source: string;
      has?: unknown;
      headers: { key: string; value: string }[];
    }[];
  };
  const keysFor = (predicate: (h: (typeof cfg.headers)[number]) => boolean) =>
    cfg.headers
      .filter(predicate)
      .flatMap(h => h.headers.map(kv => [kv.key, kv.value] as const));

  it("전 경로에 HSTS · nosniff 가 붙는다", () => {
    const all = new Map(keysFor(h => h.source === "/(.*)" && !h.has));
    expect(all.get("Strict-Transport-Security")).toContain("max-age=");
    expect(all.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("경영관리 시스템은 색인 · 프레임 · 캐시를 막는다", () => {
    for (const h of cfg.headers.filter(x => x.has || x.source === "/erp")) {
      const map = new Map(h.headers.map(kv => [kv.key, kv.value]));
      expect(map.get("X-Robots-Tag"), h.source).toContain("noindex");
      expect(map.get("X-Frame-Options"), h.source).toBe("DENY");
      expect(map.get("Cache-Control"), h.source).toContain("no-store");
      expect(map.get("Content-Security-Policy"), h.source).toContain(
        "frame-ancestors 'none'"
      );
    }
  });

  it("CSP 가 인라인 스크립트와 외부 스크립트를 막는다", () => {
    const csp = keysFor(h => Boolean(h.has)).find(
      ([k]) => k === "Content-Security-Policy"
    )?.[1];
    expect(csp).toBeDefined();
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("object-src 'none'");
  });
});

describe("로그인 화면", () => {
  it("인증 전에는 화면 목록을 그리지 않는다", () => {
    // 레일에 36개 화면 이름이 있고 거기에 급여·부채·재무제표가 들어 있다
    const src = read("client/src/pages/erp/ErpApp.tsx");
    expect(src).toContain("const authed = Boolean(me.data?.role)");
    // 레일이 authed 분기 안에 있어야 한다
    const railAt = src.indexOf('<aside className="rail">');
    const gateAt = src.indexOf("{authed ? (");
    expect(gateAt).toBeGreaterThan(0);
    expect(railAt).toBeGreaterThan(gateAt);
  });
});

describe("검색엔진 차단", () => {
  it("robots.txt 가 경영관리 경로를 막는다", () => {
    const txt = read("client/public/robots.txt");
    expect(txt).toContain("Disallow: /erp");
    expect(txt).toContain("Disallow: /api/");
  });
});
