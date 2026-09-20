import { describe, expect, it } from "vitest";
import { LedgerService, type Actor } from "./service.js";
import { InMemoryLedgerStore } from "./store.js";
import type { Debt } from "../../shared/erp/index.js";
const ceo: Actor = { id: "test-ceo", role: "대표" };
const row: Debt = {
  id: "test-debt",
  code: "LOAN-TEST",
  creditor: "테스트 채권자",
  principal: 50000000,
  rate: 4.5,
  maturityDate: "2026-09-30",
  repayType: "일시상환",
  isRelatedParty: false,
  monthlyInterest: null,
  term: "단기",
  docUrl: null,
};

describe("차입 입력", () => {
  it("소수 금리와 미확인 월 이자를 보존하고 수정 전후를 기록한다", async () => {
    const store = new InMemoryLedgerStore();
    const service = new LedgerService(store);
    await service.upsertMaster("debt", row, ceo);
    await service.upsertMaster("debt", { ...row, rate: 4.25 }, ceo);
    expect((await store.listDebts()).find(d => d.id === row.id)).toMatchObject({
      rate: 4.25,
      monthlyInterest: null,
    });
    const log = (await store.listAudit()).find(
      a => a.rowId === row.id && (a.before as Debt)?.rate === 4.5
    );
    expect(log?.after).toMatchObject({ rate: 4.25 });
  });
  it("권한 없는 역할과 잘못된 날짜·금액·코드 중복을 거부한다", async () => {
    const service = new LedgerService(new InMemoryLedgerStore());
    await expect(
      service.upsertMaster("debt", row, {
        id: "staff",
        role: "담당자",
      } as Actor)
    ).rejects.toMatchObject({ code: "forbidden_field" });
    await expect(
      service.upsertMaster("debt", { ...row, maturityDate: "2026-02-30" }, ceo)
    ).rejects.toMatchObject({ code: "invalid_transition" });
    await expect(
      service.upsertMaster("debt", { ...row, principal: -1 }, ceo)
    ).rejects.toMatchObject({ code: "invalid_transition" });
    await service.upsertMaster("debt", row, ceo);
    await expect(
      service.upsertMaster("debt", { ...row, id: "other" }, ceo)
    ).rejects.toMatchObject({ code: "duplicate_suspected" });
  });
  it("존재하는 차입의 상환 일정만 저장해 13주 계획에 제공한다", async () => {
    const service = new LedgerService(new InMemoryLedgerStore());
    const schedule = {
      id: "schedule-test",
      debtId: row.id,
      dueDate: "2026-09-30",
      principal: 50000000,
      interest: 493151,
    };
    await expect(
      service.upsertMaster("debtSchedule", schedule, ceo)
    ).rejects.toMatchObject({ code: "not_found" });
    await service.upsertMaster("debt", row, ceo);
    await service.upsertMaster("debtSchedule", schedule, ceo);
    expect((await service.debt()).schedules).toContainEqual(schedule);
  });
});
