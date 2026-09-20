/**
 * 전표에도 원칙 10 이 걸린다.
 *
 * 「개인별 급여는 **어느 화면에도** 표시하지 않는다」— 원장 목록은
 * `maskEntryForRole` 로 막혀 있었는데 **전표 화면은 그대로 열려 있었다.**
 * 전표 줄에는 계정·차변·대변이 들어 있으므로, 원장에서 가린 인건비 금액을
 * 전표 화면 경로로 그대로 읽을 수 있었다.
 *
 * 시드에는 확정된 인건비 건이 없어 이 구멍이 드러나지 않았다. 급여는 매달
 * 확정되므로 **운영 첫 달에 열린다.** 그래서 여기서는 인건비 건을 실제로
 * 확정시켜 놓고 본다.
 */
import { describe, expect, it } from "vitest";
import { LedgerService } from "./service.js";
import { InMemoryLedgerStore } from "./store.js";
import type { Actor } from "./service.js";

const CEO: Actor = { id: "ceo@dinostudio.kr", role: "대표" };
const CFO: Actor = { id: "cfo@dinostudio.kr", role: "재무" };
const STAFF: Actor = { id: "staff@dinostudio.kr", role: "담당자" };
const VIEWER: Actor = { id: "audit@x.kr", role: "외부열람" };
const TAX: Actor = { id: "tax@x.kr", role: "외부세무" };

const service = () => new LedgerService(new InMemoryLedgerStore());

/** 인건비 건 하나를 확정시켜 전표를 만든다 (총액 성격 — 개인 식별 아님) */
async function confirmPayroll(svc: LedgerService) {
  const created = await svc.createEntry(
    {
      direction: "out",
      title: "9월 급여 일괄",
      amount: 4_800_000,
      cashDate: "2026-09-25",
      accountCode: "6110",
      hasEvidence: true,
    },
    CFO
  );
  const { entry } = await svc.getEntry(created.entry.code, CFO);
  await svc.approve(entry.code, entry.version, CEO);
  return entry.code;
}

/** 시드의 개인 식별 인건비 건(EX-260827-02)을 확정시킨다 */
async function confirmPersonalPayroll(svc: LedgerService) {
  const code = "EX-260827-02";
  const first = await svc.getEntry(code, CFO);
  expect(first.entry.isPersonal).toBe(true);
  const patched = await svc.patchEntry(
    code,
    { amount: 3_200_000 },
    first.entry.version,
    CFO,
    "급여 확정"
  );
  await svc.addEvidence(
    {
      code,
      kind: "기타",
      storage: "link",
      url: "https://example.com/payslip.pdf",
    },
    CFO
  );
  const ready = await svc.getEntry(code, CFO);
  await svc.approve(code, ready.entry.version, CEO);
  void patched;
  return code;
}

async function journalCodes(svc: LedgerService, actor: Actor) {
  const { journals } = await svc.journals(actor);
  return new Set(journals.map(j => j.entryCode));
}

describe("전표 — 인건비", () => {
  it("**급여 권한이 없는 역할에는 인건비 전표가 나가지 않는다**", async () => {
    const svc = service();
    const code = await confirmPayroll(svc);

    // 권한이 있는 쪽에는 보인다 — 안 보이면 가린 게 아니라 망가뜨린 것이다
    expect(await journalCodes(svc, CFO)).toContain(code);
    expect(await journalCodes(svc, CEO)).toContain(code);
    expect(await journalCodes(svc, TAX)).toContain(code);

    // 없는 쪽에는 안 나간다
    expect(await journalCodes(svc, STAFF)).not.toContain(code);
    expect(await journalCodes(svc, VIEWER)).not.toContain(code);
  });

  it("**개인이 식별되는 인건비 건은 아무에게도 안 나간다** (원칙 10)", async () => {
    const svc = service();
    const code = await confirmPersonalPayroll(svc);
    for (const actor of [CEO, CFO, TAX, STAFF, VIEWER]) {
      expect(await journalCodes(svc, actor)).not.toContain(code);
    }
  });

  it("인건비가 아닌 전표는 누구에게도 가리지 않는다", async () => {
    const svc = service();
    const asCfo = await svc.journals(CFO);
    const asStaff = await svc.journals(STAFF);
    expect(asStaff.journals.length).toBe(asCfo.journals.length);
    expect(asStaff.hiddenCount).toBe(0);
  });

  it("가린 건수는 숫자로 알려 준다 — 조용히 사라지면 장부가 빈 것처럼 보인다", async () => {
    const svc = service();
    await confirmPayroll(svc);
    const asStaff = await svc.journals(STAFF);
    const asCfo = await svc.journals(CFO);
    expect(asStaff.hiddenCount).toBe(1);
    expect(asCfo.hiddenCount).toBe(0);
    expect(asStaff.journals.length + asStaff.hiddenCount).toBe(
      asCfo.journals.length + asCfo.hiddenCount
    );
  });

  it("**시산표는 총액이므로 남긴다** — 담당자도 인건비 총액은 본다 (T10)", async () => {
    const svc = service();
    await confirmPayroll(svc);
    const asStaff = await svc.journals(STAFF);
    const asCfo = await svc.journals(CFO);
    expect(asStaff.trialBalance.debitTotal).toBe(asCfo.trialBalance.debitTotal);
    expect(asStaff.trialBalance.difference).toBe(0);
    expect(asCfo.trialBalance.difference).toBe(0);
  });

  it("수정 대응표가 가린 전표를 참조하지 않는다", async () => {
    const svc = service();
    const code = await confirmPayroll(svc);
    // 금액을 고쳐 역분개·재분개 사슬을 만든다
    const { entry } = await svc.getEntry(code, CFO);
    await svc.patchEntry(
      code,
      { amount: 4_900_000 },
      entry.version,
      CFO,
      "정정"
    );

    const cfo = await svc.journals(CFO);
    expect(cfo.chains.length).toBeGreaterThan(0);

    const staff = await svc.journals(STAFF);
    const ids = new Set(staff.journals.map(j => j.id));
    for (const chain of staff.chains) {
      for (const row of chain.rows) expect(ids.has(row.journalId)).toBe(true);
    }
    // 사슬 자체가 인건비 건의 것이면 통째로 빠진다
    expect(staff.chains.some(c => c.baseCode === code)).toBe(false);
  });
});
