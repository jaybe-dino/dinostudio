/**
 * Vercel 서버리스 함수의 export 형태를 고정한다.
 *
 * 배경 — `export { handler as GET }` 로 내보낸 함수들이 배포에서 전부
 * FUNCTION_INVOCATION_FAILED 로 죽었다. 런타임이 파일을 정적으로 훑어 메서드를 찾는데
 * 별칭 재export 는 그 탐지에 잡히지 않는다. 로컬 Express 와 번들 테스트는 모두 통과하므로
 * 이 실수는 배포해 봐야만 드러난다 — 그래서 소스 형태 자체를 테스트로 묶는다.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const API_DIR = join(import.meta.dirname, "..", "api");

function apiFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return apiFiles(full);
    return name.endsWith(".ts") ? [full] : [];
  });
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

describe("Vercel 함수 export 형태", () => {
  const files = apiFiles(API_DIR);

  it("api 디렉터리에서 함수 파일을 찾는다", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map(f => [f.slice(f.indexOf("/api/") + 1), f] as const))(
    "%s — 메서드를 선언형으로 내보낸다",
    (_label, file) => {
      // 주석은 걷어낸다 — 이 규칙을 설명하는 주석이 스스로에게 걸리면 안 된다
      const source = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");

      // 별칭 재export 는 배포에서 탐지되지 않는다
      const aliased = new RegExp(
        `export\\s*\\{[^}]*\\bas\\s+(${METHODS.join("|")})\\b`
      );
      expect(source).not.toMatch(aliased);

      // 그리고 최소 하나는 실제로 선언되어 있어야 한다
      const declared = new RegExp(
        `export\\s+(async\\s+)?function\\s+(${METHODS.join("|")})\\b`
      );
      expect(source).toMatch(declared);
    }
  );
});
