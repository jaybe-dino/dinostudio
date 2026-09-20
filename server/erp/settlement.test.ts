/**
 * §7.4 실제 입출금 확인 — **승인과 지급은 다른 사실이다.**
 *
 * 이 동작이 없어서 두 가지가 동시에 틀어져 있었다.
 *   ① 집행대기 목록이 `paidAt == null` 로 목록을 만드는데 아무도 그 칸을
 *      채울 수 없어 건이 **영원히 쌓였다**
 *   ② 승인만 하면 현금흐름 계에 들어가 **결재만 끝난 돈이 이미 통장에서
 *      빠져나간 것처럼** 잡혔다
 *
 * 아래 절반은 「된다」가 아니라 **「엉뚱할 때 안 된다」**를 본다. 돈이 실제로
 * 움직였는지를 다루는 곳이라 느슨하면 잔액이 조용히 틀어진다.
 */
import { describe, expect, it } from "vitest";
import { LedgerService } from "./service.js";
import { InMemoryLedgerStore } from "./store.js";
import type { Actor } from "./service.js";

const CEO: Actor = { id: "ceo@dinostudio.kr", role: "대표" };
const CFO: Actor = { id: "cfo@dinostudio.kr", role: "재무" };
const STAFF: Actor = { id: "staff@dinostudio.kr", role: "담당자" };
const LEADER: Actor = { id: "lead@dinostudio.kr", role: "사업부리더" };

function svc() {
  return new LedgerService(new InMemoryLedgerStore());
}

/**
 * 승인까지 끝난 건 하나 — 여기서부터가 이 파일의 관심사다.
 *
 * 항목명을 매번 다르게 둔다. 같은 이름·금액이 7일 안에 두 번 들어오면
 * 중복 탐지(T13)가 먼저 걸려 정작 보려던 것을 못 본다.
 */
let seq = 0;
async function approved(s: LedgerService, amount = 3_300_000) {
  seq += 1;
  const created = await s.createEntry(
    {
      direction: "out",
      title: `외주 대금 ${seq}`,
      amount,
      cashDate: "2026-09-14",
      accountCode: "5210",
      hasEvidence: true,
      payMethod: "계좌",
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

describe("승인은 지급이 아니다", () => {
  it("승인만으로는 지급 확인이 서지 않는다", async () => {
    const s = svc();
    const e = await approved(s);
    expect(e.entry.status).toBe("confirmed");
    // 승인은 「나가도 된다」다. 통장은 아직 그대로다
    expect(e.entry.paidAt).toBeNull();
    const view = await s.settlements(e.entry.code, CEO);
    expect(view.summary.state).toBe("미확인");
    expect(view.summary.settled).toBe(0);
  });

  it("**승인만 한 건은 집행대기에 남는다** — 예전에는 영원히 쌓이기만 했다", async () => {
    const s = svc();
    const e = await approved(s);
    const before = await s.paymentOrder(CEO);
    const codes = before.groups.flatMap(g => g.entries.map(x => x.entry.code));
    expect(codes).toContain(e.entry.code);
  });

  it("전액 확인하면 집행대기에서 빠지고 paidAt 이 선다", async () => {
    const s = svc();
    const e = await approved(s);
    const result = await s.settleEntry(
      {
        code: e.entry.code,
        settledOn: "2026-09-14",
        amount: 3_300_000,
        bankRef: "IBK-0001",
      },
      e.entry.version,
      CFO
    );
    expect(result.summary.state).toBe("확인 완료");
    expect(result.entry.paidAt).toBe("2026-09-14");

    const after = await s.paymentOrder(CEO);
    const codes = after.groups.flatMap(g => g.entries.map(x => x.entry.code));
    expect(codes).not.toContain(e.entry.code);
  });
});

describe("부분 지급", () => {
  it("절반만 나가면 **남은 금액만큼 집행대기에 남는다**", async () => {
    const s = svc();
    const e = await approved(s, 10_000_000);
    const first = await s.settleEntry(
      { code: e.entry.code, settledOn: "2026-09-14", amount: 4_000_000 },
      e.entry.version,
      CFO
    );
    expect(first.summary.state).toBe("부분 확인");
    expect(first.summary.remaining).toBe(6_000_000);
    // 다 나가지 않았으므로 paidAt 은 아직 서지 않는다
    expect(first.entry.paidAt).toBeNull();

    const order = await s.paymentOrder(CEO);
    const row = order.groups
      .flatMap(g => g.entries)
      .find(x => x.entry.code === e.entry.code);
    expect(row).toBeTruthy();
    expect(row!.settlement.remaining).toBe(6_000_000);
  });

  it("집행대기 합계는 **남은 금액**으로 낸다 — 건 금액으로 내면 필요액이 부풀어 오른다", async () => {
    // 시드 원장에 다른 건이 있으므로 절대값이 아니라 **줄어든 만큼**을 본다
    const s = svc();
    const e = await approved(s, 10_000_000);
    const sumOf = async () =>
      (await s.paymentOrder(CEO)).groups.reduce((sum, g) => sum + g.total, 0);
    const before = await sumOf();
    await s.settleEntry(
      { code: e.entry.code, settledOn: "2026-09-14", amount: 4_000_000 },
      e.entry.version,
      CFO
    );
    expect(await sumOf()).toBe(before - 4_000_000);
  });

  it("나눠서 다 채우면 마지막 확인일이 paidAt 이 된다", async () => {
    const s = svc();
    const e = await approved(s, 10_000_000);
    const a = await s.settleEntry(
      { code: e.entry.code, settledOn: "2026-09-14", amount: 4_000_000 },
      e.entry.version,
      CFO
    );
    const b = await s.settleEntry(
      { code: e.entry.code, settledOn: "2026-09-18", amount: 6_000_000 },
      a.entry.version,
      CFO
    );
    expect(b.summary.state).toBe("확인 완료");
    expect(b.entry.paidAt).toBe("2026-09-18");
    expect(b.summary.lines).toBe(2);
  });
});

describe("엉뚱할 때는 안 된다", () => {
  it("건 금액을 넘겨 확인할 수 없다", async () => {
    const s = svc();
    const e = await approved(s, 1_000_000);
    await expect(
      s.settleEntry(
        { code: e.entry.code, settledOn: "2026-09-14", amount: 1_500_000 },
        e.entry.version,
        CFO
      )
    ).rejects.toThrow(/건 금액을 넘습니다/);
  });

  it("나눠서도 넘길 수 없다 — 누계로 본다", async () => {
    const s = svc();
    const e = await approved(s, 1_000_000);
    const a = await s.settleEntry(
      { code: e.entry.code, settledOn: "2026-09-14", amount: 600_000 },
      e.entry.version,
      CFO
    );
    await expect(
      s.settleEntry(
        { code: e.entry.code, settledOn: "2026-09-14", amount: 500_000 },
        a.entry.version,
        CFO
      )
    ).rejects.toThrow(/건 금액을 넘습니다/);
  });

  it("**같은 은행 거래번호를 두 건에 붙일 수 없다** — 이중 차감이 난다", async () => {
    const s = svc();
    const first = await approved(s, 1_000_000);
    const second = await approved(s, 1_000_000);
    await s.settleEntry(
      {
        code: first.entry.code,
        settledOn: "2026-09-14",
        amount: 1_000_000,
        bankRef: "IBK-778899",
      },
      first.entry.version,
      CFO
    );
    await expect(
      s.settleEntry(
        {
          code: second.entry.code,
          settledOn: "2026-09-14",
          amount: 1_000_000,
          bankRef: "IBK-778899",
        },
        second.entry.version,
        CFO
      )
    ).rejects.toThrow(/이미 확인돼 있습니다/);
  });

  it("승인 전에는 확인할 수 없다 — 사후 추인이 되어 버린다", async () => {
    const s = svc();
    const created = await s.createEntry(
      {
        direction: "out",
        title: "미승인 건",
        amount: 500_000,
        cashDate: "2026-09-14",
        accountCode: "5210",
        hasEvidence: true,
      },
      STAFF
    );
    await expect(
      s.settleEntry(
        {
          code: created.entry.code,
          settledOn: "2026-09-14",
          amount: 500_000,
        },
        created.entry.version,
        CFO
      )
    ).rejects.toThrow(/승인이 끝난 건만/);
  });

  it("아직 오지 않은 날로는 확인할 수 없다", async () => {
    const s = svc();
    const e = await approved(s);
    await expect(
      s.settleEntry(
        { code: e.entry.code, settledOn: "2099-01-01", amount: 3_300_000 },
        e.entry.version,
        CFO
      )
    ).rejects.toThrow(/아직 오지 않은 날짜/);
  });

  it("담당자·사업부리더는 확인할 수 없다 — 통장을 보는 역할이 아니다", async () => {
    const s = svc();
    const e = await approved(s);
    for (const actor of [STAFF, LEADER]) {
      await expect(
        s.settleEntry(
          { code: e.entry.code, settledOn: "2026-09-14", amount: 3_300_000 },
          e.entry.version,
          actor
        )
      ).rejects.toThrow(/대표·부대표·재무만/);
    }
  });

  it("**같은 날·같은 금액을 두 번 확인하면 되묻는다** — 두 사람이 같은 지급을 각자 확인하는 경우다", async () => {
    /*
     * 버전 충돌로는 이걸 못 잡는다. 부분 확인은 건을 바꾸지 않으므로 두
     * 사람이 같은 화면을 열어 두고 각자 눌러도 버전이 그대로다. 그래서
     * 줄 자체의 모양으로 막는다.
     */
    const s = svc();
    const e = await approved(s, 2_000_000);
    await s.settleEntry(
      { code: e.entry.code, settledOn: "2026-09-14", amount: 1_000_000 },
      e.entry.version,
      CFO
    );
    const again = await s.getEntry(e.entry.code, CEO);
    await expect(
      s.settleEntry(
        { code: e.entry.code, settledOn: "2026-09-14", amount: 1_000_000 },
        again.entry.version,
        CEO
      )
    ).rejects.toThrow(/이미 확인돼 있습니다/);
  });

  it("정말 두 번 보냈으면 「중복 확인」으로 통과시킨다", async () => {
    // 같은 날 같은 금액을 두 번 보내는 일이 실제로 있다. 막기만 하면
    // 사람이 금액을 조작해서라도 맞추게 된다 — 그게 더 나쁘다.
    const s = svc();
    const e = await approved(s, 2_000_000);
    await s.settleEntry(
      { code: e.entry.code, settledOn: "2026-09-14", amount: 1_000_000 },
      e.entry.version,
      CFO
    );
    const again = await s.getEntry(e.entry.code, CEO);
    const second = await s.settleEntry(
      {
        code: e.entry.code,
        settledOn: "2026-09-14",
        amount: 1_000_000,
        allowDuplicate: true,
        note: "같은 날 두 번 이체",
      },
      again.entry.version,
      CFO
    );
    expect(second.summary.state).toBe("확인 완료");
    expect(second.summary.lines).toBe(2);
  });
});

describe("되돌릴 때도 지우지 않는다 (원칙 9)", () => {
  it("무효 처리하면 줄은 남고 합계에서만 빠진다", async () => {
    const s = svc();
    const e = await approved(s);
    const done = await s.settleEntry(
      { code: e.entry.code, settledOn: "2026-09-14", amount: 3_300_000 },
      e.entry.version,
      CFO
    );
    expect(done.entry.paidAt).toBe("2026-09-14");

    const undone = await s.voidSettlement(
      { settlementId: done.settlement.id, reason: "다른 건과 착오" },
      CFO
    );
    expect(undone.summary.state).toBe("미확인");
    expect(undone.summary.settled).toBe(0);
    // paidAt 도 도로 비워진다 — 아직 안 나간 돈이다
    expect(undone.entry.paidAt).toBeNull();

    // 줄 자체는 남는다. 왜 잔액이 바뀌었는지 설명할 수 있어야 한다
    const view = await s.settlements(e.entry.code, CEO);
    expect(view.rows.length).toBe(1);
    expect(view.rows[0].voidedAt).not.toBeNull();
    expect(view.rows[0].voidReason).toBe("다른 건과 착오");
  });

  it("무효 처리하면 집행대기로 돌아온다", async () => {
    const s = svc();
    const e = await approved(s);
    const done = await s.settleEntry(
      { code: e.entry.code, settledOn: "2026-09-14", amount: 3_300_000 },
      e.entry.version,
      CFO
    );
    await s.voidSettlement(
      { settlementId: done.settlement.id, reason: "착오" },
      CFO
    );
    const order = await s.paymentOrder(CEO);
    const codes = order.groups.flatMap(g => g.entries.map(x => x.entry.code));
    expect(codes).toContain(e.entry.code);
  });

  it("무효 처리한 거래번호는 다시 쓸 수 있다 — 자리를 비워 줘야 한다", async () => {
    const s = svc();
    const first = await approved(s, 1_000_000);
    const second = await approved(s, 1_000_000);
    const done = await s.settleEntry(
      {
        code: first.entry.code,
        settledOn: "2026-09-14",
        amount: 1_000_000,
        bankRef: "IBK-5555",
      },
      first.entry.version,
      CFO
    );
    await s.voidSettlement(
      { settlementId: done.settlement.id, reason: "건을 잘못 골랐다" },
      CFO
    );
    const moved = await s.settleEntry(
      {
        code: second.entry.code,
        settledOn: "2026-09-14",
        amount: 1_000_000,
        bankRef: "IBK-5555",
      },
      second.entry.version,
      CFO
    );
    expect(moved.summary.state).toBe("확인 완료");
  });

  it("사유 없이는 되돌릴 수 없다", async () => {
    const s = svc();
    const e = await approved(s);
    const done = await s.settleEntry(
      { code: e.entry.code, settledOn: "2026-09-14", amount: 3_300_000 },
      e.entry.version,
      CFO
    );
    await expect(
      s.voidSettlement({ settlementId: done.settlement.id, reason: "  " }, CFO)
    ).rejects.toThrow(/사유/);
  });
});

describe("감사로그에 남는다", () => {
  it("확인과 취소가 각각 남는다 — 잔액이 왜 바뀌었는지 설명할 수 있어야 한다", async () => {
    const s = svc();
    const e = await approved(s);
    const done = await s.settleEntry(
      { code: e.entry.code, settledOn: "2026-09-14", amount: 3_300_000 },
      e.entry.version,
      CFO
    );
    await s.voidSettlement(
      { settlementId: done.settlement.id, reason: "착오" },
      CFO
    );
    const trail = await s.auditTrail({ table: "entry", rowId: e.entry.id });
    const actions = trail.map(r => r.action);
    expect(actions).toContain("settle");
    expect(actions).toContain("settle-void");
  });
});

describe("부분 지급은 현금 부족액에서도 빠진다", () => {
  /** 시드 지평은 2026-09-01 이라 9월 건이 모집단에 안 들어간다 — 넓혀 둔다 */
  async function wideHorizon(s: LedgerService) {
    await s.putSetting("cash_requirement_horizon", "2026-12-31", false, CEO);
  }

  /*
   * `paidAt` 만 보면 **절반이 이미 나간 건이 전액으로** 잡힌다 —
   * 다 채워질 때까지 `paidAt` 이 비어 있기 때문이다. 부족액이 그만큼
   * 부풀어 「돈이 모자란다」가 사실과 달라진다.
   */
  it("나간 만큼 필요액이 줄어든다", async () => {
    const s = svc();
    await wideHorizon(s);
    const e = await approved(s, 10_000_000);
    const need = async () =>
      (await s.cashPosition({ includeUndecided: false }, CEO)).lines.reduce(
        (sum, l) => sum + (l.amountUsed ?? 0),
        0
      );
    const before = await need();

    await s.settleEntry(
      { code: e.entry.code, settledOn: "2026-09-14", amount: 4_000_000 },
      e.entry.version,
      CFO
    );
    expect(await need()).toBe(before - 4_000_000);
  });

  it("다 나가면 필요액에서 통째로 빠진다", async () => {
    const s = svc();
    await wideHorizon(s);
    const e = await approved(s, 10_000_000);
    const need = async () =>
      (await s.cashPosition({ includeUndecided: false }, CEO)).lines.reduce(
        (sum, l) => sum + (l.amountUsed ?? 0),
        0
      );
    const before = await need();

    await s.settleEntry(
      { code: e.entry.code, settledOn: "2026-09-14", amount: 10_000_000 },
      e.entry.version,
      CFO
    );
    expect(await need()).toBe(before - 10_000_000);
  });

  it("무효 처리하면 다시 필요액으로 돌아온다", async () => {
    const s = svc();
    await wideHorizon(s);
    const e = await approved(s, 10_000_000);
    const need = async () =>
      (await s.cashPosition({ includeUndecided: false }, CEO)).lines.reduce(
        (sum, l) => sum + (l.amountUsed ?? 0),
        0
      );
    const before = await need();

    const done = await s.settleEntry(
      { code: e.entry.code, settledOn: "2026-09-14", amount: 4_000_000 },
      e.entry.version,
      CFO
    );
    await s.voidSettlement(
      { settlementId: done.settlement.id, reason: "착오" },
      CFO
    );
    expect(await need()).toBe(before);
  });
});
