import type { IncomeType } from "./withholding.js";
/**
 * 디노스튜디오 경영관리 시스템 — 1차 오픈 도메인 타입
 *
 * 개발 사양서 v1.0 (2026-08-27) §6.2 · §7 기준.
 * 금액은 전부 정수 원(KRW)이며 소수·부동소수 연산을 쓰지 않는다 (§15 · 원칙 8).
 * 모르는 값은 0이 아니라 null이고, null에는 항상 이유가 따라붙는다 (§10.2).
 */

/** §6.2 direction — 지출 / 수입 */
export type Direction = "out" | "in";

/** §7.2 상태 머신 */
export const ENTRY_STATUSES = [
  "undecided", // 판정 대기 — 금액·단위·항목명 미확정
  "pending", // 승인 대기 — 금액 확정, 사람의 승인만 남음
  "confirmed", // 확정 — 전표 자동 생성
  "rejected", // 반려
  "held", // 보류 — 중복 의심 · 증빙 대기
  "superseded", // 대체됨 — -R1이 생김
  "cancelled", // 취소 — -C가 상계
] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

/** §5.4 · §8 원가성격 — 관리회계 보조축 */
export type Nature =
  | "통과원가"
  | "직접원가"
  | "공통배부"
  | "해당없음"
  | "손익아님"
  | "미지정";

/** §8.2 지급 우선순위 */
export const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** §8.3 현금흐름 3구간 */
export type CashflowSection =
  | "영업"
  | "투자"
  | "재무"
  | "현금유출없음"
  | "판정불가";

/** §6.2 source — 중복 수집 방지 키의 앞자리 */
export type EntrySource =
  | "slack"
  | "bank"
  | "card"
  | "hometax"
  | "manual"
  | "migration";

/** §6.2 pay_method */
export type PayMethod = "계좌" | "법인카드" | "개인카드선결제" | "현금";

/** §6.2 bu_code (B11 — 사업부 구분 기준 미결) */
export type BuCode = "IP" | "NET" | "COM" | "GLV" | "CMN";

/** §6.3 app_user — 사람↔역할 배정. 환경변수가 아니라 화면에서 관리한다 (G13). */
export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
}

/** §13.1 역할 매트릭스 */
export const ROLES = [
  "대표",
  "부대표",
  "재무",
  "사업부리더",
  "담당자",
  "외부세무",
] as const;
export type Role = (typeof ROLES)[number];

/** §6.2 entry — 핵심 원장. 수입·지출·부채 이동이 한 테이블에 들어간다 (원칙 12). */
export interface Entry {
  id: string;
  /** 불변. EX-YYMMDD-NN / IN- / DB- / CT- (§7.1) */
  code: string;
  /** 수정본 -R1 · 취소본 -C가 가리키는 원본 */
  parentCode: string | null;
  direction: Direction;
  status: EntryStatus;
  /** 항목. 공란이면 status = undecided */
  title: string;
  /** 원문 적요 — 덮어쓰기 금지 */
  noteRaw: string | null;
  /** 정리 적요 */
  note: string | null;
  /** null = 판정 대기 → 어떤 합계에도 들어가지 않는다 (원칙 8) */
  amount: number | null;
  /**
   * 적요칸에 남아 있는 후보 금액. 원장 합계·손익·전표에는 절대 쓰지 않고
   * 현금 현황의 「판정 대기 포함」 토글에서만 참조한다 (§9.2 · T6).
   * 단위가 불명한 값(80 · 350 · 1,200)은 승격하지 않고 null로 둔다 (§5.2 · 원칙 8).
   */
  amountCandidate: number | null;
  amountSupply: number | null;
  amountVat: number | null;
  currency: string;
  /** 실제 입출금일 — 현금흐름표가 쓰는 날짜 */
  cashDate: string | null;
  /** 손익 귀속일 — 손익계산서가 쓰는 날짜 (B4) */
  accrualDate: string | null;
  startDate: string | null;
  deliverDate: string | null;
  requestDate: string | null;
  dueDate: string | null;
  /**
   * 실제 집행이 끝난 날. 사양서 §6.2에는 없는 필드다 —
   * §9.2 필요액은 「앞으로 막아야 할 돈」이므로 이미 나간 확정 건을 제외해야만
   * 사양서가 제시한 부족액 3종이 재현된다. docs/erp-spec-gaps.md 참조.
   */
  paidAt: string | null;
  /** 비면 전표 생성 불가 (§10.3 account_required) */
  accountCode: string | null;
  nature: Nature | null;
  buCode: BuCode | null;
  projectId: string | null;
  partyId: string | null;
  contractId: string | null;
  /** 계정으로 자동 부여 (§8.2) */
  priority: Priority | null;
  /** 사람이 올린 등급. 설정 시 priorityReason 필수 */
  priorityOverride: Priority | null;
  priorityReason: string | null;
  payMethod: PayMethod | null;
  bankAccount: string | null;
  /** 계산서 발행 O/X — 미수 판정에 사용 (원칙 4) */
  invoiceIssued: boolean | null;
  invoiceNo: string | null;
  /**
   * 계산서 발행일. §9.3의 `due_date = invoice_date + contract.payment_terms.days`가
   * 참조하는 값인데 §6.2 필드 목록에는 없습니다. docs/erp-spec-gaps.md 참조.
   */
  invoiceDate: string | null;
  source: EntrySource;
  /** 슬랙 ts · 계산서 번호 등 — UNIQUE(source, sourceRef) */
  sourceRef: string | null;
  /** 회차 — IP 사업부의 원가 귀속 단위 (§11.1 신규 필드) */
  roundNo: number | null;
  /** 대응 매출 코드 — 통과원가 판정의 근거 (§11.1 신규 필드) */
  linkedRevenueCode: string | null;
  /** "적요칸 금액" · "단위 불명" · "항목명 없음" · "중복 의심" */
  undecidedReason: string | null;
  /** 증빙 유무 — 없으면 확정 불가 (§13.2) */
  hasEvidence: boolean;
  /**
   * 개인이 식별되는 인건비 건인가. 사양서 §6.2에는 없는 필드다 —
   * 원칙 10("개인별 급여는 어느 화면에도 표시하지 않는다. 총액만")을 응답 단계에서
   * 지키려면 전사 총액 건과 개인 건을 구분할 수 있어야 한다. docs/erp-spec-gaps.md 참조.
   */
  isPersonal: boolean;
  /**
   * 지급 대상의 소득 구분 — 있으면 전표에서 원천징수를 분리한다 (docs/erp-qa.md A2).
   * 없으면 분리하지 않는다. 모르는 세금을 만들어 내면 신고가 틀린다.
   */
  incomeType?: IncomeType | null;
  /** 근로소득처럼 비율로 계산할 수 없는 경우의 원천징수 실액 */
  withheldAmount?: number | null;
  /**
   * 차입 상환 건의 원금 몫 (docs/erp-qa.md C3).
   * 있으면 전표를 원금(부채 감소) + 이자(비용)로 나눈다.
   * 나머지가 이자이므로 이자액을 따로 받지 않는다 — 두 값을 받으면 합이 어긋날 수 있다.
   */
  principalAmount?: number | null;
  /** 낙관적 잠금 (§4 동시성) */
  version: number;
  createdAt: string;
  createdBy: string;
}

/** §6.3 day_snapshot — 이관 구간 일계. 이 구간은 원장이 아니다 (§5.3). */
export interface DaySnapshot {
  date: string;
  open: number | null;
  inSum: number;
  outSum: number;
  close: number | null;
  note: string | null;
  isMigrated: boolean;
}

/** §6.3 account — 계정과목 마스터. 자동 판정 3종이 전부 이 테이블 컬럼에서 나온다 (§8). */
export interface Account {
  code: string;
  name: string;
  /** 대분류 — 매출 / 매출원가 / 판관비 / 영업외수익 / 영업외비용 / 자산 / 부채 / 자본 */
  type: string;
  parentCode: string | null;
  cfSection: CashflowSection;
  isOpex: boolean;
  defaultPriority: Priority | null;
  active: boolean;
}

/** §6.3 approval */
export interface Approval {
  id: string;
  entryId: string;
  step: number;
  approverRole: Role;
  actor: string;
  decision: "approve" | "reject" | "hold";
  reason: string | null;
  at: string;
}

/** §6.3 entry_revision — 화면의 「이력」 탭이 이걸 그대로 그린다. */
export interface EntryRevision {
  id: string;
  entryId: string;
  version: number;
  before: Partial<Entry> | null;
  after: Partial<Entry> | null;
  reason: string | null;
  actor: string;
  at: string;
}

/** §6.3 attachment — 증빙. 파일 업로드분과 드라이브 링크를 함께 받는다 (§11.2). */
export interface Attachment {
  id: string;
  entryId: string;
  /** EVIDENCE_KINDS 의 종류 — 적격/비적격과 매입세액 공제 여부가 여기서 갈린다 */
  kind: string;
  /** 원본 파일명 (링크·증빙없음은 null) */
  fileName: string | null;
  /** 열람 주소 — 업로드분은 스토리지 키, 링크 등록분은 원본 URL, 증빙없음은 빈 문자열 */
  url: string;
  /**
   * file = 이 시스템에 올린 파일 · link = 드라이브 등 외부 링크
   * none = 증빙이 실제로 없는 건. 사유를 반드시 받고 손해액을 계산해 보여 준다.
   */
  storage: "file" | "link" | "none";
  /** 증빙 없이(none) 등록한 사유 — 그 경우 필수 */
  reason: string | null;
  sizeBytes: number | null;
  contentType: string | null;
  uploadedBy: string;
  at: string;
}

/** §6.3 audit_log — 전 테이블 변경 이력. 민감 테이블은 조회도 기록. */
export interface AuditLog {
  id: string;
  table: string;
  rowId: string;
  action: string;
  before: unknown;
  after: unknown;
  actor: string;
  ip: string | null;
  at: string;
}

/** §6.3 setting — 임시 기본값과 기준값이 전부 여기. */
export interface Setting {
  key: string;
  value: unknown;
  /** true면 화면에 「임시」 배지 */
  isProvisional: boolean;
  ownerRole: Role | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** §10.2 ③ 합계에는 무엇이 빠졌는지가 붙는다. */
export interface ExcludedBucket {
  n: number;
  amount: number | null;
}

export interface SumWithExclusions {
  sum: number;
  count: number;
  excluded: {
    pending: ExcludedBucket;
    undecided: ExcludedBucket;
  };
}

/** §10.2 ② 모든 지표는 확정도를 달고 나온다. */
export type Confidence = "확정" | "추정" | "N";

export interface Metric {
  value: number | null;
  label: string;
  confidence: Confidence;
  nullReason: string | null;
  blockedBy: string[];
}

/** §6.3 journal — 확정 시 자동 생성. 사람이 분개를 만들지 않는다 (원칙 12). */
export interface JournalLine {
  id: string;
  journalId: string;
  accountCode: string;
  debit: number;
  credit: number;
  buCode: BuCode | null;
  projectId: string | null;
}

export interface Journal {
  id: string;
  entryId: string;
  journalDate: string;
  memo: string | null;
  auto: boolean;
  reversedBy: string | null;
  lines: JournalLine[];
}

/* ─── 2차 — §6.3 나머지 테이블 ────────────────────────────────────────────── */

/** party — 거래처. vat_mode가 사업부별 표기 차이를 흡수한다 (B3). */
export interface Party {
  id: string;
  name: string;
  bizNo: string | null;
  bankAccount: string | null;
  /** "vat별도" · "VAT포함" · null(미확정) — B3 */
  vatMode: string | null;
  contact: string | null;
  memo: string | null;
}

/** contract — 입금예정일 산출의 근거 (§9.3) */
export interface Contract {
  id: string;
  /** CT-YYMMDD-NN */
  code: string;
  partyId: string | null;
  projectId: string | null;
  amountTotal: number | null;
  /** 회차 — [{ n, amount, dueRule }] */
  installments: { n: number; amount: number | null; note: string | null }[];
  /** "계산서 발행 후 N일" 형태 — days가 null이면 입금예정일을 산출할 수 없다 */
  paymentTermsDays: number | null;
  paymentTermsText: string | null;
  driveUrl: string | null;
  isAgency: boolean;
}

/** project — 프로젝트 마진의 귀속 단위 */
export interface Project {
  id: string;
  code: string;
  name: string;
  buCode: BuCode | null;
  status: string;
  budget: number | null;
  startDate: string | null;
  endDate: string | null;
}

/** debt — maturity_date가 null이면 만기 알람이 발동하지 않는다 (B2) */
export interface Debt {
  id: string;
  /** DB-YYMMDD-NN */
  code: string;
  creditor: string;
  /** null = 건별 잔액 미분해 (장기 7.9억) */
  principal: number | null;
  rate: number | null;
  maturityDate: string | null;
  repayType: string | null;
  isRelatedParty: boolean;
  /** 월 이자 실액 — 약정서가 없어도 실제 지급액으로 확인된 것 */
  monthlyInterest: number | null;
  term: "단기" | "장기";
  docUrl: string | null;
}

/** debt_schedule — 13주 계획의 상환 라인 */
export interface DebtSchedule {
  id: string;
  debtId: string;
  dueDate: string;
  principal: number;
  interest: number;
}

/** intake — 수집 검수함. 원장 진입 전 대기열이며 파싱 실패도 여기 남는다. */
export interface Intake {
  id: string;
  source: EntrySource;
  sourceRef: string | null;
  raw: string;
  parsed: Record<string, unknown> | null;
  /** waiting · parsed · failed · promoted · rejected */
  status: string;
  failReason: string | null;
  entryId: string | null;
  receivedAt: string;
}

/** notification_rule / notification — 미발송이어도 알림함에 적재된다 (B7) */
export interface NotificationRule {
  id: string;
  trigger: string;
  /** T0 즉시 · T1 당일 · T2 주간 · T3 월간 */
  tier: string;
  recipients: string[];
  channel: string;
  active: boolean;
  /** 발동 불가 사유 — 만기 미확인 등 */
  blockedReason: string | null;
}

export interface Notification {
  id: string;
  ruleId: string;
  title: string;
  body: string;
  /** 이동할 화면 */
  screen: string | null;
  sentAt: string | null;
  readAt: string | null;
  createdAt: string;
}

/** period — 월 마감 잠금 (3차) */
export interface Period {
  /** YYYY-MM */
  ym: string;
  status: "open" | "closing" | "closed";
  closedBy: string | null;
  closedAt: string | null;
  blockers: string[];
}
