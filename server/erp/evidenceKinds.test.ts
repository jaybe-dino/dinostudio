/**
 * 증빙 종류와 세무 결과.
 *
 * 이 계산이 틀리면 「증빙 없이 승인」이 조용한 손실로 바뀐다 —
 * 얼마를 잃는지 보여 주는 것이 이 기능의 존재 이유이므로 숫자를 고정한다.
 */
import { describe, expect, it } from "vitest";
import {
  ENTERTAINMENT_EVIDENCE_THRESHOLD,
  NO_EVIDENCE_KIND,
  EVIDENCE_KINDS,
  MIN_NO_EVIDENCE_REASON_LENGTH,
  QUALIFIED_EVIDENCE_THRESHOLD,
  checkEvidenceInput,
  evidenceKindSpec,
  evidenceRisk,
} from "../../shared/erp/evidence.js";

describe("증빙 종류 목록", () => {
  it("적격증빙 4종이 정확히 표시된다", () => {
    const qualified = EVIDENCE_KINDS.filter(k => k.qualified).map(k => k.kind);
    expect(qualified).toEqual([
      "세금계산서",
      "계산서",
      "신용카드전표",
      "현금영수증",
    ]);
  });

  it("계산서는 적격이지만 매입세액 공제 대상이 아니다", () => {
    // 면세 거래이므로 애초에 매입세액이 없다 — 적격과 공제를 하나로 묶으면 틀린다
    const spec = evidenceKindSpec("계산서");
    expect(spec).toMatchObject({ qualified: true, vatDeductible: false });
  });

  it("목록에 없는 종류는 알 수 없다고 답한다", () => {
    expect(evidenceKindSpec("아무거나")).toBeNull();
  });
});

describe("등록 가능 여부", () => {
  it("증빙 없음은 사유가 짧으면 막는다", () => {
    expect(
      checkEvidenceInput({ kind: "기타", storage: "none", reason: "없음" })
    ).toContain(`${MIN_NO_EVIDENCE_REASON_LENGTH}자 이상`);
  });

  it("증빙 없음은 사유가 충분하면 통과한다", () => {
    expect(
      checkEvidenceInput({
        kind: "기타",
        storage: "none",
        reason: "해외 결제로 세금계산서 발급 불가",
      })
    ).toBeNull();
  });

  it("증빙 없음에 실제 증빙 종류를 붙이지 못한다", () => {
    // 「세금계산서 · 증빙 없음」은 모순이다 — 나중에 있는 것으로 읽힌다
    expect(
      checkEvidenceInput({
        kind: "세금계산서",
        storage: "none",
        reason: "해외 결제로 발급 불가",
      })
    ).toContain(NO_EVIDENCE_KIND);
  });

  it("링크는 http(s) 만 받는다", () => {
    expect(
      checkEvidenceInput({
        kind: "계약서",
        storage: "link",
        url: "file:///etc/passwd",
      })
    ).toContain("http");
    expect(
      checkEvidenceInput({
        kind: "계약서",
        storage: "link",
        url: "https://drive.google.com/x",
      })
    ).toBeNull();
  });

  it("목록에 없는 종류는 거부한다", () => {
    expect(
      checkEvidenceInput({
        kind: "이상한증빙",
        storage: "link",
        url: "https://a.b",
      })
    ).toContain("목록에 없습니다");
  });
});

describe("증빙 때문에 잃는 돈", () => {
  it("세금계산서가 있으면 손해가 없다", () => {
    const risk = evidenceRisk({
      direction: "out",
      amount: 1_100_000,
      attachments: [{ kind: "세금계산서", storage: "file" }],
    });
    expect(risk).toMatchObject({
      qualified: true,
      vatLost: null,
      penalty: null,
    });
  });

  it("증빙이 없으면 매입세액 10/110 과 가산세 2% 를 잃는다", () => {
    const risk = evidenceRisk({
      direction: "out",
      amount: 1_100_000,
      attachments: [],
    });
    // 1,100,000 × 10/110 = 100,000
    expect(risk.vatLost).toBe(100_000);
    expect(risk.penalty).toBe(22_000);
    expect(risk.qualified).toBe(false);
  });

  it("증빙 없음으로 등록해도 적격증빙이 붙은 것으로 치지 않는다", () => {
    const risk = evidenceRisk({
      direction: "out",
      amount: 1_100_000,
      attachments: [{ kind: "기타", storage: "none" }],
    });
    expect(risk.qualified).toBe(false);
    expect(risk.vatLost).toBe(100_000);
  });

  it("간이영수증은 비용은 되지만 매입세액과 가산세를 못 피한다", () => {
    const risk = evidenceRisk({
      direction: "out",
      amount: 500_000,
      attachments: [{ kind: "간이영수증", storage: "file" }],
    });
    expect(risk.qualified).toBe(false);
    expect(risk.penalty).toBe(10_000);
  });

  it("기준금액 이하면 가산세는 없고 매입세액만 잃는다", () => {
    const risk = evidenceRisk({
      direction: "out",
      amount: QUALIFIED_EVIDENCE_THRESHOLD,
      attachments: [],
    });
    expect(risk.penalty).toBeNull();
    expect(risk.vatLost).toBeGreaterThan(0);
  });

  it("접대비는 기준금액이 더 낮아 더 일찍 가산세가 붙는다", () => {
    const amount = ENTERTAINMENT_EVIDENCE_THRESHOLD + 1;
    expect(
      evidenceRisk({ direction: "out", amount, attachments: [] }).penalty
    ).toBeNull();
    expect(
      evidenceRisk({
        direction: "out",
        amount,
        isEntertainment: true,
        attachments: [],
      }).penalty
    ).toBeGreaterThan(0);
  });

  it("금액이 미확정이면 0 이 아니라 계산 불가로 답한다", () => {
    // 0 으로 채우면 "손해가 없다"로 읽힌다 — 그건 사실이 아니다 (§10.2 ①)
    const risk = evidenceRisk({
      direction: "out",
      amount: null,
      attachments: [],
    });
    expect(risk.vatLost).toBeNull();
    expect(risk.penalty).toBeNull();
    expect(risk.reasons.join(" ")).toContain("계산할 수 없습니다");
  });

  it("수입 건은 대상이 아니라고 답하되 적격증빙이 있다고 하지 않는다", () => {
    // qualified: true 로 돌려주면 화면이 「적격증빙 있음」으로 표시한다 — 증빙이 없는데도
    const risk = evidenceRisk({
      direction: "in",
      amount: 5_000_000,
      attachments: [],
    });
    expect(risk).toMatchObject({
      applicable: false,
      qualified: false,
      vatLost: null,
      penalty: null,
    });
  });
});
