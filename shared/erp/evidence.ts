/**
 * 증빙 종류와 세무 결과.
 *
 * 증빙은 「있다/없다」가 아니라 **어떤 종류인가**가 돈을 가른다.
 *   · 적격증빙이 아니면 3만원 초과 지출에 증빙불비가산세가 붙는다 (법인세법 §75-5)
 *   · 세금계산서·신용카드전표·현금영수증이 아니면 매입세액을 공제받지 못한다
 * 그래서 종류를 자유 텍스트로 두면 나중에 "얼마를 손해봤는지"를 계산할 수 없다.
 *
 * 「기타(증빙 없음)」도 허용한다 — 실제로 증빙이 없는 지출이 존재하기 때문이다.
 * 다만 사유를 반드시 받고, 손해 금액을 계산해 화면에 남긴다.
 * 막는 것이 아니라 **보이게 하는 것**이 이 시스템의 방식이다 (원칙 8).
 *
 * ※ 아래 기준금액·세율은 세무대리인 확인 후 확정해야 한다 — docs/erp-spec-gaps.md 참조.
 */

/** 적격증빙이 필요한 지출 기준금액 — 이 금액 초과부터 가산세 대상 */
export const QUALIFIED_EVIDENCE_THRESHOLD = 30_000;
/** 접대비는 기준이 더 낮다 */
export const ENTERTAINMENT_EVIDENCE_THRESHOLD = 10_000;
/** 증빙불비가산세율 */
export const EVIDENCE_PENALTY_RATE = 0.02;
/** 부가세율 — 공급대가에서 매입세액을 뽑을 때 10/110 을 쓴다 */
export const VAT_RATE = 0.1;

export interface EvidenceKindSpec {
  kind: string;
  /** 법인세법상 적격증빙인가 — 아니면 가산세 대상 */
  qualified: boolean;
  /** 매입세액 공제가 되는가 */
  vatDeductible: boolean;
  /** 이 종류를 고르는 기준 */
  note: string;
}

export const EVIDENCE_KINDS: readonly EvidenceKindSpec[] = [
  {
    kind: "세금계산서",
    qualified: true,
    vatDeductible: true,
    note: "과세 매입의 기본. 매입세액 공제와 비용 인정이 모두 된다",
  },
  {
    kind: "계산서",
    qualified: true,
    vatDeductible: false,
    note: "면세 거래용. 적격증빙이지만 애초에 매입세액이 없다",
  },
  {
    kind: "신용카드전표",
    qualified: true,
    vatDeductible: true,
    note: "법인카드 사용분. 사업 관련성이 있어야 공제된다",
  },
  {
    kind: "현금영수증",
    qualified: true,
    vatDeductible: true,
    note: "사업자 지출증빙용으로 발급받은 것만 해당한다",
  },
  {
    kind: "간이영수증",
    qualified: false,
    vatDeductible: false,
    note: "기준금액 초과 시 가산세 대상. 비용 인정은 되나 매입세액은 못 받는다",
  },
  {
    kind: "이체확인증",
    qualified: false,
    vatDeductible: false,
    note: "지급 사실만 증명한다. 세금계산서를 따로 받아야 한다",
  },
  {
    kind: "계약서",
    qualified: false,
    vatDeductible: false,
    note: "거래 근거. 증빙을 대신하지 못하므로 세금계산서와 함께 둔다",
  },
  {
    kind: "거래명세서",
    qualified: false,
    vatDeductible: false,
    note: "내역 확인용 보조 자료",
  },
  {
    kind: "급여명세서",
    qualified: false,
    vatDeductible: false,
    note: "인건비는 원천징수로 갈음한다 — 적격증빙 대상이 아니다",
  },
  {
    kind: "원천징수영수증",
    qualified: false,
    vatDeductible: false,
    note: "사업소득·기타소득 지급분. 3.3% 원천징수 건",
  },
  {
    kind: "기타",
    qualified: false,
    vatDeductible: false,
    note: "위에 없는 것. 무엇인지 사유에 적어야 한다",
  },
] as const;

export const EVIDENCE_KIND_NAMES = EVIDENCE_KINDS.map(k => k.kind);

export function evidenceKindSpec(kind: string): EvidenceKindSpec | null {
  return EVIDENCE_KINDS.find(k => k.kind === kind) ?? null;
}

/** 증빙이 없는 건에 쓰는 종류 — 다른 종류와 함께 쓸 수 없다 */
export const NO_EVIDENCE_KIND = "기타";

/** 증빙을 어디에 두었는가 */
export type EvidenceStorage = "file" | "link" | "none";

export const EVIDENCE_STORAGE_LABEL: Record<EvidenceStorage, string> = {
  file: "파일 첨부",
  link: "외부 링크",
  none: "증빙 없음",
};

/**
 * 증빙 없음(none)으로 등록할 때 사유는 필수다.
 * 사유가 없으면 나중에 "왜 없는지" 아는 사람이 사라지고, 그 시점에 복구가 불가능해진다.
 */
export const MIN_NO_EVIDENCE_REASON_LENGTH = 5;

export interface EvidenceCheckInput {
  kind: string;
  storage: EvidenceStorage;
  url?: string | null;
  reason?: string | null;
}

/** 등록 가능한 조합인가 — 문제가 있으면 사람이 읽을 문장을 돌려준다 */
export function checkEvidenceInput(input: EvidenceCheckInput): string | null {
  if (!evidenceKindSpec(input.kind))
    return `증빙 종류 "${input.kind}" 는 목록에 없습니다`;

  if (input.storage === "none") {
    if (input.kind !== NO_EVIDENCE_KIND)
      return `증빙이 없는 건의 종류는 「${NO_EVIDENCE_KIND}」여야 합니다 — 받지 못한 ${input.kind}를 ${input.kind}로 기록하면 나중에 있는 것으로 읽힙니다`;
    const reason = (input.reason ?? "").trim();
    if (reason.length < MIN_NO_EVIDENCE_REASON_LENGTH)
      return `증빙 없이 등록하려면 사유를 ${MIN_NO_EVIDENCE_REASON_LENGTH}자 이상 적어야 합니다 — 나중에 왜 없었는지 아는 사람이 남지 않습니다`;
    return null;
  }

  if (input.storage === "link") {
    const url = (input.url ?? "").trim();
    if (!url) return "링크 주소가 비어 있습니다";
    // 외부 링크는 http(s) 만 — 로컬 경로나 스크립트 주소가 들어오면 안 된다
    if (!/^https?:\/\//i.test(url))
      return "링크는 http:// 또는 https:// 로 시작해야 합니다";
  }

  return null;
}

export interface EvidenceRisk {
  /**
   * 매입 증빙 규칙이 적용되는 건인가.
   * 수입 건은 애초에 대상이 아니므로, qualified 를 true 로 돌려주면
   * 「적격증빙 있음」으로 읽혀 거짓이 된다. 그래서 따로 둔다.
   */
  applicable: boolean;
  /** 적격증빙이 하나라도 붙어 있는가 */
  qualified: boolean;
  /** 못 받게 되는 매입세액 — 적격 증빙이 없을 때만 값이 있다 */
  vatLost: number | null;
  /** 증빙불비가산세 예상액 */
  penalty: number | null;
  /** 사람이 읽을 판정 이유 */
  reasons: string[];
}

/**
 * 이 지출이 증빙 때문에 잃는 돈.
 *
 * 지출이 아니거나 금액이 아직 없으면 계산하지 않고 null 을 준다 —
 * 0 으로 채우면 "손해가 없다"로 읽히는데 그건 사실이 아니다 (§10.2 ①).
 */
export function evidenceRisk(input: {
  direction: "out" | "in";
  amount: number | null;
  isEntertainment?: boolean;
  attachments: { kind: string; storage: EvidenceStorage }[];
}): EvidenceRisk {
  const reasons: string[] = [];

  if (input.direction !== "out")
    return {
      applicable: false,
      qualified: false,
      vatLost: null,
      penalty: null,
      reasons: ["수입 건은 매입 증빙 대상이 아닙니다"],
    };

  const specs = input.attachments
    .filter(a => a.storage !== "none")
    .map(a => evidenceKindSpec(a.kind))
    .filter((s): s is EvidenceKindSpec => s != null);

  const qualified = specs.some(s => s.qualified);
  const deductible = specs.some(s => s.vatDeductible);

  if (input.amount == null) {
    reasons.push("금액이 확정되지 않아 손해액을 계산할 수 없습니다");
    return {
      applicable: true,
      qualified,
      vatLost: null,
      penalty: null,
      reasons,
    };
  }

  const threshold = input.isEntertainment
    ? ENTERTAINMENT_EVIDENCE_THRESHOLD
    : QUALIFIED_EVIDENCE_THRESHOLD;

  // 매입세액 — 공급대가에서 10/110
  let vatLost: number | null = null;
  if (!deductible) {
    vatLost = Math.round((input.amount * VAT_RATE) / (1 + VAT_RATE));
    reasons.push(
      specs.length === 0
        ? "적격증빙이 없어 매입세액을 공제받지 못합니다"
        : "붙어 있는 증빙으로는 매입세액 공제가 되지 않습니다"
    );
  }

  // 가산세 — 기준금액 초과 + 적격증빙 없음
  let penalty: number | null = null;
  if (!qualified && input.amount > threshold) {
    penalty = Math.round(input.amount * EVIDENCE_PENALTY_RATE);
    reasons.push(
      `${threshold.toLocaleString("ko-KR")}원을 넘는 지출에 적격증빙이 없어 증빙불비가산세 대상입니다`
    );
  }

  if (qualified && deductible) reasons.push("적격증빙이 붙어 있습니다");

  return { applicable: true, qualified, vatLost, penalty, reasons };
}
