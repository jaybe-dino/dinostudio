/**
 * 복구 리허설 검증 — **「복구된다」는 확인 없이 백업은 백업이 아니다.**
 *
 * Neon 에서 시점 복구로 만든 **새 브랜치**에 대고 돌린다. 원장이 몇 건인지,
 * 최근 건이 언제 것인지, 스키마가 맞는지를 눈으로 확인할 수 있게 적어 준다.
 *
 *   node scripts/verify-restore.mjs "<복구 브랜치 연결 문자열>"
 *   RESTORE_DATABASE_URL="..." node scripts/verify-restore.mjs
 *
 * ⚠️ **운영 DB 에 대고 돌리지 마십시오.** 읽기만 하지만, 리허설의 목적은
 * 복구본이 쓸 만한지 보는 것이지 운영을 확인하는 것이 아니다. 연결 문자열이
 * 운영과 같으면 **거부한다** — `DATABASE_URL` 과 같으면 멈춘다.
 *
 * 이 스크립트는 **아무것도 쓰지 않는다.** SELECT 만 한다.
 */
import { neon } from "@neondatabase/serverless";

const url = process.argv[2] ?? process.env.RESTORE_DATABASE_URL;

if (!url) {
  console.error(
    [
      "복구 브랜치의 연결 문자열이 필요합니다.",
      "",
      "  node scripts/verify-restore.mjs \"postgres://...\"",
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

const sql = neon(url);
const won = n => (n == null ? "—" : Number(n).toLocaleString("ko-KR"));

/** 있어야 할 표 — 하나라도 없으면 마이그레이션이 덜 따라온 복구본이다 */
const TABLES = [
  "erp_entry",
  "erp_journal",
  "erp_journal_line",
  "erp_settlement",
  "erp_intake",
  "erp_setting",
  "erp_audit_log",
  "erp_day_snapshot",
];

async function main() {
  console.log("복구 리허설 검증\n" + "=".repeat(48));

  const present = await sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name = any(${TABLES})
  `;
  const found = new Set(present.map(r => r.table_name));
  const missing = TABLES.filter(t => !found.has(t));

  console.log("\n[1] 스키마");
  for (const t of TABLES)
    console.log(`  ${found.has(t) ? "✓" : "✗"} ${t}`);
  if (missing.length > 0) {
    console.error(
      `\n  ✗ 표 ${missing.length}개가 없습니다 — 복구 시점이 마이그레이션보다 이전입니다.`
    );
    console.error("    그 시점으로 복구하면 배포가 스키마를 다시 만듭니다.");
  }

  console.log("\n[2] 원장");
  const [{ n: entries }] = await sql`select count(*)::int as n from erp_entry`;
  const [{ n: confirmed }] = await sql`
    select count(*)::int as n from erp_entry where status = 'confirmed'
  `;
  const [{ n: undecided }] = await sql`
    select count(*)::int as n from erp_entry where status = 'undecided'
  `;
  console.log(`  전체 ${won(entries)}건 · 확정 ${won(confirmed)} · 판정 대기 ${won(undecided)}`);

  const recent = await sql`
    select code, title, "cashDate", amount, status
    from erp_entry order by "createdAt" desc limit 5
  `;
  console.log("\n  가장 최근에 들어온 5건 — 여기까지가 복구됐습니다:");
  for (const r of recent)
    console.log(
      `    ${r.code}  ${r.cashDate ?? "—"}  ${won(r.amount)}  ${r.status}  ${r.title}`
    );

  console.log("\n[3] 입출금 확인");
  if (found.has("erp_settlement")) {
    const [{ n: lines }] = await sql`
      select count(*)::int as n from erp_settlement where "voidedAt" is null
    `;
    const [{ total }] = await sql`
      select coalesce(sum(amount), 0)::bigint as total
      from erp_settlement where "voidedAt" is null
    `;
    console.log(`  살아 있는 확인 ${won(lines)}줄 · 합계 ${won(total)}`);
  } else {
    console.log("  표가 없습니다 (복구 시점이 2026-09-20 이전)");
  }

  console.log("\n[4] 감사로그 — 마지막 기록이 복구 시점입니다");
  const audits = await sql`
    select "action", "at" from erp_audit_log order by "at" desc limit 3
  `;
  for (const a of audits) console.log(`    ${a.at.toISOString?.() ?? a.at}  ${a.action}`);

  console.log("\n" + "=".repeat(48));
  if (missing.length > 0) {
    console.log("결과: 스키마가 덜 따라왔습니다. 위 내용을 보고 판단하십시오.");
    process.exit(1);
  }
  if (entries === 0) {
    console.log("결과: 원장이 비어 있습니다 — 복구 시점을 다시 보십시오.");
    process.exit(1);
  }
  console.log("결과: 복구본을 읽을 수 있습니다.");
  console.log("");
  console.log("다음 — 확인이 끝났으면 **그 브랜치를 지우십시오.**");
  console.log("리허설용 브랜치를 남겨 두면 어느 것이 운영인지 헷갈립니다.");
}

main().catch(error => {
  console.error("\n연결하거나 읽지 못했습니다:", error.message);
  console.error("연결 문자열과 복구 브랜치 상태를 확인하십시오.");
  process.exit(1);
});
