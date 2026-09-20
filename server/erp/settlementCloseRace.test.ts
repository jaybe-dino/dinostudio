/**
 * QA-007 — **취소 경합이 남아 있었다.**
 *
 * 45회차에서 삽입 쪽에만 사후 확인을 붙였다. 취소 쪽은 「읽고 → 지운다」
 * 그대로였다. 마감이 **먼저 저장된 뒤에도** 그 사이에 시작한 취소가 통과해
 * 마감된 달의 집행 내역을 바꾼다.
 *
 * 사후 되돌림으로는 이걸 못 막는다 — 되돌리는 것과 애초에 안 일어나는 것은
 * 다르다. 판정은 **쓰는 문장 안에서** 일어나야 한다.
 *
 * 격리 메모리 합성 데이터. 운영 변경 없음.
 */
import { describe, expect, it } from "vitest";
import { LedgerService } from "./service.js";
import { InMemoryLedgerStore } from "./store.js";
import type { Actor } from "./service.js";

const CEO: Actor = { id: "ceo@dinostudio.kr", role: "대표" };
const CFO: Actor = { id: "cfo@dinostudio.kr", role: "재무" };

async function settledEntry(svc: LedgerService) {
  const created = await svc.createEntry(
    {
      direction: "out",
      title: "합성 지출",
      amount: 1000,
      cashDate: "2026-09-20",
      accrualDate: "2026-09-20",
      accountCode: "6510",
      hasEvidence: true,
    },
    CFO
  );
  const { entry } = await svc.getEntry(created.entry.code, CFO);
  const approved = await svc.approve(entry.code, entry.version, CEO);
  const settled = await svc.settleEntry(
    { code: entry.code, settledOn: "2026-09-20", amount: 1000 },
    approved.entry.version,
    CFO
  );
  return { code: entry.code, settlement: settled.settlement };
}

const closeSeptember = (store: InMemoryLedgerStore) =>
  store.upsertPeriod({
    ym: "2026-09",
    status: "closed",
    closedBy: CEO.id,
    closedAt: "2026-09-20T12:00:00+09:00",
    blockers: [],
  });

describe("QA-007 취소 경합 — 마감이 먼저 저장돼도 취소가 통과했다", () => {
  it("**쓰기 직전에 마감이 끝나면 취소가 거절된다**", async () => {
    const store = new InMemoryLedgerStore();
    const svc = new LedgerService(store);
    const { code, settlement } = await settledEntry(svc);

    /*
     * 서비스의 사전 검사는 이미 지났다. 실제 쓰기 **직전**에 마감을 끝낸다 —
     * QA 가 재현한 그 순서다.
     */
    const original = store.voidSettlementIfLive.bind(store);
    store.voidSettlementIfLive = async (id, patch) => {
      await closeSeptember(store);
      return original(id, patch);
    };

    await expect(
      svc.voidSettlement({ settlementId: settlement.id, reason: "착오" }, CFO)
    ).rejects.toMatchObject({ code: "period_closed" });

    // 마감된 달의 집행 내역은 그대로여야 한다
    const after = await svc.settlements(code, CFO);
    expect(after.summary.settled).toBe(1000);
    expect(after.rows[0].voidedAt).toBeNull();
  });

  it("삽입 경합도 **줄이 들어가기 전에** 막힌다 — 되돌린 흔적이 남지 않는다", async () => {
    const store = new InMemoryLedgerStore();
    const svc = new LedgerService(store);
    const created = await svc.createEntry(
      {
        direction: "out",
        title: "합성 지출",
        amount: 1000,
        cashDate: "2026-09-20",
        accrualDate: "2026-09-20",
        accountCode: "6510",
        hasEvidence: true,
      },
      CFO
    );
    const { entry } = await svc.getEntry(created.entry.code, CFO);
    const approved = await svc.approve(entry.code, entry.version, CEO);

    const original = store.appendSettlementGuarded.bind(store);
    store.appendSettlementGuarded = async (line, max) => {
      await closeSeptember(store);
      return original(line, max);
    };

    await expect(
      svc.settleEntry(
        { code: entry.code, settledOn: "2026-09-20", amount: 1000 },
        approved.entry.version,
        CFO
      )
    ).rejects.toMatchObject({ code: "period_closed" });

    // **아무 줄도 안 들어간다.** 무효로 되돌린 줄조차 없다
    const after = await svc.settlements(entry.code, CFO);
    expect(after.rows).toEqual([]);
    expect(after.summary.settled).toBe(0);
  });

  it("마감이 없으면 취소도 삽입도 그대로 된다", async () => {
    const store = new InMemoryLedgerStore();
    const svc = new LedgerService(store);
    const { code, settlement } = await settledEntry(svc);
    await svc.voidSettlement(
      { settlementId: settlement.id, reason: "착오" },
      CFO
    );
    const after = await svc.settlements(code, CFO);
    expect(after.summary.settled).toBe(0);
    expect(after.rows[0].voidedAt).not.toBeNull();
  });
});
