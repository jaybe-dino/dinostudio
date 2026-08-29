/**
 * 2차 시드 — 채권 · 부채 · 마스터.
 *
 * §5.4의 원장 27건은 08/25까지의 시트 이관 결과이고 여기 건드리지 않습니다.
 * 이 파일은 §9.3 채권 표 · §9.4 부채 5건 · 프로토타입 채권 화면에서 옮긴 것이며,
 * 원장에 **수입 미입금 건**으로 추가되므로 확정 지출·확정 수입 합계는 바뀌지 않습니다
 * (status = pending · cash_date 없음 → 현금흐름 계에 들어가지 않음).
 */
import type { Debt, Entry, Party, Project, Setting } from "./types";

export const SEED_PARTIES: Party[] = [
  party("PTY-0001", "하드렐"),
  party("PTY-0002", "플로우링크"),
  party("PTY-0003", "콜랩"),
  party("PTY-0004", "마이유니버스 (셀락)"),
  party("PTY-0005", "페르소나AI"),
  party("PTY-0006", "줄컴퍼니"),
  party("PTY-0007", "액티브스"),
  party("PTY-0008", "퍼스트메카"),
  party("PTY-0009", "스튜디오A"),
  party("PTY-0010", "스튜디오 씽"),
  party("PTY-0011", "GLOVEK"),
];

function party(id: string, name: string): Party {
  return {
    id,
    name,
    bizNo: null,
    bankAccount: null,
    vatMode: null,
    contact: null,
    memo: null,
  };
}

export const SEED_PROJECTS: Project[] = [
  {
    id: "PRJ-0132",
    code: "PRJ-0132",
    name: "콜랩 의적단2",
    buCode: "IP",
    status: "진행",
    budget: null,
    startDate: null,
    endDate: null,
  },
];

/**
 * §9.4 차입 5건. 만기·이자율·상환조건이 전건 미확인이므로 알람은 등록돼도 울리지 않습니다 (B2).
 * 장기 3건은 건별 잔액이 분해되지 않아 principal을 null로 둡니다 — 추정하지 않습니다 (원칙 8).
 */
export const SEED_DEBTS: Debt[] = [
  {
    id: "DB-260827-01",
    code: "DB-260827-01",
    creditor: "조대표",
    principal: 150_000_000,
    rate: null,
    maturityDate: null,
    repayType: null,
    isRelatedParty: true,
    monthlyInterest: null,
    term: "단기",
    docUrl: null,
  },
  {
    id: "DB-260827-02",
    code: "DB-260827-02",
    creditor: "의장",
    principal: 90_000_000,
    rate: null,
    maturityDate: null,
    repayType: null,
    isRelatedParty: true,
    monthlyInterest: null,
    term: "단기",
    docUrl: null,
  },
  {
    id: "DB-260827-03",
    code: "DB-260827-03",
    creditor: "기본 차입",
    principal: null,
    rate: null,
    maturityDate: null,
    repayType: "이자 지급 중",
    isRelatedParty: false,
    monthlyInterest: 2_500_000,
    term: "장기",
    docUrl: null,
  },
  {
    id: "DB-260827-04",
    code: "DB-260827-04",
    creditor: "플로우링크",
    principal: null,
    rate: null,
    maturityDate: null,
    repayType: "이자 지급 중",
    isRelatedParty: false,
    monthlyInterest: 1_850_000,
    term: "장기",
    docUrl: null,
  },
  {
    id: "DB-260827-05",
    code: "DB-260827-05",
    creditor: "중진공",
    principal: null,
    rate: null,
    maturityDate: null,
    repayType: "장기 정책자금 · 이자 지급 중",
    isRelatedParty: false,
    monthlyInterest: 400_000,
    term: "장기",
    docUrl: null,
  },
];

interface ArInput {
  code: string;
  title: string;
  amount: number | null;
  partyId: string;
  invoiceIssued: boolean;
  invoiceNo?: string;
  invoiceDate?: string;
  dueDate?: string;
  projectId?: string;
  note: string;
}

/** §9.3 회수 후보 + 발행 대기 — 전부 미입금 수입 건 */
const AR_INPUT: ArInput[] = [
  // 계산서 발행 완료 = 채권 (원칙 4)
  {
    code: "IN-260806-01",
    title: "하드렐 4차",
    amount: 16_796_608,
    partyId: "PTY-0001",
    invoiceIssued: true,
    dueDate: "2026-08-20",
    note: "발행 완료 · 계산서 발행일이 원장에 없어 DSO 가중치를 만들 수 없습니다",
  },
  {
    code: "IN-260806-02",
    title: "플로우링크 정산",
    amount: 6_633_000,
    partyId: "PTY-0002",
    invoiceIssued: true,
    dueDate: "2026-08-20",
    note: "발행 완료 · 계산서 발행일 미확인",
  },
  {
    code: "IN-260812-01",
    title: "콜랩 의적단2 잔금",
    amount: 27_500_000,
    partyId: "PTY-0003",
    invoiceIssued: true,
    invoiceNo: "2026-0812-041",
    invoiceDate: "2026-08-12",
    projectId: "PRJ-0132",
    note: "계약 미등록 — 입금예정일 자동 산출 불가",
  },
  // 계산서 발행 전 = 채권이 아님. 별도 목록이고 DSO에서도 빠진다.
  {
    code: "IN-260827-01",
    title: "마이유니버스 (셀락)",
    amount: 115_500_000,
    partyId: "PTY-0004",
    invoiceIssued: false,
    note: "구두 합의 · 서면 확정서 미수령 — 계산서 발행 요건 미충족",
  },
  {
    code: "IN-260822-01",
    title: "페르소나AI × 머니클래스 잔금",
    amount: 6_600_000,
    partyId: "PTY-0005",
    invoiceIssued: false,
    note: "납품 완료 확인 08/22 · 검수 확인 대기",
  },
  {
    code: "IN-260822-02",
    title: "페르소나AI × EBN 잔금",
    amount: 5_500_000,
    partyId: "PTY-0005",
    invoiceIssued: false,
    note: "납품 완료 확인 08/22 · 검수 확인 대기",
  },
  {
    code: "IN-260827-02",
    title: "줄컴퍼니 중도금",
    amount: null,
    partyId: "PTY-0006",
    invoiceIssued: false,
    note: "시트 기재 원본 5500 · 단위 판별 불가 — 금액 확정 전까지 어느 합계에도 없음",
  },
];

function toArEntry(input: ArInput): Entry {
  return {
    id: input.code,
    code: input.code,
    parentCode: null,
    direction: "in",
    status: input.amount == null ? "undecided" : "pending",
    title: input.title,
    noteRaw: input.note,
    note: null,
    amount: input.amount,
    amountCandidate: null,
    amountSupply: null,
    amountVat: null,
    currency: "KRW",
    // 아직 들어오지 않은 돈이므로 실제 입출금일이 없다 — 현금흐름 계에 들어가지 않는다
    cashDate: null,
    accrualDate: input.invoiceDate ?? null,
    startDate: null,
    deliverDate: null,
    requestDate: null,
    dueDate: input.dueDate ?? null,
    paidAt: null,
    accountCode: "4100",
    nature: "해당없음",
    buCode: input.projectId ? "IP" : "NET",
    projectId: input.projectId ?? null,
    partyId: input.partyId,
    contractId: null,
    priority: null,
    priorityOverride: null,
    priorityReason: null,
    payMethod: null,
    bankAccount: null,
    invoiceIssued: input.invoiceIssued,
    invoiceNo: input.invoiceNo ?? null,
    invoiceDate: input.invoiceDate ?? null,
    source: "migration",
    sourceRef: `ar:${input.code}`,
    roundNo: null,
    linkedRevenueCode: null,
    undecidedReason: input.amount == null ? "단위 불명" : null,
    hasEvidence: input.invoiceIssued,
    isPersonal: false,
    version: 1,
    createdAt: "2026-08-27T00:00:00+09:00",
    createdBy: "migration",
  };
}

export const SEED_AR_ENTRIES: Entry[] = AR_INPUT.map(toArEntry);

export const SEED_STAGE2_SETTINGS: Setting[] = [
  {
    // §9.4 — 장기 7.9억은 건별로 분해되지 않았다. 총액만 보유한다.
    key: "debt_long_term_total",
    value: 790_000_000,
    isProvisional: true,
    ownerRole: "재무",
    updatedBy: "migration",
    updatedAt: "2026-08-27T00:00:00+09:00",
  },
  {
    // §9.5 B10 — 상/중/하 성사확률. 확정 전까지 파이프라인을 예측에 넣지 않는다.
    key: "pipeline_probability",
    value: null,
    isProvisional: true,
    ownerRole: "대표",
    updatedBy: null,
    updatedAt: null,
  },
  {
    key: "today_override",
    value: "2026-08-27",
    isProvisional: true,
    ownerRole: "재무",
    updatedBy: "migration",
    updatedAt: "2026-08-27T00:00:00+09:00",
  },
];
