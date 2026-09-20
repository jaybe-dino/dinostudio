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
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
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
import type { Settlement } from "../../shared/erp/types.js";

const MIGRATION_DIR = join(import.meta.dirname, "..", "..", "drizzle");

/**
 * 배포와 **같은 방법으로** 마이그레이션을 적용한다.
 *
 * SQL 파일을 직접 읽어 실행하지 않는다 — 그러면 drizzle 의 journal 이 깨져도
 * 테스트는 통과한다. 프로덕션은 `scripts/migrate.mjs` 가 drizzle 마이그레이터로
 * 적용하므로, 여기서도 마이그레이터를 쓴다. 어댑터만 다르고 경로는 같다.
 */
async function applyMigrations(client: PGlite) {
  await migrate(drizzle(client), { migrationsFolder: MIGRATION_DIR });
}

let db: ReturnType<typeof drizzle>;
let store: DrizzleLedgerStore;

beforeAll(async () => {
  const client = new PGlite();
  await applyMigrations(client);
  db = drizzle(client);
  store = new DrizzleLedgerStore(db as never);
}, 60_000);

describe("마이그레이션이 실제 Postgres 에서 실행된다", () => {
  it("원장 테이블이 만들어졌다", async () => {
    expect(await store.listEntries()).toEqual([]);
  });

  it("두 번 적용해도 안전하다 — 배포마다 돌기 때문이다", async () => {
    const client = new PGlite();
    await applyMigrations(client);
    // 같은 폴더를 다시 적용한다. journal 이 적용분을 기억하므로 아무 일도 없어야 한다
    await expect(applyMigrations(client)).resolves.toBeUndefined();
  }, 60_000);
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
    await applyMigrations(client);
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

describe("Postgres 원장 수정 결과와 낙관적 잠금", () => {
  it("실제 저장 성공을 반환하고 오래된 버전은 거절한다", async () => {
    const original = (await store.listEntries())[0];
    const updated = { ...original, version: original.version + 1 };
    expect(await store.replaceEntry(updated, original.version)).toEqual(
      updated
    );
    expect((await store.getEntry(original.code))?.version).toBe(
      updated.version
    );
    expect(
      await store.replaceEntry({ ...updated, amount: 123 }, original.version)
    ).toBeUndefined();
    expect((await store.getEntry(original.code))?.amount).toBe(original.amount);
  });
});

describe("차입 금리 저장", () => {
  it("소수 금리를 반올림하지 않고 되읽는다", async () => {
    await store.upsertDebt({
      id: "decimal-rate",
      code: "RATE-TEST",
      creditor: "테스트",
      principal: 1000000,
      rate: 4.125,
      maturityDate: "2026-09-30",
      repayType: "일시상환",
      isRelatedParty: false,
      monthlyInterest: null,
      term: "단기",
      docUrl: null,
    });
    expect(
      (await store.listDebts()).find(d => d.id === "decimal-rate")?.rate
    ).toBe(4.125);
  });
});

describe("실제 입출금 확인이 Postgres 에 저장된다", () => {
  /*
   * 다른 테스트는 전부 메모리 저장소로 돈다. 새 테이블은 **DB 를 붙인 다음에야**
   * 터지므로 여기서 실제 엔진에 대고 한 번 통과시킨다 — 특히 부분 유니크
   * 인덱스(`bankRef`)는 메모리 저장소에 아예 없는 개념이다.
   */
  const line = (over: Partial<Settlement>): Settlement => ({
    id: randomUUID(),
    entryId: "entry-x",
    settledOn: "2026-09-14",
    amount: 1_000_000,
    bankAccount: "1110-01",
    bankRef: null,
    note: null,
    actor: "cfo@dinostudio.kr",
    at: "2026-09-14T10:00:00+09:00",
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    ...over,
  });

  it("넣고 읽으면 같은 값이 돌아온다 — 날짜·무효 표시 포함", async () => {
    const row = line({ bankRef: `IBK-${randomUUID().slice(0, 8)}` });
    await store.appendSettlement(row);
    const back = (await store.listSettlements("entry-x")).find(
      x => x.id === row.id
    );
    expect(back).toBeTruthy();
    expect(back!.amount).toBe(1_000_000);
    expect(back!.settledOn).toBe("2026-09-14");
    expect(back!.voidedAt).toBeNull();
  }, 60_000);

  it("무효 처리는 줄을 지우지 않고 표시만 바꾼다 (원칙 9)", async () => {
    const row = line({});
    await store.appendSettlement(row);
    const voided = {
      ...row,
      voidedAt: "2026-09-15T09:00:00+09:00",
      voidedBy: "cfo@dinostudio.kr",
      voidReason: "착오",
    };
    expect(await store.replaceSettlement(voided)).toBeTruthy();
    const back = (await store.listSettlements("entry-x")).find(
      x => x.id === row.id
    );
    expect(back!.voidedAt).not.toBeNull();
    expect(back!.voidReason).toBe("착오");
  }, 60_000);

  it("**같은 은행 거래번호는 DB 가 거부한다** — 서비스 검사가 뚫려도 막힌다", async () => {
    const ref = `IBK-${randomUUID().slice(0, 8)}`;
    await store.appendSettlement(line({ bankRef: ref }));
    await expect(
      store.appendSettlement(line({ bankRef: ref }))
    ).rejects.toThrow();
  }, 60_000);

  it("무효 처리한 거래번호는 자리를 비워 준다 — 다시 쓸 수 있어야 한다", async () => {
    const ref = `IBK-${randomUUID().slice(0, 8)}`;
    const first = line({ bankRef: ref });
    await store.appendSettlement(first);
    await store.replaceSettlement({
      ...first,
      voidedAt: "2026-09-15T09:00:00+09:00",
      voidedBy: "cfo@dinostudio.kr",
      voidReason: "건을 잘못 골랐다",
    });
    // 부분 유니크 인덱스라 무효 줄은 자리를 차지하지 않는다
    await expect(
      store.appendSettlement(line({ bankRef: ref }))
    ).resolves.not.toThrow();
  }, 60_000);
});

describe("동시 확인이 실제 Postgres 에서도 막힌다 (QA-002)", () => {
  /*
   * 메모리 저장소는 `await` 가 없는 블록으로 원자성을 얻지만, 운영은 **여러
   * 서버리스 인스턴스**가 동시에 같은 건을 건드린다. 그때 막는 것은 조건부
   * INSERT 한 문장이다 — 이건 실제 엔진에 대고 확인해야 의미가 있다.
   */
  const line = (id: string, entryId: string, amount: number): Settlement => ({
    id,
    entryId,
    settledOn: "2026-09-14",
    amount,
    bankAccount: null,
    bankRef: null,
    note: null,
    actor: "cfo@dinostudio.kr",
    at: "2026-09-14T10:00:00+09:00",
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
  });

  it("**한도를 넘는 동시 삽입은 하나만 들어간다**", async () => {
    const entryId = randomUUID(); // varchar(36) — 접두사를 붙이면 넘친다
    const results = await Promise.all([
      store.appendSettlementGuarded(line(randomUUID(), entryId, 600), 1_000),
      store.appendSettlementGuarded(line(randomUUID(), entryId, 600), 1_000),
    ]);
    expect(results.filter(r => r.inserted).length).toBe(1);

    const rows = (await store.listSettlements(entryId)).filter(
      r => r.voidedAt == null
    );
    expect(rows.reduce((n, r) => n + r.amount, 0)).toBe(600);
  }, 60_000);

  it("한도 안이면 둘 다 들어간다 — 분할 지급은 막지 않는다", async () => {
    const entryId = randomUUID(); // varchar(36) — 접두사를 붙이면 넘친다
    const results = await Promise.all([
      store.appendSettlementGuarded(line(randomUUID(), entryId, 400), 1_000),
      store.appendSettlementGuarded(line(randomUUID(), entryId, 400), 1_000),
    ]);
    expect(results.filter(r => r.inserted).length).toBe(2);
  }, 60_000);

  it("무효 처리된 줄은 한도를 다시 열어 준다", async () => {
    const entryId = randomUUID(); // varchar(36) — 접두사를 붙이면 넘친다
    const first = line(randomUUID(), entryId, 1_000);
    expect((await store.appendSettlementGuarded(first, 1_000)).inserted).toBe(
      true
    );
    // 꽉 찼으므로 더 못 넣는다
    expect(
      (
        await store.appendSettlementGuarded(
          line(randomUUID(), entryId, 1),
          1_000
        )
      ).inserted
    ).toBe(false);

    await store.voidSettlementIfLive(first.id, {
      voidedAt: "2026-09-15T09:00:00+09:00",
      voidedBy: "cfo@dinostudio.kr",
      voidReason: "착오",
    });
    expect(
      (
        await store.appendSettlementGuarded(
          line(randomUUID(), entryId, 1_000),
          1_000
        )
      ).inserted
    ).toBe(true);
  }, 60_000);

  it("**동시 취소는 하나만 성공한다**", async () => {
    const entryId = randomUUID(); // varchar(36) — 접두사를 붙이면 넘친다
    const row = line(randomUUID(), entryId, 500);
    await store.appendSettlementGuarded(row, 1_000);
    const patch = {
      voidedAt: "2026-09-15T09:00:00+09:00",
      voidedBy: "cfo@dinostudio.kr",
      voidReason: "착오",
    };
    const both = await Promise.all([
      store.voidSettlementIfLive(row.id, patch),
      store.voidSettlementIfLive(row.id, patch),
    ]);
    expect(both.filter(Boolean).length).toBe(1);
  }, 60_000);
});

/**
 * QA-004 — 알림 발송 선점이 실제 Postgres 에서도 하나만 통과한다.
 *
 * 메모리 저장소의 검증은 「한 프로세스 안에서」만 의미가 있다. 운영은 화면과
 * 크론이 **다른 서버리스 인스턴스**에서 같은 순간에 같은 알림을 집는다.
 * 그때 막는 것은 `INSERT ... ON CONFLICT DO UPDATE ... WHERE` 한 문장이다.
 */
describe("알림 발송 선점이 실제 Postgres 에서도 하나만 통과한다 (QA-004)", () => {
  const note = (id: string) => ({
    id,
    ruleId: "R-T3-01",
    title: "가용자금 음수",
    body: "P0까지 부족합니다",
    screen: null,
    sentAt: null,
    sendAttempts: 0,
    lastError: null,
    lastAttemptAt: null,
    leaseUntil: null,
    readAt: null,
    createdAt: "2026-09-21T00:00:00.000Z",
  });
  const at = (iso: string, plusMs: number) =>
    new Date(Date.parse(iso) + plusMs).toISOString();
  const T0 = "2026-09-21T00:00:00.000Z";

  it("**동시에 집으면 하나만 성공한다**", async () => {
    const n = note(randomUUID());
    const opts = {
      now: T0,
      leaseUntil: at(T0, 120_000),
      maxAttempts: 3,
    };
    const both = await Promise.all([
      store.claimNotification(n, opts),
      store.claimNotification(n, opts),
    ]);
    expect(both.filter(r => r.claimed).length).toBe(1);
    // 진 쪽도 현재 상태를 받는다 — 화면에 「안 갔다」로 보이면 안 된다
    expect(both.every(r => r.current.id === n.id)).toBe(true);
  }, 60_000);

  it("임대가 지나야 다시 집힌다 — 보내다 죽은 건이 갇히지 않는다", async () => {
    const n = note(randomUUID());
    await store.claimNotification(n, {
      now: T0,
      leaseUntil: at(T0, 120_000),
      maxAttempts: 3,
    });
    // 임대 중에는 못 집는다
    expect(
      (
        await store.claimNotification(n, {
          now: at(T0, 1_000),
          leaseUntil: at(T0, 121_000),
          maxAttempts: 3,
        })
      ).claimed
    ).toBe(false);
    // 지나면 집힌다
    const later = await store.claimNotification(n, {
      now: at(T0, 180_000),
      leaseUntil: at(T0, 300_000),
      maxAttempts: 3,
    });
    expect(later.claimed).toBe(true);
    expect(later.current.sendAttempts).toBe(2);
  }, 60_000);

  it("**성공한 뒤에는 임대가 풀려도 다시 안 집는다**", async () => {
    const n = note(randomUUID());
    await store.claimNotification(n, {
      now: T0,
      leaseUntil: at(T0, 120_000),
      maxAttempts: 3,
    });
    const released = await store.releaseNotification(n.id, {
      sentAt: at(T0, 500),
      lastError: null,
    });
    expect(released.sentAt).not.toBeNull();
    expect(released.leaseUntil).toBeNull();

    expect(
      (
        await store.claimNotification(n, {
          now: at(T0, 3_600_000),
          leaseUntil: at(T0, 3_720_000),
          maxAttempts: 3,
        })
      ).claimed
    ).toBe(false);
  }, 60_000);

  it("**늦게 온 실패가 먼저 온 성공을 지우지 않는다**", async () => {
    const n = note(randomUUID());
    await store.claimNotification(n, {
      now: T0,
      leaseUntil: at(T0, 120_000),
      maxAttempts: 3,
    });
    await store.releaseNotification(n.id, {
      sentAt: at(T0, 500),
      lastError: null,
    });
    const after = await store.releaseNotification(n.id, {
      sentAt: null,
      lastError: "channel_not_found",
    });
    expect(after.sentAt).not.toBeNull();
    expect(after.lastError).toBeNull();
  }, 60_000);

  it("시도 횟수를 다 쓰면 임대가 지나도 안 집는다", async () => {
    const n = note(randomUUID());
    for (let i = 0; i < 3; i += 1) {
      const claim = await store.claimNotification(n, {
        now: at(T0, i * 200_000),
        leaseUntil: at(T0, i * 200_000 + 120_000),
        maxAttempts: 3,
      });
      expect(claim.claimed).toBe(true);
      await store.releaseNotification(n.id, {
        sentAt: null,
        lastError: "channel_not_found",
      });
    }
    const exhausted = await store.claimNotification(n, {
      now: at(T0, 900_000),
      leaseUntil: at(T0, 1_020_000),
      maxAttempts: 3,
    });
    expect(exhausted.claimed).toBe(false);
    expect(exhausted.current.sendAttempts).toBe(3);
  }, 60_000);
});
