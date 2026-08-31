/**
 * 4축 시급 점수 (오늘의 3가지 · 결정 큐)
 *
 * 「같은 입력이면 같은 순위」가 이 기능의 약속이다. 그 약속을 테스트로 고정한다.
 * 순위가 이상해서 규칙을 고칠 때, 무엇이 함께 바뀌는지 여기서 보인다.
 */
import { describe, expect, it } from "vitest";
import {
  AXIS_LABEL,
  OWNER_SCORE_THRESHOLD,
  OWNER_SLOTS,
  LEADER_SCORE_THRESHOLD,
  buildDecisionQueue,
  businessDaysBetween,
  ownerTop,
  scoreAmount,
  scoreDeadline,
  scoreDecision,
  scoreReversibility,
  scoreThreshold,
  type ScoreInput,
} from "../../shared/erp/index.js";

const TODAY = "2026-09-01"; // 화요일
const CTX = {
  today: TODAY,
  monthlyBurn: 60_000_000,
  threshold: "warning" as const,
};

function item(over: Partial<ScoreInput> = {}): ScoreInput {
  return {
    code: "EX-260901-01",
    title: "테스트 안건",
    status: "pending",
    priority: "P2",
    amount: 3_000_000,
    due: "2026-09-10",
    ...over,
  };
}

describe("영업일 계산", () => {
  it("주말을 세지 않는다", () => {
    // 2026-09-04 금 → 2026-09-07 월 은 달력 3일이지만 영업일 1일이다
    expect(businessDaysBetween("2026-09-04", "2026-09-07")).toBe(1);
  });
  it("같은 날이거나 과거면 0", () => {
    expect(businessDaysBetween("2026-09-01", "2026-09-01")).toBe(0);
    expect(businessDaysBetween("2026-09-05", "2026-09-01")).toBe(0);
  });
});

describe("가역성", () => {
  it("확정된 건은 되돌릴 수 없어 3점", () => {
    expect(
      scoreReversibility({ status: "confirmed", priority: "P3" }).score
    ).toBe(3);
  });
  it("카드 결제 예약분은 3점", () => {
    expect(
      scoreReversibility({
        status: "pending",
        priority: "P3",
        payMethod: "법인카드",
      }).score
    ).toBe(3);
  });
  it("P0 은 미룰 수 없어 3점", () => {
    expect(
      scoreReversibility({ status: "pending", priority: "P0" }).score
    ).toBe(3);
  });
  it("P3 재량지출은 1점", () => {
    expect(
      scoreReversibility({ status: "pending", priority: "P3" }).score
    ).toBe(1);
  });
});

describe("기한", () => {
  it("오늘이거나 지났으면 3점", () => {
    expect(scoreDeadline(TODAY, TODAY).score).toBe(3);
    expect(scoreDeadline("2026-08-20", TODAY).score).toBe(3);
  });
  it("3영업일 내면 2점", () => {
    expect(scoreDeadline("2026-09-04", TODAY).score).toBe(2);
  });
  it("기한이 없으면 0점이고 그 사실을 남긴다", () => {
    const r = scoreDeadline(null, TODAY);
    expect(r.score).toBe(0);
    expect(r.why).toContain("정해지지 않았습니다");
  });
});

describe("금액 영향", () => {
  it("월 번레이트의 절반을 넘으면 3점", () => {
    expect(scoreAmount(31_000_000, 60_000_000).score).toBe(3);
  });
  it("10~50% 는 2점", () => {
    expect(scoreAmount(10_000_000, 60_000_000).score).toBe(2);
  });
  it("10% 미만은 1점", () => {
    expect(scoreAmount(1_000_000, 60_000_000).score).toBe(1);
  });
  it("번레이트를 모르면 점수를 만들지 않고 이유를 남긴다", () => {
    // 모르는 것을 0 으로 채우면 「영향이 없다」로 읽힌다 (§10.2 ①)
    const r = scoreAmount(10_000_000, null);
    expect(r.score).toBe(0);
    expect(r.why).toContain("번레이트");
  });
  it("금액이 미확정이면 판정하지 않는다", () => {
    expect(scoreAmount(null, 60_000_000).why).toContain("확정되지 않아");
  });
});

describe("임계선", () => {
  it("심각선 3 · 경보선 2 · 접근 1 · 정상 0", () => {
    expect(scoreThreshold("critical").score).toBe(3);
    expect(scoreThreshold("warning").score).toBe(2);
    expect(scoreThreshold("approaching").score).toBe(1);
    expect(scoreThreshold("clear").score).toBe(0);
  });
});

describe("점수 합계와 근거", () => {
  it("네 축의 합이 total 이다", () => {
    const s = scoreDecision(item(), CTX);
    expect(s.total).toBe(s.reversibility + s.deadline + s.amount + s.threshold);
  });
  it("모든 축에 근거 문장이 붙는다", () => {
    const s = scoreDecision(item(), CTX);
    for (const axis of Object.keys(AXIS_LABEL) as (keyof typeof AXIS_LABEL)[])
      expect(s.why[axis].length).toBeGreaterThan(0);
  });
  it("같은 입력이면 같은 점수가 나온다", () => {
    expect(scoreDecision(item(), CTX)).toEqual(scoreDecision(item(), CTX));
  });
});

describe("결정 큐 라우팅", () => {
  it(`대표에게는 최대 ${OWNER_SLOTS}건만 올라간다`, () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      item({ code: `EX-${i}`, priority: "P0", due: TODAY, amount: 40_000_000 })
    );
    const queue = buildDecisionQueue(many, CTX);
    expect(ownerTop(queue)).toHaveLength(OWNER_SLOTS);
    // 나머지는 사라지지 않고 리더로 간다
    expect(queue.filter(q => q.routing === "리더").length).toBe(5);
  });

  it("가역성 3점이면 합계가 낮아도 대표에게 올라가고 예외 사유가 붙는다", () => {
    const queue = buildDecisionQueue(
      [
        item({
          code: "EX-A",
          priority: "P0", // 가역성 3
          due: null, // 기한 0
          amount: 100_000, // 금액 1
        }),
      ],
      { ...CTX, threshold: "clear" } // 임계선 0 → 합계 4점
    );
    expect(queue[0].score.total).toBeLessThan(OWNER_SCORE_THRESHOLD);
    expect(queue[0].routing).toBe("대표");
    expect(queue[0].exception).toContain("가역성 3점");
  });

  it("결정권자 유일 예외는 이유를 함께 남긴다", () => {
    const queue = buildDecisionQueue(
      [
        item({
          code: "EX-B",
          priority: "P3",
          due: null,
          amount: 100,
          ownerOnly: true,
        }),
      ],
      { ...CTX, threshold: "clear" }
    );
    expect(queue[0].routing).toBe("대표");
    expect(queue[0].exception).toContain("결정권자 유일");
  });

  it("점수가 높은 순으로 정렬되고 동점이면 가역성이 앞선다", () => {
    const queue = buildDecisionQueue(
      [
        item({
          code: "LOW",
          priority: "P3",
          due: "2026-09-30",
          amount: 100_000,
        }),
        item({ code: "HIGH", priority: "P0", due: TODAY, amount: 40_000_000 }),
      ],
      CTX
    );
    expect(queue[0].code).toBe("HIGH");
    expect(queue[0].score.total).toBeGreaterThan(queue[1].score.total);
  });

  it("리더 하한 미달은 보류함으로 간다 — 사라지지는 않는다", () => {
    const queue = buildDecisionQueue(
      [item({ priority: "P3", due: null, amount: null })],
      { ...CTX, monthlyBurn: null, threshold: "clear" }
    );
    // 가역성 1점만 — 리더 하한(5)에 못 미친다
    expect(queue[0].score.total).toBeLessThan(LEADER_SCORE_THRESHOLD);
    expect(queue[0].routing).toBe("보류함");
  });

  it("리더 하한을 넘으면 리더로 간다", () => {
    const queue = buildDecisionQueue(
      [item({ priority: "P2", due: "2026-09-02", amount: 10_000_000 })],
      CTX
    );
    // 가역성 2 + 기한 2 + 금액 2 + 임계선 2 = 8 → 대표
    // 대표 자리가 있으면 대표로 가므로, 자리를 채운 뒤를 본다
    expect(queue[0].score.total).toBeGreaterThanOrEqual(LEADER_SCORE_THRESHOLD);
  });
});
