/**
 * QA-005 — 복구 검증 도구가 **덜 따라온 복구본을 성공이라고 하지 않는가.**
 *
 * 이건 운영 결함이 아니라 **검사 도구의 한계**를 고친 것이다. 예전 도구는
 * 표 8개만 보고, 나중에 생긴 칸(`leaseUntil`, `buCode`)도 마이그레이션 장부도
 * 안 봤다. 그래서 알림 표가 통째로 없는 복구본도 「읽을 수 있습니다」로
 * 판정했다 — 배포는 그 스키마에 대고 돌아가므로 첫 조회에서 터진다.
 *
 * **운영 DB 에는 붙지 않는다.** 격리된 Postgres(PGlite)에 진짜 마이그레이션을
 * 적용해 만든 합성 복구본에 대고 돌린다. 여기서 통과한다고 해서 운영 Neon
 * 시점 복구가 검증된 것은 아니다 — 그건 콘솔에서 사람이 해야 한다.
 */
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CRITICAL_TABLES,
  CRITICAL_COLUMNS,
  expectedMigrations,
  runRestoreChecks,
} from "../../scripts/restoreChecks.mjs";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "../../drizzle/erpSchema.js";

/** erpSchema.ts 에서 표만 골라 이름을 꺼낸다 (enum · 상수는 걸러낸다) */
const schemaTables = (): string[] =>
  Object.values(schema as Record<string, unknown>)
    .filter(v => is(v, PgTable))
    .map(v => getTableName(v as PgTable));

const DIR = join(import.meta.dirname, "..", "..", "drizzle");

/** neon 태그 함수와 같은 모양으로 PGlite 를 감싼다 */
function sqlOf(client: PGlite) {
  return async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = "";
    strings.forEach((s, i) => {
      text += s;
      if (i < values.length) text += `$${i + 1}`;
    });
    const res = await client.query(text, values);
    return res.rows as Record<string, never>[];
  };
}

/** 마이그레이션을 **중간까지만** 적용한 폴더를 만든다 (옛 시점 복구본) */
function partialMigrationDir(upTo: string) {
  const dir = mkdtempSync(join(tmpdir(), "erp-restore-"));
  const meta = join(dir, "meta");
  mkdirSync(meta);
  const journal = JSON.parse(
    readFileSync(join(DIR, "meta", "_journal.json")).toString()
  );
  const kept = journal.entries.filter(
    (e: { tag: string }) => e.tag.localeCompare(upTo) <= 0
  );
  for (const e of kept)
    copyFileSync(join(DIR, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
  writeFileSync(
    join(meta, "_journal.json"),
    JSON.stringify({ ...journal, entries: kept })
  );
  return { dir, kept: kept.length };
}

async function freshClient(migrationsFolder = DIR) {
  const client = new PGlite();
  await migrate(drizzle(client), { migrationsFolder });
  return client;
}

describe("검사 목록이 스키마에 뒤처지지 않는다", () => {
  it("**erpSchema.ts 의 표가 전부 검사 목록에 있다**", () => {
    // 표를 새로 만들고 목록에 안 적으면 여기서 떨어진다 — 그게 이 테스트의 일이다
    const inSchema = schemaTables().filter(n => n.startsWith("erp_"));
    expect(inSchema.length).toBeGreaterThan(15);
    const missing = inSchema.filter(t => !CRITICAL_TABLES.includes(t));
    expect(missing).toEqual([]);
  });

  it("검사 목록에 없는 표를 적어 두지 않았다", () => {
    const inSchema = new Set(schemaTables());
    expect(CRITICAL_TABLES.filter(t => !inSchema.has(t))).toEqual([]);
  });

  it("마이그레이션 해시가 drizzle 이 적는 값과 같다", async () => {
    const client = await freshClient();
    const rows = await client.query<{ hash: string }>(
      `select hash from "drizzle"."__drizzle_migrations" order by id`
    );
    const applied = rows.rows.map(r => r.hash).sort();
    const expectedHashes = expectedMigrations(DIR)
      .map(m => m.hash)
      .sort();
    // 해시 계산 방법이 다르면 장부 대조가 통째로 무의미해진다
    expect(applied).toEqual(expectedHashes);
  }, 60_000);
});

describe("최신 스키마 복구본", () => {
  let client: PGlite;
  beforeAll(async () => {
    client = await freshClient();
    await client.query(`
      insert into "erp_entry"
        ("id","code","direction","status","title","cashDate","source","createdBy","createdAt")
      values ('e1','EX-260920-01','out','confirmed','합성 지출','2026-09-20','manual','qa@example.test','2026-09-20T00:00:00Z'),
             ('e2','EX-260920-02','out','undecided','합성 판정대기','2026-09-20','manual','qa@example.test','2026-09-20T00:10:00Z')
    `);
    await client.query(`
      insert into "erp_audit_log" ("id","tableName","rowId","action","actor","at")
      values ('a1','entry','e1','create','qa@example.test','2026-09-20T00:10:00Z')
    `);
  }, 60_000);

  it("표·칸·장부가 전부 맞는다", async () => {
    const r = await runRestoreChecks({ sql: sqlOf(client), dir: DIR });
    expect(r.schema.missingTables).toEqual([]);
    expect(r.schema.missingColumns).toEqual([]);
    expect(r.migrations.status).toBe("ok");
    expect(r.migrations.appliedCount).toBe(r.migrations.expectedCount);
  });

  it("**기준값이 없으면 완전복구는 미검증이다** — 0 으로 끝나지 않는다", async () => {
    const r = await runRestoreChecks({ sql: sqlOf(client), dir: DIR });
    expect(r.ledger.entries).toBe(2);
    expect(r.completeness.status).toBe("unverified");
    expect(r.exitCode).toBe(3);
  });

  it("기준값이 맞으면 완전복구까지 통과한다", async () => {
    const r = await runRestoreChecks({
      sql: sqlOf(client),
      dir: DIR,
      expect: {
        entries: 2,
        settledTotal: 0,
        asOf: "2026-09-20T09:10:00+09:00", // = 00:10Z, 마지막 감사로그와 같다
      },
    });
    expect(r.completeness.status).toBe("ok");
    expect(r.exitCode).toBe(0);
  });

  it("**건수가 다르면 실패다** — 읽힌다고 복구된 것이 아니다", async () => {
    const r = await runRestoreChecks({
      sql: sqlOf(client),
      dir: DIR,
      expect: { entries: 61 },
    });
    expect(r.completeness.status).toBe("fail");
    expect(r.exitCode).toBe(1);
  });

  it("기준시각 이후 데이터가 있으면 실패다 — 시점이 틀린 것이다", async () => {
    const r = await runRestoreChecks({
      sql: sqlOf(client),
      dir: DIR,
      expect: { asOf: "2026-09-19T00:00:00Z" },
    });
    expect(r.completeness.status).toBe("fail");
    expect(r.exitCode).toBe(1);
  });

  it("원장이 비어 있으면 실패다", async () => {
    const empty = await freshClient();
    const r = await runRestoreChecks({ sql: sqlOf(empty), dir: DIR });
    expect(r.ledger.entries).toBe(0);
    expect(r.exitCode).toBe(1);
  }, 60_000);
});

describe("**옛 시점 복구본** — 예전 도구가 성공이라고 하던 것", () => {
  it("0005 까지만 적용된 복구본을 잡는다", async () => {
    const { dir, kept } = partialMigrationDir("0005_zzz");
    const client = await freshClient(dir);
    await client.query(`
      insert into "erp_entry"
        ("id","code","direction","status","title","cashDate","source","createdBy","createdAt")
      values ('e1','EX-260901-01','out','confirmed','합성','2026-09-01','manual','qa@example.test','2026-09-01T00:00:00Z')
    `);
    const r = await runRestoreChecks({ sql: sqlOf(client), dir: DIR });

    /*
     * **예전 도구가 왜 통과시켰는지**를 못박아 둔다. 옛 목록의 표 8개는 이
     * 복구본에도 전부 있고 원장도 비어 있지 않다 — 그래서 「읽을 수
     * 있습니다」로 끝났다. 없는 것은 그 8개 **바깥**에 있었다.
     */
    const OLD_TABLES = [
      "erp_entry",
      "erp_journal",
      "erp_journal_line",
      "erp_settlement",
      "erp_intake",
      "erp_setting",
      "erp_audit_log",
      "erp_day_snapshot",
    ];
    const present = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema='public'`
    );
    const names = new Set(present.rows.map(x => x.table_name));
    expect(OLD_TABLES.filter(t => !names.has(t))).toEqual([]);
    expect(r.ledger.entries).toBe(1);

    // 지금은 잡는다
    expect(
      r.schema.missingColumns.map(c => `${c.table}.${c.column}`)
    ).toContain("erp_user.buCode");
    expect(
      r.schema.missingColumns.map(c => `${c.table}.${c.column}`)
    ).toContain("erp_notification.leaseUntil");
    expect(r.migrations.appliedCount).toBe(kept);
    expect(r.migrations.missingTags).toEqual([
      "0006_warm_vector",
      "0007_chunky_paper_doll",
    ]);
    expect(r.exitCode).toBe(1);
  }, 60_000);

  it("마이그레이터가 돈 적 없는 DB 는 장부 없음으로 잡는다", async () => {
    const bare = new PGlite();
    await bare.query(`create table "erp_entry" ("id" text primary key)`);
    const r = await runRestoreChecks({ sql: sqlOf(bare), dir: DIR });
    expect(r.migrations.status).toBe("fail");
    expect(r.migrations.missingTags.length).toBe(r.migrations.expectedCount);
    expect(r.schema.missingTables.length).toBeGreaterThan(15);
    expect(r.exitCode).toBe(1);
  }, 60_000);
});
