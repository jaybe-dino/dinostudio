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
