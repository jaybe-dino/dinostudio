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
const VP: Actor = { id: "vp@dinostudio.kr", role: "부대표" };
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

/**
 * 그 「개인 식별」 표시는 **아무도 켤 수 없었다.**
 *
 * `maskEntryForRole` 의 두 번째 갈래는 `entry.isPersonal` 을 본다. 그런데
 * `createEntry` 는 그 값을 `false` 로 박아 넣고 있었고, 시트 이관도 Slack
 * 수집도 마찬가지였다. 즉 시드에 손으로 적은 두 줄 말고는 **운영에서 이
 * 표시가 붙을 길이 없었다** — 규칙은 있는데 켜는 스위치가 없었던 것이다.
 */
describe("개인 식별 표시 — 켤 수 있어야 규칙이 산다", () => {
  it("만들 때 켤 수 있다", async () => {
    const svc = service();
    const created = await svc.createEntry(
      {
        direction: "out",
        title: "9월 급여 (김OO)",
        amount: 3_100_000,
        cashDate: "2026-09-25",
        accountCode: "6110",
        isPersonal: true,
      },
      CFO
    );
    // 만든 사람에게도 금액이 안 나간다 — 원칙 10 은 역할을 가리지 않는다
    const { entry } = await svc.getEntry(created.entry.code, CFO);
    expect(entry.isPersonal).toBe(true);
    expect(entry.amount).toBeNull();
    expect((entry as { masked?: boolean }).masked).toBe(true);
  });

  it("안 켜면 종전대로다 — 총액 일괄 건은 재무가 금액을 본다", async () => {
    const svc = service();
    const created = await svc.createEntry(
      {
        direction: "out",
        title: "9월 급여 일괄",
        amount: 4_800_000,
        cashDate: "2026-09-25",
        accountCode: "6110",
      },
      CFO
    );
    const { entry } = await svc.getEntry(created.entry.code, CFO);
    expect(entry.isPersonal).toBe(false);
    expect(entry.amount).toBe(4_800_000);
  });

  it("**끄는 것만 급여 권한을 본다** — 켜는 쪽은 손해가 없다", async () => {
    const svc = service();
    const code = "EX-260827-02"; // 시드의 개인 식별 건
    const before = await svc.getEntry(code, CFO);
    expect(before.entry.isPersonal).toBe(true);

    /*
     * 부대표로 본다 — 건 자체는 수정할 수 있는 역할이어야 이 규칙이 검증된다.
     * 담당자로 하면 본인 입력분이 아니라서 범위(QA-001)에 먼저 막혀, 통과해도
     * 「급여 권한 때문에 막혔다」를 증명하지 못한다.
     */
    await expect(
      svc.patchEntry(
        code,
        { isPersonal: false },
        before.entry.version,
        VP,
        "열람 필요"
      )
    ).rejects.toMatchObject({ code: "forbidden_field" });

    // 같은 역할이 다른 칸은 고칠 수 있다 — 막힌 것이 개인 표시라는 뜻이다
    await expect(
      svc.patchEntry(
        code,
        { title: "9월 급여" },
        before.entry.version,
        VP,
        "정정"
      )
    ).resolves.toBeDefined();
    const bumped = await svc.getEntry(code, CFO);

    // 급여 쓰기 권한이 있는 재무는 연다
    const opened = await svc.patchEntry(
      code,
      { isPersonal: false },
      bumped.entry.version,
      CFO,
      "총액 일괄로 정정"
    );
    expect(opened.entry.isPersonal).toBe(false);
  });

  it("켜는 것은 급여 권한이 없어도 된다", async () => {
    const svc = service();
    const created = await svc.createEntry(
      {
        direction: "out",
        title: "9월 급여 일괄",
        amount: 2_000_000,
        cashDate: "2026-09-25",
        accountCode: "6110",
      },
      STAFF
    );
    const { entry } = await svc.getEntry(created.entry.code, STAFF);
    const patched = await svc.patchEntry(
      entry.code,
      { isPersonal: true },
      entry.version,
      STAFF,
      "개인 건이었다"
    );
    expect(patched.entry.isPersonal).toBe(true);
  });
});
