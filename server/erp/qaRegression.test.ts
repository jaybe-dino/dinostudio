/**
 * 독립 QA 회귀 — **재현부터 한다.**
 *
 * 아래 테스트는 전부 고치기 **전에** 떨어지는 것을 확인하고 넣었다. 고쳤다고
 * 말하려면 그 테스트가 옛 코드를 잡아야 한다.
 */
import { afterEach, describe, expect, it } from "vitest";
import { LedgerService } from "./service.js";
import { InMemoryLedgerStore } from "./store.js";
import type { Actor } from "./service.js";
import { kstToday } from "../../shared/erp/index.js";

const CEO: Actor = { id: "ceo@dinostudio.kr", role: "대표" };
const CFO: Actor = { id: "cfo@dinostudio.kr", role: "재무" };

function svc() {
  return new LedgerService(new InMemoryLedgerStore());
}

let seq = 0;
async function approved(s: LedgerService, amount: number) {
  seq += 1;
  const created = await s.createEntry(
    {
      direction: "out",
      title: `QA 회귀 건 ${seq}`,
      amount,
      cashDate: "2026-09-14",
      accountCode: "5210",
      hasEvidence: true,
    },
    CFO
  );
  await s.addEvidence(
    {
      code: created.entry.code,
      kind: "세금계산서",
      storage: "link",
      url: "https://drive.google.com/x",
    },
    CFO
  );
  const ready = await s.getEntry(created.entry.code, CEO);
  await s.approve(ready.entry.code, ready.entry.version, CEO);
  return s.getEntry(created.entry.code, CEO);
}

describe("QA-003 — 예측 기준일이 실제 집행을 열어 주면 안 된다", () => {
  /*
   * 34회차에서 `today_override` 가 **과거**로 박혀 있으면 이미 나간 돈이
   * 「미래」로 판정돼 확인이 막히는 문제를 고치면서, 기준을
   * 「anchor 와 실제 시계 중 더 늦은 쪽」으로 뒀다. 그 순간 **미래 방향이
   * 열렸다** — 기준일을 2099 로 놓으면 2098 집행이 통과한다.
   *
   * 예측 기준일(`today()`)과 **실제로 일어난 일**의 검증은 다른 축이다.
   * 실제 집행은 **서버의 실제 KST 오늘**까지만이다. 기준값이 실제를
   * 앞당기지도, 미루지도 못한다.
   */
  it("기준일이 미래여도 미래 집행은 거부한다", async () => {
    const s = svc();
    await s.putSetting("today_override", "2099-01-01", false, CEO);
    const e = await approved(s, 1_000_000);

    await expect(
      s.settleEntry(
        { code: e.entry.code, settledOn: "2098-12-31", amount: 1_000_000 },
        e.entry.version,
        CFO
      )
    ).rejects.toThrow(/아직 오지 않은 날짜/);
  });

  it("기준일이 미래여도 paidAt 이 미래가 되지 않는다", async () => {
    const s = svc();
    await s.putSetting("today_override", "2099-01-01", false, CEO);
    const e = await approved(s, 1_000_000);
    await s
      .settleEntry(
        { code: e.entry.code, settledOn: "2098-12-31", amount: 1_000_000 },
        e.entry.version,
        CFO
      )
      .catch(() => {
        /* 위 테스트가 거부를 본다 — 여기서는 상태만 확인한다 */
      });
    const after = await s.getEntry(e.entry.code, CEO);
    expect(after.entry.paidAt).toBeNull();
  });

  it("기준일이 과거로 박혀 있어도 **이미 나간 돈**은 확인할 수 있다", async () => {
    // 34회차에 고친 방향은 그대로 지켜져야 한다 — 되돌리면 안 된다
    const s = svc();
    await s.putSetting("today_override", "2026-08-27", false, CEO);
    const e = await approved(s, 1_000_000);
    const done = await s.settleEntry(
      { code: e.entry.code, settledOn: "2026-09-14", amount: 1_000_000 },
      e.entry.version,
      CFO
    );
    expect(done.summary.state).toBe("확인 완료");
  });
});

describe("QA-002 — 동시 확인이 건 금액을 넘어서는 안 된다", () => {
  /*
   * 합계 읽기 → 금액 검사 → 줄 추가 → paidAt 갱신이 **원자적이지 않다.**
   * 두 호출이 같은 시점에 합계를 읽으면 둘 다 「아직 여유가 있다」고 판단하고
   * 둘 다 통과한다. 1,000원짜리 건에 600 + 600 = 1,200 이 들어간다.
   *
   * 버전으로는 못 막는다 — 부분 확인은 건을 바꾸지 않으므로 두 호출의
   * expectedVersion 이 똑같이 유효하다. **화면에서 두 번 누르지 못하게
   * 막는 것도 대책이 아니다.** API 를 직접 부르면 그대로 통과한다.
   */
  it("같은 버전으로 동시에 불러도 합계가 건 금액을 넘지 않는다", async () => {
    const s = svc();
    const e = await approved(s, 1_000);
    const today = kstToday();

    const results = await Promise.allSettled([
      s.settleEntry(
        { code: e.entry.code, settledOn: today, amount: 600 },
        e.entry.version,
        CFO
      ),
      s.settleEntry(
        { code: e.entry.code, settledOn: today, amount: 600 },
        e.entry.version,
        CEO
      ),
    ]);

    const ok = results.filter(r => r.status === "fulfilled");
    expect(ok.length).toBe(1); // 하나만 통과해야 한다

    const view = await s.settlements(e.entry.code, CEO);
    expect(view.summary.settled).toBe(600);
    expect(view.summary.settled).toBeLessThanOrEqual(1_000);
  });

  it("여러 건이 동시에 들어와도 총합이 건 금액을 넘지 않는다", async () => {
    const s = svc();
    const e = await approved(s, 1_000);
    const today = kstToday();

    // 400 짜리 네 건 — 둘까지만 들어가야 한다
    const results = await Promise.allSettled(
      [0, 1, 2, 3].map(i =>
        s.settleEntry(
          {
            code: e.entry.code,
            settledOn: today,
            amount: 400,
            // 같은 날·같은 금액 되묻기를 피해 **초과 검사만** 본다
            allowDuplicate: true,
            bankRef: `CONC-${i}`,
          },
          e.entry.version,
          CFO
        )
      )
    );
    const view = await s.settlements(e.entry.code, CEO);
    expect(view.summary.settled).toBeLessThanOrEqual(1_000);
    expect(results.filter(r => r.status === "fulfilled").length).toBe(2);
  });

  it("동시 취소도 합계를 음수로 만들지 않는다", async () => {
    const s = svc();
    const e = await approved(s, 1_000);
    const today = kstToday();
    const done = await s.settleEntry(
      { code: e.entry.code, settledOn: today, amount: 1_000 },
      e.entry.version,
      CFO
    );

    const results = await Promise.allSettled([
      s.voidSettlement(
        { settlementId: done.settlement.id, reason: "착오" },
        CFO
      ),
      s.voidSettlement(
        { settlementId: done.settlement.id, reason: "착오" },
        CEO
      ),
    ]);
    expect(results.filter(r => r.status === "fulfilled").length).toBe(1);

    const view = await s.settlements(e.entry.code, CEO);
    expect(view.summary.settled).toBe(0);
  });
});

/* ── QA-001 범위 ─────────────────────────────────────────────────────────── */

const LEAD_IP: Actor = {
  id: "ip-lead@dinostudio.kr",
  role: "사업부리더",
  buCode: "IP",
};
const LEAD_NO_BU: Actor = { id: "nobu@dinostudio.kr", role: "사업부리더" };
const STAFF_A: Actor = { id: "a@dinostudio.kr", role: "담당자" };
const STAFF_B: Actor = { id: "b@dinostudio.kr", role: "담당자" };

/** IP 한 건 · NET 한 건 — 리더가 자기 것만 봐야 한다 */
async function twoBus(s: LedgerService) {
  const ip = await s.createEntry(
    {
      direction: "out",
      title: "IP 외주",
      amount: 1_100_000,
      cashDate: "2026-09-14",
      accountCode: "5210",
      buCode: "IP",
      hasEvidence: true,
    },
    CFO
  );
  const net = await s.createEntry(
    {
      direction: "out",
      title: "NET 외주",
      amount: 2_200_000,
      cashDate: "2026-09-14",
      accountCode: "5210",
      buCode: "NET",
      hasEvidence: true,
    },
    CFO
  );
  return { ip: ip.entry, net: net.entry };
}

describe("QA-001 — 선언만 있고 강제가 없던 범위", () => {
  it("사업부리더 목록에 **다른 사업부 건이 안 나온다**", async () => {
    const s = svc();
    const { ip, net } = await twoBus(s);
    const list = await s.listEntries({}, LEAD_IP);
    const codes = list.entries.map(e => e.code);
    expect(codes).toContain(ip.code);
    expect(codes).not.toContain(net.code);
  });

  it("**단건 조회로도 못 넘어간다** — 목록만 막으면 코드를 알면 열린다", async () => {
    const s = svc();
    const { net } = await twoBus(s);
    await expect(s.getEntry(net.code, LEAD_IP)).rejects.toThrow();
  });

  it("담당자는 **남이 만든 건**을 목록에서 못 본다", async () => {
    const s = svc();
    const mine = await s.createEntry(
      {
        direction: "out",
        title: "내가 올린 건",
        amount: 500_000,
        cashDate: "2026-09-14",
        accountCode: "5210",
        hasEvidence: true,
      },
      STAFF_A
    );
    const theirs = await s.createEntry(
      {
        direction: "out",
        title: "남이 올린 건",
        amount: 700_000,
        cashDate: "2026-09-14",
        accountCode: "5210",
        hasEvidence: true,
      },
      STAFF_B
    );
    const list = await s.listEntries({}, STAFF_A);
    const codes = list.entries.map(e => e.code);
    expect(codes).toContain(mine.entry.code);
    expect(codes).not.toContain(theirs.entry.code);
  });

  it("**사업부가 없는 리더는 아무것도 못 본다** (fail-closed)", async () => {
    // 범위를 모르면 전부 보여 주는 쪽이 아니라 아무것도 안 보여 주는 쪽이다
    const s = svc();
    await twoBus(s);
    const list = await s.listEntries({}, LEAD_NO_BU);
    expect(list.entries.length).toBe(0);
  });

  it("합계도 범위 안에서만 낸다 — 목록만 가리면 총액으로 새 나간다", async () => {
    const s = svc();
    const { ip, net } = await twoBus(s);
    const list = await s.listEntries({}, LEAD_IP);

    // 돌려준 것이 **전부** 자기 사업부여야 한다 (시드에도 IP 건이 있다)
    expect(list.entries.every(e => e.buCode === "IP")).toBe(true);
    expect(list.entries.map(e => e.code)).toContain(ip.code);
    expect(list.entries.map(e => e.code)).not.toContain(net.code);

    // 합계가 목록과 같은 모집단에서 나와야 한다 — 여기가 새면 금액이 샌다
    expect(list.total).toBe(list.entries.length);
    const ceo = await s.listEntries({}, CEO);
    expect(list.total).toBeLessThan(ceo.total);
  });

  it("**확정 합계에도 다른 사업부가 안 섞인다**", async () => {
    const s = svc();
    await twoBus(s);
    const lead = await s.listEntries({}, LEAD_IP);
    const ceo = await s.listEntries({}, CEO);
    // 대표가 보는 지출 확정 합계보다 리더 쪽이 작아야 한다
    expect(lead.out.sum).toBeLessThanOrEqual(ceo.out.sum);
    expect(lead.payrollTotal).toBeLessThanOrEqual(ceo.payrollTotal);
  });

  it("대표·재무는 전부 본다 — 범위가 없는 역할이다", async () => {
    const s = svc();
    const { ip, net } = await twoBus(s);
    for (const actor of [CEO, CFO]) {
      const codes = (await s.listEntries({}, actor)).entries.map(e => e.code);
      expect(codes).toContain(ip.code);
      expect(codes).toContain(net.code);
    }
  });
});

describe("QA-001 — 우회 경로도 같은 잣대를 쓴다", () => {
  /*
   * 목록과 단건만 막으면 나머지 화면으로 그대로 새 나간다. 아래는 QA 가
   * 지목한 경로들이다 — 하나라도 빠지면 범위 규칙이 있으나 마나다.
   */
  it("승인 대기함", async () => {
    const s = svc();
    const { net } = await twoBus(s);
    const queues = await s.approvalQueues(LEAD_IP);
    const seen = JSON.stringify(queues);
    // 어느 대기함에도 그 코드가 나오면 안 된다
    expect(seen).not.toContain(net.code);
  });

  it("지급 순서", async () => {
    const s = svc();
    const { net } = await twoBus(s);
    const order = await s.paymentOrder(LEAD_IP);
    const codes = order.groups.flatMap(g => g.entries.map(x => x.entry.code));
    expect(codes).not.toContain(net.code);
  });

  it("현금 부족액 — 줄에 다른 사업부가 섞이면 금액이 샌다", async () => {
    const s = svc();
    const { net } = await twoBus(s);
    // 시드 지평(2026-09-01)을 넓혀 **실제로 모집단에 들어온 상태**에서 본다.
    // 안 넓히면 지평 밖이라 우연히 통과하고, 범위 검사를 안 해도 초록이 된다
    await s.putSetting("cash_requirement_horizon", "2026-12-31", false, CEO);
    const position = await s.cashPosition({}, LEAD_IP);
    const codes = position.lines.map(l => l.entry.code);
    expect(codes).not.toContain(net.code);

    // 대표는 그 건을 본다 — 즉 지평 때문이 아니라 범위 때문에 빠진 것이다
    const asCeo = await s.cashPosition({}, CEO);
    expect(asCeo.lines.map(l => l.entry.code)).toContain(net.code);
  });

  it("입출금 확인 이력", async () => {
    const s = svc();
    const { net } = await twoBus(s);
    await expect(s.settlements(net.code, LEAD_IP)).rejects.toThrow();
  });

  it("증빙", async () => {
    const s = svc();
    const { net } = await twoBus(s);
    await expect(s.evidence(net.code, LEAD_IP)).rejects.toThrow();
  });

  it("수정·승인 등 쓰기 경로", async () => {
    const s = svc();
    const { net } = await twoBus(s);
    const fresh = await s.getEntry(net.code, CEO);
    await expect(
      s.patchEntry(
        net.code,
        { title: "몰래 고치기" },
        fresh.entry.version,
        LEAD_IP
      )
    ).rejects.toThrow();
    await expect(
      s.cancelEntry(net.code, "몰래 취소", fresh.entry.version, LEAD_IP, null)
    ).rejects.toThrow();
  });

  it("**「없습니다」로 답한다** — 「권한 없음」이면 그 건의 존재가 새 나간다", async () => {
    const s = svc();
    const { net } = await twoBus(s);
    await expect(s.getEntry(net.code, LEAD_IP)).rejects.toThrow(
      /찾을 수 없습니다/
    );
  });
});

describe("QA-001 — 세션이 사업부를 실어 나른다", () => {
  /*
   * 범위 검사가 아무리 정확해도 `actorFrom` 이 사업부를 안 실으면 선언으로만
   * 남는다 — 실제로 그랬다. 여기서는 그 배선을 본다.
   */
  it("ERP_ROLE_MAP 의 「사업부리더:IP」 에서 역할과 사업부를 읽는다", async () => {
    const { resolveErpRole, resolveErpBu } = await import("./index.js");
    const before = process.env.ERP_ROLE_MAP;
    process.env.ERP_ROLE_MAP = JSON.stringify({
      "lead@dinostudio.kr": "사업부리더:IP",
      "cfo@dinostudio.kr": "재무",
    });
    try {
      expect(resolveErpRole("lead@dinostudio.kr")).toBe("사업부리더");
      expect(resolveErpBu("lead@dinostudio.kr")).toBe("IP");
      // 사업부를 안 붙인 사람은 null — 리더가 아니면 쓰이지 않는다
      expect(resolveErpRole("cfo@dinostudio.kr")).toBe("재무");
      expect(resolveErpBu("cfo@dinostudio.kr")).toBeNull();
    } finally {
      if (before === undefined) delete process.env.ERP_ROLE_MAP;
      else process.env.ERP_ROLE_MAP = before;
    }
  });

  it("사용자 배정의 사업부가 환경변수보다 우선한다", async () => {
    const { setAssignedRoles, resolveErpBu } = await import("./index.js");
    const before = process.env.ERP_ROLE_MAP;
    process.env.ERP_ROLE_MAP = JSON.stringify({
      "lead@dinostudio.kr": "사업부리더:IP",
    });
    try {
      setAssignedRoles([
        {
          email: "lead@dinostudio.kr",
          role: "사업부리더",
          buCode: "NET",
          active: true,
        },
      ]);
      expect(resolveErpBu("lead@dinostudio.kr")).toBe("NET");
    } finally {
      setAssignedRoles([]);
      if (before === undefined) delete process.env.ERP_ROLE_MAP;
      else process.env.ERP_ROLE_MAP = before;
    }
  });

  it("비활성 사용자는 사업부도 안 실린다", async () => {
    const { setAssignedRoles, resolveErpBu } = await import("./index.js");
    setAssignedRoles([
      {
        email: "gone@dinostudio.kr",
        role: "사업부리더",
        buCode: "IP",
        active: false,
      },
    ]);
    expect(resolveErpBu("gone@dinostudio.kr")).toBeNull();
    setAssignedRoles([]);
  });
});
