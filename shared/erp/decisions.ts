/**
 * 오늘의 3가지 · 결정 큐 — 4축 시급 점수 (E3 비서실장의 산출물)
 *
 * 「가장 시급한 3가지」를 감으로 고르면 안 된다. 같은 입력이면 같은 순위가 나와야 하고,
 * 순위가 이상하면 규칙을 고쳐야 한다 — 에이전트가 임의로 고르지 않는다.
 * 그래서 점수 규칙을 코드로 고정하고 계산 근거를 화면에 그대로 노출한다.
 *
 * 축은 네 개, 각 0–3점 —
 *   가역성   오늘 지나면 되돌릴 수 있는가
 *   기한     언제까지인가
 *   금액영향 현금에 미치는 크기 (월 번레이트 대비)
 *   임계선   기준선을 넘기는가
 *
 * 대표에게 도달하는 조건은 **합계 8점 이상 또는 가역성 3점**이다.
 * 가역성 3점은 점수와 무관하게 올린다 — 되돌릴 수 없는 것은 반드시 사람이 봐야 한다.
 * 상위 3건만 대표에게 가고 4위부터는 담당 리더로 라우팅된다.
 */
import { businessDaysBetween } from "./time.js";
import type { Entry, Priority } from "./types.js";

/** 대표에게 올라가는 점수 하한 */
export const OWNER_SCORE_THRESHOLD = 8;
/** 대표 화면에 올리는 최대 건수 — 정보를 늘리지 않고 줄이는 것이 목적이다 */
export const OWNER_SLOTS = 3;

/**
 * 리더에게 라우팅하는 하한. 이 아래는 보류함으로 간다.
 *
 * 원본 자료의 예시 표에서 5점·6점은 리더로, 3점은 보류함으로 갔다.
 * 그 사이 어딘가가 경계인데 문서에 값이 없어 5로 잡았다.
 * 실제 운영에서 「리더에게 너무 많이 간다」면 이 값을 올린다 — 규칙을 고치는 자리는 여기다.
 */
export const LEADER_SCORE_THRESHOLD = 5;

/** 금액 영향 판정에 쓰는 월 번레이트 대비 비율 */
export const AMOUNT_MAJOR_RATIO = 0.5;
export const AMOUNT_MINOR_RATIO = 0.1;

export type Axis = "reversibility" | "deadline" | "amount" | "threshold";

export const AXIS_LABEL: Record<Axis, string> = {
  reversibility: "가역성",
  deadline: "기한",
  amount: "금액 영향",
  threshold: "임계선",
};

/** 임계선 상태 — 번레이트·런웨이 화면의 판정을 그대로 받는다 */
export type ThresholdState = "critical" | "warning" | "approaching" | "clear";

export interface DecisionScore {
  reversibility: number;
  deadline: number;
  amount: number;
  threshold: number;
  total: number;
  /** 각 점수를 왜 그렇게 줬는지 — 화면에 그대로 보여 준다 */
  why: Record<Axis, string>;
}

export type Routing = "대표" | "리더" | "보류함";

export interface DecisionItem {
  /** 원장 코드가 있으면 연결한다 */
  code: string | null;
  title: string;
  score: DecisionScore;
  routing: Routing;
  /**
   * 점수가 낮은데 대표에게 올린 경우의 사유.
   * 예외를 쓰면 반드시 이유를 함께 표시한다 — 규칙을 몰래 어기지 않는다.
   */
  exception: string | null;
}

/**
 * 가역성 — 오늘 지나면 되돌릴 수 있는가.
 *   3 되돌릴 수 없음 (이미 집행됐거나 계약이 확정된다)
 *   2 되돌리는 데 비용이 든다 (거래처 신뢰·위약)
 *   1 되돌릴 수 있다
 */
export function scoreReversibility(entry: {
  status: Entry["status"];
  priority: Priority | null;
  payMethod?: string | null;
}): { score: number; why: string } {
  if (entry.status === "confirmed")
    return { score: 3, why: "이미 확정되어 되돌릴 수 없습니다" };
  // 카드 결제는 예약이 걸리면 사람이 막을 수 없다
  if (entry.payMethod === "법인카드" || entry.payMethod === "개인카드선결제")
    return { score: 3, why: "카드 결제 예약분은 되돌릴 수 없습니다" };
  if (entry.priority === "P0")
    return { score: 3, why: "P0 은 미룰 수 없습니다 (급여·4대보험·원리금)" };
  if (entry.priority === "P1")
    return { score: 2, why: "미루면 연체이자·가산세가 붙습니다" };
  if (entry.priority === "P2")
    return { score: 2, why: "미루면 협력사 신뢰에 부담이 갑니다" };
  return { score: 1, why: "되돌릴 수 있습니다" };
}

/**
 * 기한 — 3 오늘 · 2 3영업일 내 · 1 이번 주 · 0 그 이후
 */
export function scoreDeadline(
  due: string | null,
  today: string
): { score: number; why: string } {
  if (!due) return { score: 0, why: "기한이 정해지지 않았습니다" };
  if (due <= today)
    return { score: 3, why: `기한 ${due} — 오늘이거나 지났습니다` };
  const days = businessDaysBetween(today, due);
  if (days <= 3)
    return { score: 2, why: `기한 ${due} — 영업일 ${days}일 남았습니다` };
  if (days <= 5) return { score: 1, why: `기한 ${due} — 이번 주입니다` };
  return { score: 0, why: `기한 ${due} — 아직 여유가 있습니다` };
}

/**
 * 금액 영향 — 월 번레이트 대비.
 * 번레이트를 모르면 점수를 주지 않고 그 사실을 남긴다 (§10.2 ①).
 */
export function scoreAmount(
  amount: number | null,
  monthlyBurn: number | null
): { score: number; why: string } {
  if (amount == null)
    return { score: 0, why: "금액이 확정되지 않아 판정할 수 없습니다" };
  if (monthlyBurn == null || monthlyBurn <= 0)
    return { score: 0, why: "월 번레이트를 몰라 비율을 계산할 수 없습니다" };
  const ratio = Math.abs(amount) / monthlyBurn;
  const pct = Math.round(ratio * 100);
  if (ratio > AMOUNT_MAJOR_RATIO)
    return { score: 3, why: `월 번레이트의 ${pct}% — 절반을 넘습니다` };
  if (ratio >= AMOUNT_MINOR_RATIO)
    return { score: 2, why: `월 번레이트의 ${pct}%` };
  return { score: 1, why: `월 번레이트의 ${pct}% — 크지 않습니다` };
}

/** 임계선 — 회사 전체 상태이므로 모든 안건에 같은 점수가 붙는다 */
export function scoreThreshold(state: ThresholdState): {
  score: number;
  why: string;
} {
  switch (state) {
    case "critical":
      return {
        score: 3,
        why: "심각선 돌파 — 예상런웨이 4주 또는 커버리지 0.7",
      };
    case "warning":
      return { score: 2, why: "경보선 돌파" };
    case "approaching":
      return { score: 1, why: "기준선에 접근 중" };
    default:
      return { score: 0, why: "기준선 안에 있습니다" };
  }
}

export interface ScoreInput {
  code: string | null;
  title: string;
  status: Entry["status"];
  priority: Priority | null;
  payMethod?: string | null;
  amount: number | null;
  due: string | null;
  /** 대표만 결정할 수 있는 안건인가 — 라우팅할 대상이 없으면 점수와 무관하게 올린다 */
  ownerOnly?: boolean;
}

export function scoreDecision(
  input: ScoreInput,
  context: {
    today: string;
    monthlyBurn: number | null;
    threshold: ThresholdState;
  }
): DecisionScore {
  const reversibility = scoreReversibility(input);
  const deadline = scoreDeadline(input.due, context.today);
  const amount = scoreAmount(input.amount, context.monthlyBurn);
  const threshold = scoreThreshold(context.threshold);
  return {
    reversibility: reversibility.score,
    deadline: deadline.score,
    amount: amount.score,
    threshold: threshold.score,
    total:
      reversibility.score + deadline.score + amount.score + threshold.score,
    why: {
      reversibility: reversibility.why,
      deadline: deadline.why,
      amount: amount.why,
      threshold: threshold.why,
    },
  };
}

/**
 * 안건 목록을 점수순으로 정렬하고 라우팅을 정한다.
 *
 * 상위 3건만 대표에게 간다. 4위부터는 리더로, 도달 조건을 못 넘긴 것은 보류함으로.
 * 「결정권자 유일」 예외는 점수가 낮아도 올리되 이유를 함께 남긴다.
 */
export function buildDecisionQueue(
  inputs: ScoreInput[],
  context: {
    today: string;
    monthlyBurn: number | null;
    threshold: ThresholdState;
  }
): DecisionItem[] {
  const scored = inputs.map(input => {
    const score = scoreDecision(input, context);
    const reachesOwner =
      score.total >= OWNER_SCORE_THRESHOLD || score.reversibility === 3;
    return { input, score, reachesOwner };
  });

  // 합계 내림차순, 같으면 가역성이 높은 쪽을 먼저 — 되돌릴 수 없는 것이 급하다
  scored.sort(
    (a, b) =>
      b.score.total - a.score.total ||
      b.score.reversibility - a.score.reversibility
  );

  let ownerSlots = OWNER_SLOTS;
  const items: DecisionItem[] = [];

  for (const { input, score, reachesOwner } of scored) {
    let routing: Routing;
    let exception: string | null = null;

    if (reachesOwner && ownerSlots > 0) {
      routing = "대표";
      ownerSlots -= 1;
      if (score.total < OWNER_SCORE_THRESHOLD)
        exception = "가역성 3점 — 되돌릴 수 없어 점수와 무관하게 올립니다";
    } else if (input.ownerOnly && ownerSlots > 0) {
      routing = "대표";
      ownerSlots -= 1;
      exception = "결정권자 유일 — 라우팅할 대상이 없습니다";
    } else if (score.total >= LEADER_SCORE_THRESHOLD) {
      routing = "리더";
    } else {
      // 걸러낸 것 — 사라지지 않고 보류함에 남는다
      routing = "보류함";
    }

    items.push({
      code: input.code,
      title: input.title,
      score,
      routing,
      exception,
    });
  }

  return items;
}

/** 대표 화면에 올리는 것만 */
export function ownerTop(items: DecisionItem[]): DecisionItem[] {
  return items.filter(i => i.routing === "대표");
}
