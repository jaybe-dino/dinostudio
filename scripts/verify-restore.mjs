/**
 * 복구 리허설 검증 — **「복구된다」는 확인 없이 백업은 백업이 아니다.**
 *
 * Neon 에서 시점 복구로 만든 **새 브랜치**에 대고 돌린다.
 *
 *   node scripts/verify-restore.mjs "<복구 브랜치 연결 문자열>"
 *   RESTORE_DATABASE_URL="..." node scripts/verify-restore.mjs
 *
 * 기준값을 주면 **완전복구까지** 판정한다. 안 주면 거기는 미검증이다 —
 * 원장이 비어 있지 않다는 것은 완전복구와 다른 말이기 때문이다.
 *
 *   node scripts/verify-restore.mjs "<...>" \
 *     --as-of=2026-09-20T09:00:00+09:00 --entries=61 --settled-total=12345678
 *
 * 끝나는 값:
 *   0  전부 통과 — 스키마·마이그레이션·기준값이 다 맞는다
 *   3  **읽을 수는 있으나 완전복구는 미검증** (기준값을 안 줬다)
 *   1  실패 — 스키마·마이그레이션·기준값 중 하나가 안 맞는다
 *   2  쓸 수 없는 인자 (연결 문자열 없음 · 운영과 같음)
 *
 * ⚠️ **운영 DB 에 대고 돌리지 마십시오.** 읽기만 하지만, 리허설의 목적은
 * 복구본이 쓸 만한지 보는 것이지 운영을 확인하는 것이 아니다. 연결 문자열이
 * 운영과 같으면 **거부한다.**
 *
 * 이 스크립트는 **아무것도 쓰지 않는다.** SELECT 만 한다.
 */
import { neon } from "@neondatabase/serverless";
import { join } from "node:path";
import {
  RestoreArgumentError,
  runRestoreChecks,
  validateExpectation,
} from "./restoreChecks.mjs";

const args = process.argv.slice(2);
const flags = new Map(
  args
    .filter(a => a.startsWith("--"))
    .map(a => {
      const i = a.indexOf("=");
      return i === -1 ? [a.slice(2), ""] : [a.slice(2, i), a.slice(i + 1)];
    })
);
const positional = args.filter(a => !a.startsWith("--"));
const url = positional[0] ?? process.env.RESTORE_DATABASE_URL;

if (!url) {
  console.error(
    [
      "복구 브랜치의 연결 문자열이 필요합니다.",
      "",
      '  node scripts/verify-restore.mjs "postgres://..."',
      "",
      "Neon 콘솔 → Branches → main 에서 Create branch →",
      "복구 시점을 지정해 새 브랜치를 만든 뒤 그 연결 문자열을 넣으십시오.",
    ].join("\n")
  );
  process.exit(2);
}

/*
 * 운영 DB 에 대고 도는 것을 막는다.
 *
 * 리허설이 운영을 건드릴 일은 없지만(읽기만 한다), 연결 문자열을 잘못 붙여
 * 넣으면 **복구본이 아니라 운영을 확인하고 「복구됩니다」라고 결론 내린다.**
 * 그게 이 리허설이 막으려던 바로 그 사고다.
 */
if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) {
  console.error(
    [
      "운영 DATABASE_URL 과 같은 연결 문자열입니다 — 멈춥니다.",
      "",
      "복구 리허설은 **복구해서 만든 새 브랜치**에 대고 해야 합니다.",
      "운영을 확인하고 「복구됩니다」라고 결론 내리는 것이 가장 위험합니다.",
    ].join("\n")
  );
  process.exit(2);
}

/*
 * **빈 값은 「안 줬다」가 아니라 오류다.**
 *
 * `--entries=` 처럼 쓰면 준 것도 아니고 안 준 것도 아닌 상태가 된다. 조용히
 * 「안 줬다」로 처리하면 기준값을 줬다고 생각한 사람이 미검증 결과를 통과로
 * 읽는다. 플래그를 썼으면 값이 있어야 한다.
 */
const raw = key => {
  const env = `RESTORE_EXPECT_${key.toUpperCase().replace(/-/g, "_")}`;
  if (flags.has(key)) return flags.get(key);
  return process.env[env] ?? null;
};

const argErrors = [];
const num = key => {
  const v = raw(key);
  if (v == null) return null;
  if (v.trim() === "") {
    argErrors.push(`--${key} 에 값이 없습니다`);
    return null;
  }
  const n = Number(v.replace(/[,_]/g, ""));
  if (!Number.isFinite(n)) {
    argErrors.push(`--${key} 값을 숫자로 읽을 수 없습니다: ${v}`);
    return null;
  }
  return n;
};

const asOfRaw = raw("as-of");
if (asOfRaw != null && asOfRaw.trim() === "")
  argErrors.push("--as-of 에 값이 없습니다");

const expect = {
  asOf: asOfRaw,
  entries: num("entries"),
  settledTotal: num("settled-total"),
};

/*
 * 연결하기 **전에** 본다. 쓸 수 없는 기준값을 들고 DB 에 붙어 봐야 결과를
 * 판정할 수 없다. 검사 자체는 `runRestoreChecks` 안에도 있다 — 그 함수를
 * 직접 부르는 쪽은 이 껍데기를 거치지 않기 때문이다.
 */
argErrors.push(...validateExpectation(expect));
if (argErrors.length > 0) {
  console.error("기준값을 쓸 수 없습니다:");
  for (const e of argErrors) console.error(`  - ${e}`);
  process.exit(2);
}

const dir = join(import.meta.dirname, "..", "drizzle");

async function main() {
  console.log("복구 리허설 검증\n" + "=".repeat(48));
  const result = await runRestoreChecks({
    sql: neon(url),
    dir,
    expect,
    log: line => console.log(line),
  });

  console.log("\n" + "=".repeat(48));
  if (result.schema.status === "fail")
    console.log(
      "결과: **스키마가 덜 따라왔습니다.** 복구 시점이 마이그레이션보다 이전입니다."
    );
  if (result.migrations.status === "fail")
    console.log("결과: **마이그레이션 장부가 지금 배포와 맞지 않습니다.**");
  if (result.ledger.entries === 0)
    console.log("결과: **원장이 비어 있습니다** — 복구 시점을 다시 보십시오.");
  if (result.completeness.status === "fail")
    console.log("결과: **기준값과 다릅니다** — 복구본이 완전하지 않습니다.");

  if (result.exitCode === 3) {
    console.log(
      "결과: 복구본을 읽을 수 있습니다. **완전복구는 미검증입니다.**"
    );
    console.log("      (기준값을 주면 건수·합계·기준시각까지 판정합니다)");
  } else if (result.exitCode === 0) {
    console.log("결과: 복구본이 지금 배포와 맞고, 기준값과도 일치합니다.");
  }

  console.log("");
  console.log("다음 — 확인이 끝났으면 **그 브랜치를 지우십시오.**");
  console.log("리허설용 브랜치를 남겨 두면 어느 것이 운영인지 헷갈립니다.");
  process.exit(result.exitCode);
}

main().catch(error => {
  if (error instanceof RestoreArgumentError) {
    console.error(`\n${error.message}`);
    process.exit(2);
  }
  console.error("\n연결하거나 읽지 못했습니다:", error.message);
  console.error("연결 문자열과 복구 브랜치 상태를 확인하십시오.");
  process.exit(1);
});
