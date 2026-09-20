/**
 * 복구본 검사 — **판정 로직만** 따로 둔다.
 *
 * `verify-restore.mjs` 는 연결 문자열을 받아 이 함수를 부르는 껍데기다. 검사
 * 자체를 여기로 뺀 이유는 **테스트에 걸기 위해서**다. 운영 DB 없이 격리된
 * Postgres(PGlite)에 대고 같은 함수를 돌려 볼 수 있어야, 이 도구가 「없는
 * 표를 있다고 하거나 덜 따라온 복구본을 성공이라고 하는」 실수를 안 한다는
 * 것을 확인할 수 있다.
 *
 * `sql` 은 neon 의 태그 함수와 같은 모양이면 무엇이든 된다 — 행 배열을
 * 돌려주면 그만이다.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 있어야 할 표 전부.
 *
 * 예전에는 8개만 봤다. 그 8개만 있으면 **알림도 사용자도 없는 복구본을
 * 「읽을 수 있습니다」로 판정**했다. 배포는 그 스키마에 대고 돌아가므로 첫
 * 조회에서 터진다.
 *
 * `server/erp/restoreChecks.test.ts` 가 이 목록을 `drizzle/erpSchema.ts` 와
 * 대조한다 — 표를 새로 만들고 여기에 안 적으면 테스트가 떨어진다.
 */
export const CRITICAL_TABLES = [
  "erp_account",
  "erp_approval",
  "erp_attachment",
  "erp_audit_log",
  "erp_contract",
  "erp_day_snapshot",
  "erp_debt",
  "erp_debt_schedule",
  "erp_entry",
  "erp_entry_revision",
  "erp_intake",
  "erp_journal",
  "erp_journal_line",
  "erp_notification",
  "erp_notification_rule",
  "erp_party",
  "erp_period",
  "erp_project",
  "erp_role_permission",
  "erp_setting",
  "erp_settlement",
  "erp_user",
];

/**
 * 나중에 생긴 칸들 — **표가 있어도 칸이 없으면 못 쓴다.**
 *
 * 복구 시점이 마이그레이션 중간이면 표는 있는데 칸이 없는 상태가 나온다.
 * 표만 세면 그걸 못 잡는다.
 */
export const CRITICAL_COLUMNS = [
  { table: "erp_settlement", column: "bankRef", since: "0003" },
  { table: "erp_entry", column: "internalTransferId", since: "0004" },
  { table: "erp_notification", column: "sendAttempts", since: "0005" },
  { table: "erp_notification", column: "lastError", since: "0005" },
  { table: "erp_notification", column: "lastAttemptAt", since: "0005" },
  { table: "erp_user", column: "buCode", since: "0006" },
  { table: "erp_notification", column: "leaseUntil", since: "0007" },
];

/**
 * 지금 배포가 기대하는 마이그레이션 목록.
 *
 * drizzle 마이그레이터는 파일 내용의 sha256 을 `drizzle.__drizzle_migrations`
 * 에 적는다. 같은 방법으로 해시를 만들어 대조하면 **어느 마이그레이션이
 * 안 들어갔는지 이름으로** 말할 수 있다.
 */
export function expectedMigrations(dir) {
  const journal = JSON.parse(
    readFileSync(join(dir, "meta", "_journal.json")).toString()
  );
  return journal.entries.map(entry => ({
    tag: entry.tag,
    when: entry.when,
    hash: createHash("sha256")
      .update(readFileSync(join(dir, `${entry.tag}.sql`)).toString())
      .digest("hex"),
  }));
}

/**
 * 완전복구를 판정하려면 **셋 다** 있어야 한다.
 *
 * 하나만 맞아도 통과시키던 것이 QA-005 재오픈의 핵심이다. 건수는 같은데
 * 금액이 통째로 다른 복구본이 **완전복구 통과**로 나온다. 건수·합계·기준시각은
 * 서로 다른 것을 잡으므로 하나로 나머지를 대신할 수 없다.
 */
export const BASELINE_KEYS = ["asOf", "entries", "settledTotal"];

/** 기준값이 쓸 수 없으면 **판정하지 않고 멈춘다** */
export class RestoreArgumentError extends Error {
  constructor(errors) {
    super(
      ["기준값을 쓸 수 없습니다:", ...errors.map(e => `  - ${e}`)].join("\n")
    );
    this.name = "RestoreArgumentError";
    this.errors = errors;
  }
}

const isGiven = v => v != null && v !== "";

const FLAG_OF = {
  asOf: "--as-of",
  entries: "--entries",
  settledTotal: "--settled-total",
};

/**
 * 기준값 검사 — **틀린 값을 조용히 통과시키지 않는다.**
 *
 * 특히 날짜. `Date.parse("not-a-date")` 는 NaN 이고 `NaN > x` 는 **늘
 * false** 다. 그래서 아무 글자나 넣으면 「기준시각 이후 데이터 없음」이
 * 언제나 참이 됐다. 틀린 값을 준 사람이 통과를 보는 것이 가장 나쁘다.
 *
 * 틀린 것을 **전부** 모아서 돌려준다 — 하나 고치고 다시 돌렸더니 또 다른
 * 것이 나오는 것보다 낫다.
 */
export function validateExpectation(expect = {}, now = Date.now()) {
  const errors = [];

  if (expect.asOf !== undefined && expect.asOf !== null) {
    if (typeof expect.asOf !== "string" || expect.asOf.trim() === "") {
      errors.push("기준시각(as-of)이 비어 있습니다");
    } else {
      const t = Date.parse(expect.asOf);
      if (Number.isNaN(t)) {
        errors.push(
          `기준시각(as-of)을 날짜로 읽을 수 없습니다: ${expect.asOf}`
        );
      } else if (t < Date.parse("2000-01-01T00:00:00Z")) {
        errors.push(`기준시각(as-of)이 2000년보다 이전입니다: ${expect.asOf}`);
      } else if (t > now + 24 * 60 * 60 * 1000) {
        // 연도 오타(2126)를 잡는다 — 미래로 복구할 수는 없다
        errors.push(`기준시각(as-of)이 미래입니다: ${expect.asOf}`);
      }
    }
  }

  const whole = (key, label, min) => {
    const v = expect[key];
    if (v === undefined || v === null) return;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      errors.push(`${label}을(를) 숫자로 읽을 수 없습니다: ${v}`);
    } else if (!Number.isInteger(v)) {
      errors.push(`${label}에 소수를 쓸 수 없습니다: ${v}`);
    } else if (v < min) {
      errors.push(`${label}이(가) ${min} 보다 작습니다: ${v}`);
    }
  };
  whole("entries", "원장 건수(entries)", 0);
  whole("settledTotal", "입출금 확인 합계(settled-total)", 0);

  return errors;
}

const won = n => (n == null ? "—" : Number(n).toLocaleString("ko-KR"));

async function tableNames(sql) {
  const rows = await sql`
    select table_name from information_schema.tables
    where table_schema = 'public'
  `;
  return new Set(rows.map(r => r.table_name));
}

async function columnKeys(sql) {
  const rows = await sql`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public'
  `;
  return new Set(rows.map(r => `${r.table_name}.${r.column_name}`));
}

async function appliedMigrations(sql) {
  const [probe] = await sql`
    select to_regclass('drizzle.__drizzle_migrations')::text as t
  `;
  if (!probe?.t) return null; // 표 자체가 없다 = 마이그레이터가 돈 적 없다
  const rows = await sql`
    select hash, created_at from drizzle.__drizzle_migrations order by id
  `;
  return rows.map(r => ({ hash: r.hash, createdAt: Number(r.created_at) }));
}

/**
 * 복구본을 검사한다. **아무것도 쓰지 않는다** — SELECT 만 한다.
 *
 * `expect` 에 기준값을 주면 「완전복구」를 따로 판정한다. 안 주면 그 판정은
 * **미검증**이다 — 「원장이 비어 있지 않다」는 완전복구와 다른 말이다.
 */
export async function runRestoreChecks({
  sql,
  dir,
  expect = {},
  log = () => {},
}) {
  /*
   * **여기서도 검사한다.** CLI 가 이미 보지만, 이 함수를 직접 부르는 쪽
   * (테스트 · 다른 스크립트)은 CLI 를 거치지 않는다. 검사를 한 곳에만 두면
   * 거치지 않는 경로가 그대로 뚫린다.
   */
  const argErrors = validateExpectation(expect);
  if (argErrors.length > 0) throw new RestoreArgumentError(argErrors);

  const result = {
    schema: { status: "ok", missingTables: [], missingColumns: [] },
    migrations: {
      status: "ok",
      missingTags: [],
      appliedCount: 0,
      expectedCount: 0,
    },
    ledger: {},
    completeness: { status: "unverified", rows: [] },
    exitCode: 0,
  };

  /* ── [1] 표 · 칸 ───────────────────────────────────────────────────────── */
  const tables = await tableNames(sql);
  const columns = await columnKeys(sql);
  result.schema.missingTables = CRITICAL_TABLES.filter(t => !tables.has(t));
  result.schema.missingColumns = CRITICAL_COLUMNS.filter(
    c => tables.has(c.table) && !columns.has(`${c.table}.${c.column}`)
  );
  if (
    result.schema.missingTables.length > 0 ||
    result.schema.missingColumns.length > 0
  ) {
    result.schema.status = "fail";
  }

  log("\n[1] 스키마");
  log(
    `  표 ${CRITICAL_TABLES.length - result.schema.missingTables.length}/${CRITICAL_TABLES.length}` +
      ` · 칸 ${CRITICAL_COLUMNS.length - result.schema.missingColumns.length}/${CRITICAL_COLUMNS.length}`
  );
  for (const t of result.schema.missingTables) log(`  ✗ 표 없음  ${t}`);
  for (const c of result.schema.missingColumns)
    log(`  ✗ 칸 없음  ${c.table}.${c.column} (${c.since} 에서 생김)`);

  /* ── [2] 마이그레이션 장부 ─────────────────────────────────────────────── */
  const expectedList = expectedMigrations(dir);
  const applied = await appliedMigrations(sql);
  result.migrations.expectedCount = expectedList.length;

  log("\n[2] 마이그레이션 장부");
  if (applied == null) {
    result.migrations.status = "fail";
    result.migrations.missingTags = expectedList.map(m => m.tag);
    log(
      "  ✗ drizzle.__drizzle_migrations 가 없습니다 — 마이그레이터가 돈 적이 없습니다"
    );
  } else {
    const have = new Set(applied.map(m => m.hash));
    result.migrations.appliedCount = applied.length;
    result.migrations.missingTags = expectedList
      .filter(m => !have.has(m.hash))
      .map(m => m.tag);
    if (result.migrations.missingTags.length > 0)
      result.migrations.status = "fail";
    log(`  적용 ${applied.length} / 기대 ${expectedList.length}`);
    for (const tag of result.migrations.missingTags)
      log(`  ✗ 안 들어감  ${tag}`);
    /*
     * 기대보다 **많은** 것은 실패로 보지 않는다 — 복구본이 더 최신인 경우다.
     * 다만 이 도구가 모르는 마이그레이션이므로 눈에 보이게 적어 둔다.
     */
    const extra = applied.length - expectedList.length;
    if (extra > 0)
      log(`  ⚠ 이 저장소가 모르는 마이그레이션이 ${extra}개 더 있습니다`);
  }

  /* ── [3] 원장 ──────────────────────────────────────────────────────────── */
  log("\n[3] 원장");
  /*
   * 표 이름만 보고 세지 않는다 — 이름만 같고 칸이 없는 껍데기가 있을 수 있다.
   * 그럴 때 질의를 던지면 스크립트가 통째로 죽어서 **앞의 진단까지 못 보여
   * 준다.** 셀 수 있는지 먼저 확인한다.
   */
  const canCountEntries =
    tables.has("erp_entry") &&
    columns.has("erp_entry.status") &&
    columns.has("erp_entry.createdAt");
  if (!canCountEntries) {
    result.ledger = { entries: null };
    log("  셀 수 없습니다 — erp_entry 표나 칸이 없습니다");
  } else {
    const [{ n: entries }] =
      await sql`select count(*)::int as n from erp_entry`;
    const [{ n: confirmed }] = await sql`
      select count(*)::int as n from erp_entry where status = 'confirmed'
    `;
    const [{ n: undecided }] = await sql`
      select count(*)::int as n from erp_entry where status = 'undecided'
    `;
    const [{ latest }] = await sql`
      select max("createdAt")::text as latest from erp_entry
    `;
    result.ledger = { entries, confirmed, undecided, latestCreatedAt: latest };
    log(
      `  전체 ${won(entries)}건 · 확정 ${won(confirmed)} · 판정 대기 ${won(undecided)}`
    );
    log(`  마지막으로 들어온 건: ${latest ?? "—"}`);
  }

  let settledTotal = null;
  if (tables.has("erp_settlement") && columns.has("erp_settlement.voidedAt")) {
    const [{ total }] = await sql`
      select coalesce(sum(amount), 0)::bigint as total
      from erp_settlement where "voidedAt" is null
    `;
    settledTotal = Number(total);
    result.ledger.settledTotal = settledTotal;
    log(`  살아 있는 입출금 확인 합계 ${won(settledTotal)}`);
  }

  let latestAuditAt = null;
  if (tables.has("erp_audit_log") && columns.has("erp_audit_log.at")) {
    const [{ at }] = await sql`
      select max("at")::text as at from erp_audit_log
    `;
    latestAuditAt = at ?? null;
    result.ledger.latestAuditAt = latestAuditAt;
    log(`  마지막 감사로그: ${latestAuditAt ?? "—"}`);
  }

  /* ── [4] 완전복구 — 기준값이 있어야 판정한다 ──────────────────────────── */
  log("\n[4] 완전복구");
  const rows = [];
  const MARK = { ok: "✓", fail: "✗", unknown: "?" };
  const check = (label, expected, actual, status) => {
    rows.push({ label, expected, actual, status });
    log(`  ${MARK[status]} ${label}  기대 ${expected} · 실제 ${actual}`);
  };

  if (expect.entries != null) {
    check(
      "원장 건수",
      won(expect.entries),
      won(result.ledger.entries),
      result.ledger.entries === expect.entries ? "ok" : "fail"
    );
  }
  if (expect.settledTotal != null) {
    check(
      "입출금 확인 합계",
      won(expect.settledTotal),
      won(settledTotal),
      settledTotal === expect.settledTotal ? "ok" : "fail"
    );
  }
  if (expect.asOf != null) {
    /*
     * 복구 시점 **이후**의 데이터가 있으면 시점이 틀린 것이다. 없는 것은
     * 여기서 못 잡는다 — 그건 건수·합계가 잡는다.
     */
    /*
     * 감사로그가 없으면 **확인할 수 없다.** 예전에는 그때도 통과로 셌다 —
     * 「볼 것이 없으니 문제도 없다」는 검사가 아니다.
     */
    const status =
      latestAuditAt == null
        ? "unknown"
        : Date.parse(latestAuditAt) > Date.parse(expect.asOf)
          ? "fail"
          : "ok";
    check(
      "기준시각 이후 데이터 없음",
      expect.asOf,
      latestAuditAt ?? "감사로그 없음",
      status
    );
  }

  const missing = BASELINE_KEYS.filter(k => !isGiven(expect[k]));
  result.completeness.rows = rows;
  result.completeness.missing = missing;

  /*
   * **틀린 것이 하나라도 있으면 실패다** — 나머지를 안 줬다는 이유로 미검증에
   * 숨기지 않는다. 틀린 것은 틀린 것이다.
   *
   * 틀린 것이 없더라도 **셋을 다 주고 다 확인됐을 때만** 통과다. 셋은 서로
   * 다른 것을 잡으므로 하나로 나머지를 대신할 수 없다 — 건수가 같아도 금액이
   * 통째로 다를 수 있다.
   */
  if (rows.some(r => r.status === "fail")) {
    result.completeness.status = "fail";
  } else if (missing.length > 0 || rows.some(r => r.status === "unknown")) {
    result.completeness.status = "unverified";
    if (rows.length === 0) {
      log("  **미검증** — 기준값(기준시각 · 건수 · 합계)을 주지 않았습니다.");
      log("  원장이 비어 있지 않다는 것은 완전복구와 다른 말입니다.");
    } else {
      log("  **미검증** — 확인한 것은 맞지만 아직 덜 봤습니다.");
    }
    if (missing.length > 0)
      log(`  안 준 기준값: ${missing.map(k => FLAG_OF[k]).join(" · ")}`);
    for (const r of rows.filter(x => x.status === "unknown"))
      log(`  확인 불가: ${r.label} (${r.actual})`);
    log("  --as-of / --entries / --settled-total 을 **셋 다** 주십시오.");
  } else {
    result.completeness.status = "ok";
  }

  /* ── 판정 ──────────────────────────────────────────────────────────────── */
  const failed =
    result.schema.status === "fail" ||
    result.migrations.status === "fail" ||
    result.completeness.status === "fail" ||
    result.ledger.entries === 0 ||
    result.ledger.entries == null;

  if (failed) result.exitCode = 1;
  else if (result.completeness.status === "unverified") result.exitCode = 3;
  else result.exitCode = 0;

  return result;
}
