/**
 * 역할별 대기함 — 「지금 이 건은 누가 움직여야 하는가」.
 *
 * 가장 중요한 것은 **승인 판정과 같은 순서로 막히는가**다. 화면이 「대표 결재
 * 대기」라고 해 놓고 누르면 「증빙이 없습니다」가 뜨면, 대표는 결재하려고
 * 들어왔다가 아무것도 못 하고 나간다. 규칙이 두 벌이 되는 전형적인 사고다.
 */
import { describe, expect, it } from "vitest";
import {
  blockerSummary,
  buildRoleQueues,
  classifyWaiting,
} from "../../shared/erp/approvalQueue.js";
import type { Entry } from "../../shared/erp/types.js";

function entry(over: Partial<Entry> = {}): Entry {
  return {
    id: "id-1",
    code: "EX-260912-01",
    version: 1,
    direction: "out",
    status: "pending",
    title: "예시 제작비",
    noteRaw: null,
    note: null,
    amount: 1_000_000,
    amountCandidate: null,
    amountSupply: null,
    amountVat: null,
    accrualDate: null,
    cashDate: "2026-09-12",
    accountCode: "6320",
    nature: "직접원가",
    buCode: "NET",
    projectId: null,
    partyId: "P1",
    priority: "P2",
    hasEvidence: true,
    isPersonal: false,
    source: "manual",
    sourceRef: null,
    createdBy: "staff@dinostudio.kr",
    createdAt: "2026-09-12T00:00:00+09:00",
    undecidedReason: null,
    ...over,
  } as Entry;
}

describe("막히는 순서가 승인 판정과 같다", () => {
  it("금액이 없으면 그것이 먼저다 — 계정·증빙보다 앞", () => {
    const item = classifyWaiting(
      entry({ amount: null, accountCode: null, hasEvidence: false })
    )!;
    expect(item.blocker).toBe("금액 미확정");
  });

  it("금액이 차면 다음은 계정과목이다", () => {
    const item = classifyWaiting(
      entry({ accountCode: null, hasEvidence: false })
    )!;
    expect(item.blocker).toBe("계정과목 없음");
  });

  it("계정까지 차면 다음은 증빙이다", () => {
    const item = classifyWaiting(entry({ hasEvidence: false }))!;
    expect(item.blocker).toBe("증빙 없음");
  });

  it("다 차면 결재 대기다", () => {
    expect(classifyWaiting(entry())!.blocker).toBe("결재 대기");
  });

  it("확정된 건은 아무도 기다리지 않는다", () => {
    expect(classifyWaiting(entry({ status: "confirmed" }))).toBeNull();
  });

  it("취소된 건도 대기함에 없다", () => {
    expect(classifyWaiting(entry({ status: "canceled" }))).toBeNull();
  });
});

describe("누가 움직여야 하는가", () => {
  it("금액·증빙은 재무와 담당자가 채운다", () => {
    expect(classifyWaiting(entry({ amount: null }))!.waitingOn).toEqual([
      "재무",
      "담당자",
    ]);
    expect(classifyWaiting(entry({ hasEvidence: false }))!.waitingOn).toContain(
      "담당자"
    );
  });

  it("계정과목은 재무만 — 계정 체계의 주인이다", () => {
    expect(classifyWaiting(entry({ accountCode: null }))!.waitingOn).toEqual([
      "재무",
    ]);
  });

  it("500만 이하는 리더까지 결재할 수 있다", () => {
    const item = classifyWaiting(entry({ amount: 5_000_000 }))!;
    expect(item.waitingOn).toContain("사업부리더");
  });

  it("2,000만 초과는 대표만이다", () => {
    const item = classifyWaiting(entry({ amount: 25_000_000 }))!;
    expect(item.waitingOn).toEqual(["대표"]);
  });

  it("쪼개면 주간 합계로 다시 본다 (D2)", () => {
    // 건별로는 500만이라 리더도 되지만, 같은 주 같은 거래처 합계가 2,500만이면 대표다
    const item = classifyWaiting(entry({ amount: 5_000_000 }), {
      weekTotal: 25_000_000,
    })!;
    expect(item.waitingOn).toEqual(["대표"]);
    expect(item.note).toContain("같은 주 같은 거래처 합계");
  });
});

describe("본인이 올린 건은 본인이 승인할 수 없다 (D1)", () => {
  it("관여했으면 표시가 붙는다", () => {
    const item = classifyWaiting(entry(), { touchedByViewer: true })!;
    expect(item.selfBlocked).toBe(true);
  });

  it("관여하지 않았으면 붙지 않는다", () => {
    expect(classifyWaiting(entry())!.selfBlocked).toBe(false);
  });
});

describe("역할별로 나눈다", () => {
  const items = [
    classifyWaiting(entry({ code: "A", amount: 25_000_000 }))!,
    classifyWaiting(entry({ code: "B", amount: 1_000_000 }))!,
    classifyWaiting(entry({ code: "C", accountCode: null }))!,
    classifyWaiting(entry({ code: "D", amount: null }))!,
  ];

  it("대표 대기함에는 결재할 것이 들어온다", () => {
    const [대표] = buildRoleQueues(items, ["대표"]);
    expect(대표.items.map(i => i.code)).toEqual(["A", "B"]);
  });

  it("재무 대기함에는 채워 넣을 것이 들어온다", () => {
    const [재무] = buildRoleQueues(items, ["재무"]);
    expect(재무.items.map(i => i.code)).toEqual(["B", "C", "D"]);
  });

  it("리더는 한도 안의 것만 본다", () => {
    const [리더] = buildRoleQueues(items, ["사업부리더"]);
    expect(리더.items.map(i => i.code)).toEqual(["B"]);
  });

  it("합계는 금액이 정해진 것만 더한다 — 모르는 것을 0으로 세지 않는다", () => {
    const [재무] = buildRoleQueues(items, ["재무"]);
    expect(재무.amountSum).toBe(2_000_000); // B 100만 + C 100만
    expect(재무.unknownAmount).toBe(1); // D
  });

  it("한 건이 두 역할에 동시에 걸릴 수 있다", () => {
    const [대표, 재무] = buildRoleQueues(items, ["대표", "재무"]);
    expect(대표.items.map(i => i.code)).toContain("B");
    expect(재무.items.map(i => i.code)).toContain("B");
  });
});

describe("무엇 때문에 멈춰 있나", () => {
  it("관문별 건수를 센다", () => {
    const items = [
      classifyWaiting(entry({ amount: null }))!,
      classifyWaiting(entry({ accountCode: null }))!,
      classifyWaiting(entry())!,
      classifyWaiting(entry())!,
    ];
    expect(blockerSummary(items)).toEqual([
      { blocker: "금액 미확정", n: 1 },
      { blocker: "계정과목 없음", n: 1 },
      { blocker: "증빙 없음", n: 0 },
      { blocker: "결재 대기", n: 2 },
    ]);
  });
});
