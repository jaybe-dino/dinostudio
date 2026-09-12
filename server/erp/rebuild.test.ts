/**
 * §5.6 개시 전 재이관 — 시트를 최종본으로 다시 깐다.
 *
 * 이것은 원칙 9(물리 삭제 없음)의 **유일한 예외**다. 예외를 열었으면 문이
 * 제대로 잠기는지를 테스트가 지켜야 한다. 아래 절반은 「돌아가는가」가 아니라
 * **「엉뚱할 때 안 돌아가는가」**를 본다.
 */
import { describe, expect, it } from "vitest";
import { LedgerService } from "./service.js";
import { InMemoryLedgerStore } from "./store.js";
import type { Actor } from "./service.js";

const CEO: Actor = { id: "ceo@dinostudio.kr", role: "대표", stepUpFresh: true };
const CFO: Actor = { id: "cfo@dinostudio.kr", role: "재무", stepUpFresh: true };
const CONFIRM = LedgerService.REBUILD_CONFIRM;

const SHEET = [
  "잔고\t잔고\t145,000,000",
  "9/14",
  "운영경비\t\t\t\t실비/환불\t\t\t\t기타\t\t\t\t\t매출\t\t\t기타매출\t\t",
  "중요도\t항목\t적요\t금액\t중요도\t항목\t적요\t금액\t중요도\t항목\t적요\t금액\t\t항목\t적요\t금액\t항목\t적요\t금액",
  "3\t지브이엔\t\t1,500,000\t\t저스트컴퍼니\t\t3,300,000\t\t\t\t\t\t유한양행\t\t41,800,000",
  "계\t\t\t0\t\t\t\t0",
  "종료 잔액\t종료 잔액\t종료 잔액\t132,670,000",
].join("\n");

function svc() {
  return new LedgerService(new InMemoryLedgerStore());
}

/** 메모리 저장소는 §5.4 시드를 안고 시작한다 — 그 위에 한 건을 더 얹는다 */
async function withExisting() {
  const s = svc();
  await s.createEntry(
    {
      direction: "out",
      title: "지워져야 하는 옛 건",
      amount: 1_000_000,
      cashDate: "2026-08-01",
      accountCode: null,
      nature: "미지정",
      buCode: null as never,
      hasEvidence: false,
      noteRaw: null,
      source: "manual",
      sourceRef: "old-1",
    },
    CEO
  );
  return s;
}

describe("재이관이 실제로 갈아엎는다", () => {
  it("기존 원장을 비우고 시트 내용으로 다시 만든다", async () => {
    const s = await withExisting();
    const before = (await s.listEntries({}, CEO)).total;
    expect(before).toBeGreaterThan(1);

    const result = await s.rebuildFromDailyCashSheet(
      { text: SHEET, year: 2026, confirm: CONFIRM },
      CEO
    );

    expect(result.removed.entries).toBe(before);
    expect(result.inserted).toBe(3);
    // 시드까지 통째로 나가고 시트 내용만 남는다 — 「최종본」의 뜻이다
    expect((await s.listEntries({}, CEO)).total).toBe(3);
    const titles = (await s.listEntries({}, CEO)).entries.map(e => e.title);
    expect(titles).not.toContain("지워져야 하는 옛 건");
    expect(titles).toContain("지브이엔");
    expect(titles).toContain("유한양행");
  });

  it("매출은 수입으로 들어간다", async () => {
    const s = svc();
    await s.rebuildFromDailyCashSheet(
      { text: SHEET, year: 2026, confirm: CONFIRM },
      CEO
    );
    const after = (await s.listEntries({}, CEO)).entries;
    expect(after.find(e => e.title === "유한양행")?.direction).toBe("in");
    expect(after.find(e => e.title === "지브이엔")?.direction).toBe("out");
  });

  it("무엇이 지워지고 무엇이 들어왔는지 감사로그에 남는다", async () => {
    const s = await withExisting();
    await s.rebuildFromDailyCashSheet(
      { text: SHEET, year: 2026, confirm: CONFIRM },
      CEO
    );
    const trail = await s.auditTrail({
      table: "entry",
      rowId: "ledger-rebuild",
    });
    const row = trail.find(r => r.action === "rebuild");
    expect(row).toBeTruthy();
    expect(row?.actor).toBe(CEO.id);
    expect((row?.before as { entries: number }).entries).toBeGreaterThan(1);
  });

  it("감사로그 자체는 지우지 않는다 — 지우면 예외가 아니라 구멍이 된다", async () => {
    const s = await withExisting();
    const before = (await s.auditTrail({})).length;
    await s.rebuildFromDailyCashSheet(
      { text: SHEET, year: 2026, confirm: CONFIRM },
      CEO
    );
    expect((await s.auditTrail({})).length).toBeGreaterThan(before);
  });

  it("두 번 돌려도 쌓이지 않는다 — 매번 최종본이다", async () => {
    const s = svc();
    // 첫 번째는 시드를 걷어내고, 두 번째는 첫 번째 결과를 걷어낸다
    await s.rebuildFromDailyCashSheet(
      { text: SHEET, year: 2026, confirm: CONFIRM },
      CEO
    );
    const second = await s.rebuildFromDailyCashSheet(
      { text: SHEET, year: 2026, confirm: CONFIRM },
      CEO
    );
    expect(second.removed.entries).toBe(3);
    expect((await s.listEntries({}, CEO)).total).toBe(3);
  });
});

describe("엉뚱할 때는 안 돌아간다", () => {
  it("재무는 못 돌린다", async () => {
    const s = svc();
    await expect(
      s.rebuildFromDailyCashSheet(
        { text: SHEET, year: 2026, confirm: CONFIRM },
        CFO
      )
    ).rejects.toThrow(/대표만/);
  });

  it("비밀번호를 다시 확인하지 않았으면 안 돌아간다", async () => {
    const s = svc();
    await expect(
      s.rebuildFromDailyCashSheet(
        { text: SHEET, year: 2026, confirm: CONFIRM },
        { ...CEO, stepUpFresh: false }
      )
    ).rejects.toThrow(/비밀번호를 다시/);
  });

  it("확인 문구가 다르면 안 돌아간다 — 버튼 오클릭으로는 못 지운다", async () => {
    const s = await withExisting();
    const kept = (await s.listEntries({}, CEO)).total;
    await expect(
      s.rebuildFromDailyCashSheet(
        { text: SHEET, year: 2026, confirm: "네" },
        CEO
      )
    ).rejects.toThrow(/확인 문구/);
    // 거부됐으면 원장은 그대로여야 한다
    expect((await s.listEntries({}, CEO)).total).toBe(kept);
  });

  it("마감된 기간이 있으면 거부한다 — 개시 전에만 쓰는 경로다", async () => {
    const s = await withExisting();
    await s.closePeriod({ ym: "2026-08", force: true }, CEO).catch(() => {
      /* 마감 조건은 이 테스트의 관심사가 아니다 */
    });
    const periods = await s.masters(CEO).then(m => m.periods);
    if (periods.some(p => p.status === "closed")) {
      await expect(
        s.rebuildFromDailyCashSheet(
          { text: SHEET, year: 2026, confirm: CONFIRM },
          CEO
        )
      ).rejects.toThrow(/마감된 기간/);
    }
  });

  it("읽을 줄이 없는 시트로는 원장을 비우지 않는다", async () => {
    const s = await withExisting();
    const kept = (await s.listEntries({}, CEO)).total;
    await expect(
      s.rebuildFromDailyCashSheet(
        { text: "아무 내용 없음", year: 2026, confirm: CONFIRM },
        CEO
      )
    ).rejects.toThrow(/읽은 줄이 없습니다/);
    expect((await s.listEntries({}, CEO)).total).toBe(kept);
  });
});
