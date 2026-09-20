/**
 * QA-006 — **마감된 달에 돈이 드나들 수 있었다.**
 *
 * `requireWritable` 은 건의 **발생월·지급예정월**만 본다. 그런데 실제로 돈이
 * 움직인 달은 `settledOn` 이고, 그 달은 아무도 안 봤다. 그래서 8월을 마감한
 * 뒤에도 「8월 31일에 나갔습니다」를 새로 적을 수 있었고, 이미 적힌 8월 확인을
 * 취소할 수도 있었다.
 *
 * **마감의 뜻이 「그 달 현금 내역은 더 안 바뀐다」이므로**, 마감 뒤에 8월
 * 현금이 바뀌면 이미 보고한 8월 잔액이 조용히 틀어진다.
 *
 * 격리된 메모리 저장소의 합성 데이터로만 돈다 — 운영 데이터가 아니다.
 */
import { describe, expect, it } from "vitest";
import { LedgerService } from "./service.js";
import { InMemoryLedgerStore } from "./store.js";
import type { Actor } from "./service.js";

const CEO: Actor = { id: "ceo@dinostudio.kr", role: "대표" };
const CFO: Actor = { id: "cfo@dinostudio.kr", role: "재무" };

const service = () => new LedgerService(new InMemoryLedgerStore());

/** 9월 발생·9월 지급예정인 승인완료 건 하나 */
async function confirmedEntry(svc: LedgerService, amount = 1000) {
  const created = await svc.createEntry(
    {
      direction: "out",
      title: "합성 지출",
      amount,
      cashDate: "2026-09-20",
      accrualDate: "2026-09-20",
      accountCode: "6510",
      hasEvidence: true,
    },
    CFO
  );
  const { entry } = await svc.getEntry(created.entry.code, CFO);
  const approved = await svc.approve(entry.code, entry.version, CEO);
  return approved.entry;
}

describe("QA-006 마감된 달에는 실제 집행을 적을 수 없다", () => {
  it("**마감된 달로 입출금 확인을 적을 수 없다**", async () => {
    const svc = service();
    const entry = await confirmedEntry(svc);
    await svc.putSetting("closed_periods", ["2026-08"], false, CEO);

    // 건 자체는 9월이라 기존 검사(발생월·지급예정월)를 통과한다.
    // 막아야 하는 것은 **실제로 돈이 움직인 달**이다.
    await expect(
      svc.settleEntry(
        { code: entry.code, settledOn: "2026-08-31", amount: 1000 },
        entry.version,
        CFO
      )
    ).rejects.toMatchObject({ code: "period_closed" });

    const after = await svc.getEntry(entry.code, CFO);
    expect(after.entry.paidAt).toBeNull();
    expect((await svc.settlements(entry.code, CFO)).rows).toEqual([]);
  });

  it("**마감 뒤에는 그 달 확인을 취소할 수도 없다**", async () => {
    const svc = service();
    const entry = await confirmedEntry(svc);

    // 8월이 열려 있을 때 적는다
    const settled = await svc.settleEntry(
      { code: entry.code, settledOn: "2026-08-31", amount: 1000 },
      entry.version,
      CFO
    );
    const line = settled.settlement;
    expect(line.settledOn).toBe("2026-08-31");

    // 그리고 8월을 마감한다
    await svc.putSetting("closed_periods", ["2026-08"], false, CEO);

    await expect(
      svc.voidSettlement({ settlementId: line.id, reason: "착오" }, CFO)
    ).rejects.toMatchObject({ code: "period_closed" });

    // 줄이 그대로 살아 있어야 한다 — 마감된 달의 현금은 안 바뀐다
    const after = await svc.settlements(entry.code, CFO);
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0].voidedAt).toBeNull();
  });

  it("열려 있는 달은 그대로 된다 — 막기만 하고 못 쓰게 만들면 안 된다", async () => {
    const svc = service();
    const entry = await confirmedEntry(svc);
    await svc.putSetting("closed_periods", ["2026-08"], false, CEO);

    const settled = await svc.settleEntry(
      { code: entry.code, settledOn: "2026-09-20", amount: 1000 },
      entry.version,
      CFO
    );
    expect(settled.settlement.settledOn).toBe("2026-09-20");
    const after = await svc.getEntry(entry.code, CFO);
    expect(after.entry.paidAt).toBe("2026-09-20");
  });

  it("기존 검사(발생월·지급예정월)는 그대로 산다", async () => {
    const svc = service();
    const created = await svc.createEntry(
      {
        direction: "out",
        title: "8월 발생 · 9월 지급",
        amount: 1000,
        cashDate: "2026-09-05",
        accrualDate: "2026-08-20",
        accountCode: "6510",
        hasEvidence: true,
      },
      CFO
    );
    await svc.putSetting("closed_periods", ["2026-08"], false, CEO);
    await expect(
      svc.patchEntry(
        created.entry.code,
        { title: "고침" },
        created.entry.version,
        CFO
      )
    ).rejects.toMatchObject({ code: "period_closed" });
  });
});

/**
 * **마감 버튼을 눌러도 그 달이 안 잠기고 있었다.**
 *
 * `closePeriod` 는 `erp_period` 행의 상태를 `closed` 로 바꾼다. 그런데 쓰기
 * 검사는 `closed_periods` **기준값**만 읽는다. 둘을 이어 주는 코드가 없어서,
 * 마감을 해도 그 달 원장이 계속 수정됐다 — 사람이 기준값을 손으로 따로 적어
 * 넣어야만 잠겼다.
 */
describe("QA-006 딸림 — 마감한 달은 마감한 것으로 친다", () => {
  /**
   * `closePeriod` 를 부르지 않고 **마감된 기간 행을 직접 넣는다.**
   *
   * 시드에는 이관 검증이 걸린 건이 있어 지금은 어느 달도 마감되지 않는다.
   * 그 상태를 기다리면 이 규칙을 영영 못 고정한다. 여기서 보려는 것은
   * 「마감을 할 수 있는가」가 아니라 **「마감된 달이 실제로 잠기는가」**다.
   */
  const withClosedMonth = (ym: string) => {
    const store = new InMemoryLedgerStore();
    return {
      store,
      close: () =>
        store.upsertPeriod({
          ym,
          status: "closed",
          closedBy: CEO.id,
          closedAt: "2026-09-01T00:00:00+09:00",
          blockers: [],
        }),
      svc: new LedgerService(store),
    };
  };

  it("**마감된 기간 행이 있으면 그 달 수정이 막힌다**", async () => {
    const { svc, close } = withClosedMonth("2026-07");
    const created = await svc.createEntry(
      {
        direction: "out",
        title: "7월 건",
        amount: 1000,
        cashDate: "2026-07-20",
        accrualDate: "2026-07-20",
        accountCode: "6510",
        hasEvidence: true,
      },
      CFO
    );
    const { entry } = await svc.getEntry(created.entry.code, CFO);
    const approved = await svc.approve(entry.code, entry.version, CEO);

    await close();

    await expect(
      svc.patchEntry(entry.code, { title: "고침" }, approved.entry.version, CFO)
    ).rejects.toMatchObject({ code: "period_closed" });
  });

  it("마감된 기간 행이 있는 달로는 입출금 확인을 적을 수 없다", async () => {
    const { svc, close } = withClosedMonth("2026-07");
    const entry = await confirmedEntry(svc);
    await close();
    await expect(
      svc.settleEntry(
        { code: entry.code, settledOn: "2026-07-31", amount: 1000 },
        entry.version,
        CFO
      )
    ).rejects.toMatchObject({ code: "period_closed" });
  });

  it("마감되지 않은(open) 기간 행은 아무것도 막지 않는다", async () => {
    const store = new InMemoryLedgerStore();
    const svc = new LedgerService(store);
    await store.upsertPeriod({
      ym: "2026-09",
      status: "open",
      closedBy: null,
      closedAt: null,
      blockers: ["판정 대기 3건"],
    });
    const entry = await confirmedEntry(svc);
    const settled = await svc.settleEntry(
      { code: entry.code, settledOn: "2026-09-20", amount: 1000 },
      entry.version,
      CFO
    );
    expect(settled.settlement.settledOn).toBe("2026-09-20");
  });
});

/**
 * **마감과 쓰기가 겹치면.**
 *
 * 사전 검사와 삽입 사이에는 틈이 있다. neon-http 는 상태가 없어 「마감 여부
 * 확인 + 삽입」을 한 트랜잭션으로 묶을 수 없으므로 그 틈을 없앨 수는 없다.
 * 여기서 보는 것은 **넘어간 것이 되돌려지는가**다.
 */
describe("QA-006 — 마감이 삽입 도중에 걸리면 되돌린다", () => {
  it("**삽입 뒤에 마감이 보이면 그 줄을 무효로 되돌리고 거절한다**", async () => {
    const store = new InMemoryLedgerStore();
    const svc = new LedgerService(store);
    const entry = await confirmedEntry(svc);

    // 삽입하는 바로 그 순간에 마감이 걸리도록 끼워 넣는다
    const original = store.appendSettlementGuarded.bind(store);
    let closedDuring = false;
    store.appendSettlementGuarded = async (line, max) => {
      const result = await original(line, max);
      if (!closedDuring) {
        closedDuring = true;
        await store.upsertPeriod({
          ym: "2026-09",
          status: "closed",
          closedBy: CEO.id,
          closedAt: "2026-09-20T12:00:00+09:00",
          blockers: [],
        });
      }
      return result;
    };

    await expect(
      svc.settleEntry(
        { code: entry.code, settledOn: "2026-09-20", amount: 1000 },
        entry.version,
        CFO
      )
    ).rejects.toMatchObject({ code: "period_closed" });

    /*
     * 줄은 **지우지 않는다** (원칙 9). 무효로 남아 「들어왔다가 마감 때문에
     * 취소됐다」가 보여야 한다. 그리고 살아 있는 합계는 0 이어야 한다 —
     * 마감된 달의 현금이 실제로는 안 바뀌었다는 뜻이다.
     */
    const rows = (await svc.settlements(entry.code, CFO)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].voidedAt).not.toBeNull();
    expect(rows[0].voidReason).toContain("마감");

    const after = await svc.getEntry(entry.code, CFO);
    expect(after.entry.paidAt).toBeNull();
  });
});
