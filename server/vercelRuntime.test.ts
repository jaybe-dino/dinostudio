/**
 * 배포 런타임 재현 — 번들 없이 Node ESM 으로 서버 함수가 뜨는지 본다.
 *
 * 배경: 배포된 함수가 전부 FUNCTION_INVOCATION_FAILED 로 죽었는데 로컬은 멀쩡했다.
 * 로컬 개발 서버(vite·tsx)와 esbuild 번들은 확장자 없는 import 와 폴더 import 를
 * 알아서 풀어주지만, Vercel 은 파일별로 트랜스파일만 해서 Node ESM 으로 실행한다.
 * Node ESM 은 둘 다 지원하지 않으므로 모듈 로드 단계에서 죽는다.
 *
 * 그래서 "타입이 맞는가"가 아니라 "그 환경에서 뜨는가"를 본다.
 * 로드는 진짜 Node 자식 프로세스에서 한다 — vitest 의 모듈 로더를 거치면
 * 그 로더가 경로를 대신 풀어주어 재현이 깨진다.
 */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "..");
// 레포 안에 둔다 — Node 가 상위로 올라가며 node_modules 를 찾아야 한다
const OUT = join(REPO, ".tmp-esm-check");

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [full] : [];
  });
}

interface LoadResult {
  file: string;
  handlers?: string[];
  error?: string;
}

let results: LoadResult[] = [];

beforeAll(() => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  // --bundle 을 주지 않는다. 파일별 트랜스파일만 — Vercel 과 같은 방식
  execFileSync(
    "npx",
    [
      "esbuild",
      ...["api", "server", "shared", "drizzle"].flatMap(d =>
        tsFiles(join(REPO, d))
      ),
      `--outbase=${REPO}`,
      `--outdir=${OUT}`,
      "--format=esm",
      "--platform=node",
      "--log-level=error",
    ],
    { cwd: REPO, stdio: "pipe" }
  );
  writeFileSync(join(OUT, "package.json"), '{"type":"module"}\n');

  const apiFiles = tsFiles(join(REPO, "api")).map(src =>
    src.slice(REPO.length + 1)
  );
  writeFileSync(
    join(OUT, "probe.mjs"),
    `import { pathToFileURL } from "node:url";
const files = ${JSON.stringify(apiFiles)};
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const out = [];
for (const file of files) {
  const js = file.replace(/\\.ts$/, ".js");
  try {
    const mod = await import(pathToFileURL(new URL(js, import.meta.url).pathname).href);
    out.push({ file, handlers: METHODS.filter(m => typeof mod[m] === "function") });
  } catch (error) {
    out.push({ file, error: (error.code ?? error.name) + ": " + String(error.message).split("\\n")[0] });
  }
}
process.stdout.write(JSON.stringify(out));
`
  );

  const raw = execFileSync("node", [join(OUT, "probe.mjs")], {
    cwd: OUT,
    encoding: "utf8",
  });
  results = JSON.parse(raw) as LoadResult[];
}, 180_000);

describe("Vercel 런타임에서의 함수 로드", () => {
  it("api 함수 파일을 찾는다", () => {
    expect(results.length).toBeGreaterThan(0);
  });

  it("모든 함수가 번들 없이 Node ESM 으로 뜬다", () => {
    // 여기서 나는 오류가 곧 배포에서 나는 오류다
    // (ERR_MODULE_NOT_FOUND · ERR_UNSUPPORTED_DIR_IMPORT 등)
    const broken = results.filter(r => r.error);
    expect(
      broken.map(r => `${r.file} — ${r.error}`),
      "확장자 없는 import 나 폴더 import 가 남아 있습니다"
    ).toEqual([]);
  });

  it("모든 함수가 HTTP 메서드를 하나 이상 내보낸다", () => {
    const empty = results.filter(r => !r.error && !r.handlers?.length);
    expect(empty.map(r => r.file)).toEqual([]);
  });
});
