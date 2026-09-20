/**
 * §13 권한 — **서버가 거부하는가.**
 *
 * 화면에서 버튼을 숨기는 것은 권한이 아니다. 주소를 알거나 API 를 직접 부르면
 * 그대로 나온다. 그래서 여기서는 화면을 전혀 보지 않고 **서비스에 직접** 대고
 * 확인한다 — 우회로가 막혔는지가 관심사다.
 *
 * 새로 붙인 동작(입출금 확인 · 내부이체)도 같은 잣대로 본다. 새 엔드포인트가
 * 권한 검사를 빠뜨리는 것이 이런 시스템이 새는 가장 흔한 길이다.
 */
import { describe, expect, it } from "vitest";
import { LedgerService } from "./service.js";
import { InMemoryLedgerStore } from "./store.js";
import type { Actor } from "./service.js";
import {
  ROLES,
  canExport,
  isPayrollAccount,
  maskEntryForRole,
  permissionFor,
} from "../../shared/erp/index.js";

const CEO: Actor = { id: "ceo@dinostudio.kr", role: "대표", stepUpFresh: true };
const CFO: Actor = { id: "cfo@dinostudio.kr", role: "재무", stepUpFresh: true };
const LEADER: Actor = { id: "lead@dinostudio.kr", role: "사업부리더" };
const STAFF: Actor = { id: "staff@dinostudio.kr", role: "담당자" };
const TAX: Actor = { id: "tax@outside.kr", role: "외부세무" };
const VIEWER: Actor = { id: "viewer@outside.kr", role: "외부열람" };

function svc() {
  return new LedgerService(new InMemoryLedgerStore());
}

describe("급여는 역할로 가린다 — 응답 단계에서", () => {
  it("인건비 계정은 권한 없는 역할에 **금액이 안 내려간다**", () => {
    const entry = {
      accountCode: "6110",
      amount: 12_614_300,
      amountCandidate: null,
      amountSupply: null,
      amountVat: null,
      noteRaw: "예시",
      isPersonal: false,
    } as never;
    for (const role of [
      "부대표",
      "사업부리더",
      "담당자",
      "외부열람",
    ] as const) {
      const masked = maskEntryForRole(entry, role);
      expect(masked.masked).toBe(true);
      expect(masked.amount).toBeNull();
      // 원문도 같이 막는다 — 적요에 이름과 금액이 들어 있다
      expect(masked.noteRaw).toBeNull();
    }
  });

  it("**개인이 식별되면 대표·재무도 금액을 못 본다** (원칙 10)", () => {
    const entry = {
      accountCode: "6110",
      amount: 5_000_000,
      amountCandidate: null,
      amountSupply: null,
      amountVat: null,
      noteRaw: "홍길동 9월 급여",
      isPersonal: true,
    } as never;
    for (const role of ["대표", "재무"] as const) {
      const masked = maskEntryForRole(entry, role);
      expect(masked.masked).toBe(true);
      expect(masked.amount).toBeNull();
    }
  });

  it("인건비 계정 목록이 비어 있지 않다 — 비면 마스킹이 통째로 무력해진다", () => {
    expect(isPayrollAccount("6110")).toBe(true);
    expect(isPayrollAccount("5210")).toBe(false);
    expect(isPayrollAccount(null)).toBe(false);
  });
});

describe("내보내기는 화면 조회와 다른 위험이다", () => {
  it("외부열람은 보되 들고 나가지 못한다", () => {
    expect(canExport("외부열람")).toBe(false);
    for (const role of ROLES.filter(r => r !== "외부열람"))
      expect(canExport(role)).toBe(true);
  });
});

describe("읽기 전용 역할은 쓰지 못한다", () => {
  it("외부세무·외부열람은 원장 쓰기 권한이 없다", () => {
    for (const role of ["외부세무", "외부열람"] as const) {
      expect(permissionFor(role, "entry").write).toBe(false);
      expect(permissionFor(role, "entry").approve).toBe(false);
    }
  });

  it("담당자는 승인 권한이 없다 — 입력과 승인을 분리한다 (F1)", () => {
    expect(permissionFor("담당자", "entry").approve).toBe(false);
    expect(permissionFor("담당자", "entry").scope).toBe("own_input");
  });

  it("사업부리더는 자기 사업부로 범위가 좁혀진다", () => {
    expect(permissionFor("사업부리더", "entry").scope).toBe("own_bu");
  });

  it("급여·부채·기준값은 역할별로 닫혀 있다", () => {
    expect(permissionFor("사업부리더", "payroll").read).toBe(false);
    expect(permissionFor("담당자", "debt").read).toBe(false);
    expect(permissionFor("외부열람", "payroll").read).toBe(false);
    expect(permissionFor("담당자", "setting").write).toBe(false);
  });

  it("마감은 대표만 승인한다 — 재무는 요청까지", () => {
    expect(permissionFor("재무", "period_close").approve).toBe(false);
    expect(permissionFor("대표", "period_close").approve).toBe(true);
  });
});

describe("새로 붙인 동작도 서버가 막는다", () => {
  async function approved(s: LedgerService, title: string) {
    const created = await s.createEntry(
      {
        direction: "out",
        title,
        amount: 1_000_000,
        cashDate: "2026-09-14",
        accountCode: "5210",
        hasEvidence: true,
      },
      STAFF
    );
    await s.addEvidence(
      {
        code: created.entry.code,
        kind: "세금계산서",
        storage: "link",
        url: "https://drive.google.com/x",
      },
      STAFF
    );
    const ready = await s.getEntry(created.entry.code, CEO);
    await s.approve(ready.entry.code, ready.entry.version, CEO);
    return s.getEntry(created.entry.code, CEO);
  }

  it("입출금 확인 — 통장을 여는 역할만", async () => {
    const s = svc();
    const e = await approved(s, "권한 확인용 건 1");
    for (const actor of [STAFF, LEADER, TAX, VIEWER]) {
      await expect(
        s.settleEntry(
          { code: e.entry.code, settledOn: "2026-09-14", amount: 1_000_000 },
          e.entry.version,
          actor
        )
      ).rejects.toThrow(/대표·부대표·재무만/);
    }
  });

  it("입출금 확인 취소도 같은 역할만", async () => {
    const s = svc();
    const e = await approved(s, "권한 확인용 건 2");
    const done = await s.settleEntry(
      { code: e.entry.code, settledOn: "2026-09-14", amount: 1_000_000 },
      e.entry.version,
      CFO
    );
    for (const actor of [STAFF, LEADER, VIEWER]) {
      await expect(
        s.voidSettlement(
          { settlementId: done.settlement.id, reason: "임의 취소" },
          actor
        )
      ).rejects.toThrow(/대표·부대표·재무만/);
    }
  });

  it("내부 계좌이체도 같은 역할만 — 통장을 옮기는 일이다", async () => {
    const s = svc();
    for (const actor of [STAFF, LEADER, TAX, VIEWER]) {
      await expect(
        s.recordInternalTransfer(
          {
            date: "2026-09-14",
            amount: 1_000_000,
            fromAccount: "A",
            toAccount: "B",
          },
          actor
        )
      ).rejects.toThrow(/대표·부대표·재무만/);
    }
  });

  it("재이관은 대표만 — 원장을 통째로 갈아엎는다", async () => {
    const s = svc();
    for (const actor of [CFO, LEADER, STAFF])
      await expect(
        s.rebuildFromDailyCashSheet(
          { confirm: LedgerService.REBUILD_CONFIRM },
          actor
        )
      ).rejects.toThrow(/대표만/);
  });

  it("슬랙 백필은 대표만", async () => {
    const s = svc();
    await expect(s.backfillSlackHistory({ days: 7 }, CFO)).rejects.toThrow(
      /대표만/
    );
  });
});

describe("민감 원문은 재인증 없이 안 열린다 (D7)", () => {
  it("재인증이 오래된 세션은 원문을 못 연다", async () => {
    const s = svc();
    const stale: Actor = { ...CFO, stepUpFresh: false };
    await expect(s.revealIntakeRaw("any-id", stale)).rejects.toThrow(
      /비밀번호를 다시/
    );
  });

  it("**권한 검사가 존재 확인보다 먼저다** — 없는 id 로 존재 여부를 떠볼 수 없다", async () => {
    // not_found 가 먼저 나오면, 권한 없는 사람이 id 를 넣어 보며
    // 「이 건이 있는가」를 알아낼 수 있다.
    const s = svc();
    for (const actor of [LEADER, STAFF, VIEWER])
      await expect(s.revealIntakeRaw("없는-id", actor)).rejects.toThrow(
        /역할만 열 수 있습니다/
      );
  });

  it("권한이 있어도 재인증이 없으면 못 연다 — 순서가 둘 다 앞이다", async () => {
    const s = svc();
    await expect(
      s.revealIntakeRaw("없는-id", { ...CEO, stepUpFresh: false })
    ).rejects.toThrow(/비밀번호를 다시/);
  });
});
