/**
 * §5 초기 데이터 이관 — 시드 적재 스크립트.
 *
 *   DATABASE_URL=... npx tsx server/erp/seedDb.ts          # 적재 + V1~V8 검증 리포트
 *   DATABASE_URL=... npx tsx server/erp/seedDb.ts --check  # 적재하지 않고 검증만
 *
 * 이미 있는 코드는 건드리지 않습니다 — 재이관 기능은 제공하지 않습니다 (§5.6).
 */
import "dotenv/config";
import {
  ACCOUNTS,
  SEED_DAY_SNAPSHOTS,
  SEED_ENTRIES,
  SEED_SETTINGS,
  runMigrationChecks,
} from "../../shared/erp/index.js";
import { drizzle } from "drizzle-orm/mysql2";
import {
  erpAccounts,
  erpDaySnapshots,
  erpEntries,
  erpSettings,
} from "../../drizzle/erpSchema.js";
import { DrizzleLedgerStore } from "./drizzleStore.js";

async function main() {
  const checkOnly = process.argv.includes("--check");
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL이 필요합니다.");
    process.exit(1);
  }

  const db = drizzle(url);
  const store = new DrizzleLedgerStore(db);

  if (!checkOnly) {
    // 계정과목 마스터 (§8.1 초기 적재)
    for (const account of ACCOUNTS) {
      await db
        .insert(erpAccounts)
        .values(account)
        .onDuplicateKeyUpdate({
          set: {
            name: account.name,
            type: account.type,
            cfSection: account.cfSection,
            isOpex: account.isOpex,
            defaultPriority: account.defaultPriority,
            active: account.active,
          },
        });
    }
    console.log(`계정과목 ${ACCOUNTS.length}개 적재`);

    // 이관 구간 일계 (§5.4 가)
    for (const snapshot of SEED_DAY_SNAPSHOTS) {
      await db
        .insert(erpDaySnapshots)
        .values({
          date: snapshot.date,
          open: snapshot.open,
          inSum: snapshot.inSum,
          outSum: snapshot.outSum,
          close: snapshot.close,
          sheetOpen: snapshot.sheetOpen ?? null,
          sheetClose: snapshot.sheetClose ?? null,
          note: snapshot.note,
          isMigrated: snapshot.isMigrated,
        })
        .onDuplicateKeyUpdate({ set: { note: snapshot.note } });
    }
    console.log(`이관 일계 ${SEED_DAY_SNAPSHOTS.length}행 적재`);

    // 건별 원장 (§5.4 나) — 코드 재사용 금지이므로 기존 건은 건너뛴다
    const existing = new Set((await store.listEntries()).map(e => e.code));
    let inserted = 0;
    for (const entry of SEED_ENTRIES) {
      if (existing.has(entry.code)) continue;
      await db
        .insert(erpEntries)
        .values({ ...entry, createdAt: new Date(entry.createdAt) });
      inserted += 1;
    }
    console.log(`원장 ${inserted}건 적재 (기존 ${existing.size}건 유지)`);

    for (const setting of SEED_SETTINGS) {
      await db
        .insert(erpSettings)
        .values({
          key: setting.key,
          value: setting.value,
          isProvisional: setting.isProvisional,
          ownerRole: setting.ownerRole,
          updatedBy: setting.updatedBy,
        })
        .onDuplicateKeyUpdate({
          set: { isProvisional: setting.isProvisional },
        });
    }
    console.log(`설정 ${SEED_SETTINGS.length}건 적재`);
  }

  // §5.5 이관 검증 리포트 — 대표·재무 서면 확인용 (G2)
  const [entries, snapshots] = await Promise.all([
    store.listEntries(),
    store.listSnapshots(),
  ]);
  console.log(
    `\n이관 검증 리포트 — 원장 ${entries.length}건 · 일계 ${snapshots.length}행`
  );
  for (const check of runMigrationChecks(entries, snapshots)) {
    const mark =
      check.verdict === "pass"
        ? "통과"
        : check.verdict === "fail"
          ? "불일치"
          : "대상아님";
    console.log(`  ${check.id} ${mark}  ${check.name} — ${check.detail}`);
  }
  console.log(
    "\nV1·V6은 고쳐서 통과시키는 항목이 아닙니다. 불일치를 그대로 두고 8월 마감을 잠그지 않습니다."
  );
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
