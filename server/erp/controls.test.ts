/**
 * 통제 — 자기승인(D1) · 한도 쪼개기(D2)
 *
 * 둘 다 「규칙은 있는데 우회로가 있는」 종류의 구멍이었다.
 * 우회로가 막혔는지를 테스트로 고정한다.
 */
import { describe, expect, it } from "vitest";
import { LedgerService } from "./service.js";
import { InMemoryLedgerStore } from "./store.js";
import type { Actor } from "./service.js";

const CFO: Actor = { id: "cfo@dinostudio.kr", role: "재무" };
const CEO: Actor = { id: "ceo@dinostudio.kr", role: "대표" };
const LEADER: Actor = { id: "lead@dinostudio.kr", role: "사업부리더" };

function svc() {
  return new LedgerService(new InMemoryLedgerStore());
}

async function ready(
  service: LedgerService,
  input: Parameters<LedgerService["createEntry"]>[0],
  actor: Actor
) {
  const created = await service.createEntry(input, actor);
  await service.addEvidence(
    {
      code: created.entry.code,
      kind: "세금계산서",
      storage: "link",
      url: "https://drive.google.com/x",
    },
    actor
  );
  return service.getEntry(created.entry.code, actor);
}

describe("D1 자기승인 — 관여한 사람 전부", () => {
  it("만든 사람은 승인할 수 없다", async () => {
    const s = svc();
    const e = await ready(
      s,
      {
        direction: "out",
        title: "외주",
        amount: 1_000_000,
        accountCode: "5210",
        cashDate: "2026-09-10",
      },
      CFO
    );
    await expect(
      s.approve(e.entry.code, e.entry.version, CFO)
    ).rejects.toMatchObject({ code: "self_approval" });
  });

  it("수정본을 만든 사람도 자기 수정을 승인할 수 없다", async () => {
    const s = svc();
    // 대표가 만들고 확정한 뒤, 재무가 수정본을 만든다
    const e = await ready(
      s,
      {
        direction: "out",
        title: "외주",
        amount: 1_000_000,
        accountCode: "5210",
        cashDate: "2026-09-10",
      },
      CEO
    );
    const approved = await s.approve(e.entry.code, e.entry.version, CFO);
    const revision = await s.patchEntry(
      approved.entry.code,
      { title: "외주 (수정)" },
      approved.entry.version,
      CFO
    );
    await s.addEvidence(
      {
        code: revision.entry.code,
        kind: "세금계산서",
        storage: "link",
        url: "https://drive.google.com/y",
      },
      CFO
    );
    const fresh = await s.getEntry(revision.entry.code, CFO);

    // 수정본의 생성자는 재무다 — 재무가 승인하면 자기 수정을 자기가 통과시킨다
    await expect(
      s.approve(fresh.entry.code, fresh.entry.version, CFO)
    ).rejects.toMatchObject({ code: "self_approval" });
  });
});

describe("D2 한도 쪼개기", () => {
  it("같은 거래처에 같은 주로 쪼개면 합계로 다시 판정한다", async () => {
    const s = svc();
    // 사업부리더 한도(500만원) 아래로 세 건을 쪼갠다 — 합치면 한도를 넘는다.
    // 금액을 조금씩 다르게 둔다 — 같은 금액이면 중복 탐지(T13)가 먼저 걸린다
    for (const [i, amount] of [4_100_000, 4_200_000].entries()) {
      const prev = await ready(
        s,
        {
          direction: "out",
          title: `분할 ${i}`,
          amount,
          accountCode: "5210",
          cashDate: "2026-09-08",
          partyId: "party-1",
        },
        CFO
      );
      await s.approve(prev.entry.code, prev.entry.version, CEO);
    }

    const third = await ready(
      s,
      {
        direction: "out",
        title: "분할 2",
        amount: 4_300_000,
        accountCode: "5210",
        cashDate: "2026-09-10",
        partyId: "party-1",
      },
      CFO
    );

    // 건별로는 430만원이라 리더 한도 안이지만, 같은 주 합계는 1,260만원이다
    await expect(
      s.approve(third.entry.code, third.entry.version, LEADER)
    ).rejects.toMatchObject({ code: "approval_limit" });
  });

  it("거래처가 다르면 묶지 않는다", async () => {
    const s = svc();
    const a = await ready(
      s,
      {
        direction: "out",
        title: "A사",
        amount: 4_000_000,
        accountCode: "5210",
        cashDate: "2026-09-08",
        partyId: "party-a",
      },
      CFO
    );
    await s.approve(a.entry.code, a.entry.version, CEO);

    const b = await ready(
      s,
      {
        direction: "out",
        title: "B사",
        amount: 4_500_000,
        accountCode: "5210",
        cashDate: "2026-09-09",
        partyId: "party-b",
      },
      CFO
    );
    // 다른 거래처이므로 합치지 않는다 — 리더가 승인할 수 있어야 한다
    await expect(
      s.approve(b.entry.code, b.entry.version, LEADER)
    ).resolves.toBeTruthy();
  });
});
