/**
 * PostgreSQL 저장 계층 — 실제 Postgres 엔진에 대고 검증한다.
 *
 * 왜 필요한가 — 다른 314건은 메모리 저장소로 돈다. 그래서 스키마·매핑이 틀려도
 * 테스트는 전부 통과하고, **DB 를 붙인 다음에야** 터진다. MySQL 에서
 * PostgreSQL 로 옮기면서 컬럼 타입 27개·enum 14종·upsert 15군데가 바뀌었으므로
 * 그 계층만 따로 붙잡아 둔다.
 *
 * PGlite 는 Postgres 를 그대로 WASM 으로 돌린다 — 흉내가 아니라 같은 엔진이라
 * enum·bigint·ON CONFLICT 가 실제와 같게 동작한다. Neon 과 다른 점은 네트워크와
 * 드라이버뿐이다.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ACCOUNTS,
  SEED_DAY_SNAPSHOTS,
  SEED_ENTRIES,
  SEED_SETTINGS,
  runMigrationChecks,
} from "../../shared/erp/index.js";
import {
  erpAccounts,
  erpDaySnapshots,
  erpEntries,
  erpSettings,
} from "../../drizzle/erpSchema.js";
import { DrizzleLedgerStore } from "./drizzleStore.js";

const MIGRATION_DIR = join(import.meta.dirname, "..", "..", "drizzle");

/** 마이그레이션 SQL 을 그대로 실행한다 — 스키마의 단일 출처가 그것이기 때문이다 */
function migrationSql(): string {
  const files = readdirSync(MIGRATION_DIR)
    .filter(name => /^\d{4}_.*\.sql$/.test(name))
    .sort();
  expect(files.length).toBeGreaterThan(0);
  return files
    .map(name => readFileSync(join(MIGRATION_DIR, name), "utf8"))
    .join("\n");
}

let db: ReturnType<typeof drizzle>;
let store: DrizzleLedgerStore;

beforeAll(async () => {
  const client = new PGlite();
  await client.exec(migrationSql().replaceAll("--> statement-breakpoint", ""));
  db = drizzle(client);
  store = new DrizzleLedgerStore(db as never);
}, 60_000);

describe("마이그레이션이 실제 Postgres 에서 실행된다", () => {
  it("원장 테이블이 만들어졌다", async () => {
    expect(await store.listEntries()).toEqual([]);
  });
});

describe("시드를 실제로 넣고 되읽는다", () => {
  beforeAll(async () => {
    for (const account of ACCOUNTS)
      await db.insert(erpAccounts).values(account).onConflictDoNothing();
    for (const snapshot of SEED_DAY_SNAPSHOTS)
      await db.insert(erpDaySnapshots).values(snapshot).onConflictDoNothing();
    for (const entry of SEED_ENTRIES)
      await db
        .insert(erpEntries)
        .values({ ...entry, createdAt: new Date(entry.createdAt) })
        .onConflictDoNothing();
    for (const setting of SEED_SETTINGS)
      await db
        .insert(erpSettings)
        .values({
          key: setting.key,
          value: setting.value,
          isProvisional: setting.isProvisional,
          ownerRole: setting.ownerRole,
          updatedBy: setting.updatedBy,
        })
        .onConflictDoNothing();
  }, 60_000);

  it("건수가 맞는다", async () => {
    expect((await store.listEntries()).length).toBe(SEED_ENTRIES.length);
  });

  it("BIGINT 금액이 정수 그대로 돌아온다 — 문자열도 실수도 아니다", async () => {
    const entries = await store.listEntries();
    const withAmount = entries.filter(e => e.amount != null);
    expect(withAmount.length).toBeGreaterThan(0);
    for (const entry of withAmount) {
      expect(typeof entry.amount).toBe("number");
      expect(Number.isInteger(entry.amount)).toBe(true);
    }
    // 시드의 최대 금액이 반올림 없이 그대로인지
    const max = Math.max(...withAmount.map(e => e.amount!));
    expect(max).toBe(
      Math.max(
        ...SEED_ENTRIES.filter(e => e.amount != null).map(e => e.amount!)
      )
    );
  });

  it("날짜가 문자열 YYYY-MM-DD 로 돌아온다 — Date 로 변환되지 않는다", async () => {
    const entry = (await store.listEntries()).find(e => e.cashDate != null);
    expect(entry?.cashDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("enum 컬럼이 도메인 값 그대로 돌아온다", async () => {
    const entries = await store.listEntries();
    for (const entry of entries) {
      expect(["out", "in"]).toContain(entry.direction);
      if (entry.nature != null)
        expect([
          "통과원가",
          "직접원가",
          "공통배부",
          "해당없음",
          "손익아님",
          "미지정",
        ]).toContain(entry.nature);
    }
  });

  it("jsonb 설정값이 구조 그대로 돌아온다", async () => {
    const settings = await store.listSettings();
    const cash = settings.find(s => s.key === "cash_on_hand");
    expect(cash?.value).toBe(18_000_000);
  });

  it("V1~V8 이관 검증이 메모리 저장소와 같은 결과를 낸다", async () => {
    const [entries, snapshots] = await Promise.all([
      store.listEntries(),
      store.listSnapshots(),
    ]);
    const fromDb = runMigrationChecks(entries, snapshots);
    const fromMemory = runMigrationChecks(SEED_ENTRIES, SEED_DAY_SNAPSHOTS);
    expect(fromDb.map(c => [c.id, c.verdict])).toEqual(
      fromMemory.map(c => [c.id, c.verdict])
    );
  });
});

describe("upsert 가 Postgres 에서 실제로 갱신한다 (ON CONFLICT)", () => {
  it("같은 키로 두 번 넣으면 갱신되고 행이 늘지 않는다", async () => {
    const before = (await store.listSettings()).length;
    await store.putSetting({
      key: "cash_on_hand",
      value: 25_000_000,
      isProvisional: false,
      ownerRole: "재무",
      updatedBy: "test",
      updatedAt: null,
    });
    const after = await store.listSettings();
    expect(after.length).toBe(before);
    expect(after.find(s => s.key === "cash_on_hand")?.value).toBe(25_000_000);
  });

  it("계정과목도 같은 코드로 갱신된다", async () => {
    const before = (await store.listAccounts()).length;
    const first = ACCOUNTS[0];
    await store.upsertAccount({ ...first, name: `${first.name} (수정)` });
    const after = await store.listAccounts();
    expect(after.length).toBe(before);
    expect(after.find(a => a.code === first.code)?.name).toContain("(수정)");
  });
});

describe("화면에서 누르는 시드 적재 (대표만 · 여러 번 눌러도 안전)", () => {
  /** 빈 DB 를 새로 만들어 적재 경로만 본다 */
  async function freshStore() {
    const client = new PGlite();
    await client.exec(
      migrationSql().replaceAll("--> statement-breakpoint", "")
    );
    const fresh = drizzle(client);
    return new DrizzleLedgerStore(fresh as never);
  }

  const CEO = { id: "ceo@dinostudio.kr", role: "대표" as const };
  const CFO = { id: "cfo@dinostudio.kr", role: "재무" as const };

  it("대표가 누르면 시드가 들어가고 이관 검증이 함께 돌아온다", async () => {
    const { LedgerService } = await import("./service.js");
    const service = new LedgerService(await freshStore());

    const result = await service.seedDatabase(CEO);
    expect(result.inserted.entries).toBe(SEED_ENTRIES.length);
    expect(result.inserted.snapshots).toBe(SEED_DAY_SNAPSHOTS.length);
    expect(result.inserted.accounts).toBe(ACCOUNTS.length);
    expect(result.skipped).toBe(0);
    // 적재 직후의 V1~V8 — 메모리 저장소와 같은 판정이어야 한다
    expect(result.checks.length).toBeGreaterThan(0);
    expect(result.entryCount).toBe(SEED_ENTRIES.length);
  }, 60_000);

  it("두 번 눌러도 덮어쓰지 않는다 (§5.6 재이관 금지)", async () => {
    const { LedgerService } = await import("./service.js");
    const service = new LedgerService(await freshStore());

    await service.seedDatabase(CEO);
    const again = await service.seedDatabase(CEO);
    expect(again.inserted.entries).toBe(0);
    expect(again.skipped).toBe(SEED_ENTRIES.length);
    // 건수가 두 배가 되지 않았다
    expect(again.entryCount).toBe(SEED_ENTRIES.length);
  }, 60_000);

  it("재무는 실행할 수 없다 — 원장 전체를 만드는 작업이다", async () => {
    const { LedgerService } = await import("./service.js");
    const service = new LedgerService(await freshStore());
    await expect(service.seedDatabase(CFO)).rejects.toThrow(/대표만/);
  }, 60_000);
});
