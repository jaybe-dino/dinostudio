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
