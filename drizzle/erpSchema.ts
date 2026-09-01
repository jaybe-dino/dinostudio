/**
 * 경영관리 시스템 1차 오픈 테이블 (개발 사양서 §6)
 *
 * 사양서 §15는 PostgreSQL을 권고하지만 이 레포는 MySQL(mysql2 + drizzle)로 운영된다.
 * 사양서가 실제로 요구하는 것은 "정확한 정수 원 · 부동소수 금지"이므로 금액은 전부
 * BIGINT(정수 원)로 잡는다 — DECIMAL/FLOAT를 쓰지 않는다.
 * 물리 삭제는 제공하지 않는다 (원칙 9) — 어떤 코드도 DELETE를 실행하지 않는다.
 */
import {
  bigint,
  boolean,
  date,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * 환율 저장 배율 (A8). 이 파일은 DECIMAL/FLOAT 를 쓰지 않으므로 환율도 정수로
 * 저장한다 — 1,350.25 원/USD → 13,502,500.
 */
export const FX_RATE_SCALE = 10_000;

export const ENTRY_STATUS_VALUES = [
  "undecided",
  "pending",
  "confirmed",
  "rejected",
  "held",
  "superseded",
  "cancelled",
] as const;

export const NATURE_VALUES = [
  "통과원가",
  "직접원가",
  "공통배부",
  "해당없음",
  "손익아님",
  "미지정",
] as const;
export const PRIORITY_VALUES = ["P0", "P1", "P2", "P3"] as const;
export const CF_SECTION_VALUES = [
  "영업",
  "투자",
  "재무",
  "현금유출없음",
  "판정불가",
] as const;
export const SOURCE_VALUES = [
  "slack",
  "bank",
  "card",
  "hometax",
  "manual",
  "migration",
] as const;
export const PAY_METHOD_VALUES = [
  "계좌",
  "법인카드",
  "개인카드선결제",
  "현금",
] as const;
export const BU_VALUES = ["IP", "NET", "COM", "GLV", "CMN"] as const;
export const ROLE_VALUES = [
  "대표",
  "부대표",
  "재무",
  "사업부리더",
  "담당자",
  "외부세무",
  // 읽기 전용 — 감사인·투자자 (docs/erp-qa.md D5)
  "외부열람",
] as const;

/** §8.1 계정과목 마스터 — 자동 판정 3종이 전부 이 테이블 컬럼에서 나온다 */
export const erpAccounts = mysqlTable("erp_account", {
  code: varchar("code", { length: 8 }).primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  type: varchar("type", { length: 40 }).notNull(),
  parentCode: varchar("parentCode", { length: 8 }),
  cfSection: mysqlEnum("cfSection", CF_SECTION_VALUES).notNull(),
  isOpex: boolean("isOpex").notNull().default(false),
  defaultPriority: mysqlEnum("defaultPriority", PRIORITY_VALUES),
  active: boolean("active").notNull().default(true),
});

/** §6.2 entry — 핵심 원장 (원칙 12 · 단일 원본) */
export const erpEntries = mysqlTable(
  "erp_entry",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    /** 불변 (§7.1) */
    code: varchar("code", { length: 32 }).notNull(),
    parentCode: varchar("parentCode", { length: 32 }),
    direction: mysqlEnum("direction", ["out", "in"]).notNull(),
    status: mysqlEnum("status", ENTRY_STATUS_VALUES).notNull(),
    title: varchar("title", { length: 300 }).notNull().default(""),
    /** 원문 적요 — 덮어쓰기 금지 */
    noteRaw: text("noteRaw"),
    note: text("note"),
    /** 정수 원. null = 판정 대기 → 어떤 합계에도 들어가지 않는다 */
    amount: bigint("amount", { mode: "number" }),
    /** 적요칸 후보 금액 — §9.2 토글에서만 참조 */
    amountCandidate: bigint("amountCandidate", { mode: "number" }),
    amountSupply: bigint("amountSupply", { mode: "number" }),
    amountVat: bigint("amountVat", { mode: "number" }),
    currency: varchar("currency", { length: 3 }).notNull().default("KRW"),
    cashDate: date("cashDate", { mode: "string" }),
    accrualDate: date("accrualDate", { mode: "string" }),
    startDate: date("startDate", { mode: "string" }),
    deliverDate: date("deliverDate", { mode: "string" }),
    requestDate: date("requestDate", { mode: "string" }),
    dueDate: date("dueDate", { mode: "string" }),
    paidAt: date("paidAt", { mode: "string" }),
    accountCode: varchar("accountCode", { length: 8 }),
    nature: mysqlEnum("nature", NATURE_VALUES),
    buCode: mysqlEnum("buCode", BU_VALUES),
    projectId: varchar("projectId", { length: 36 }),
    partyId: varchar("partyId", { length: 36 }),
    contractId: varchar("contractId", { length: 36 }),
    priority: mysqlEnum("priority", PRIORITY_VALUES),
    priorityOverride: mysqlEnum("priorityOverride", PRIORITY_VALUES),
    /** priorityOverride가 있으면 필수 — 애플리케이션과 함께 CHECK로도 막는다 */
    priorityReason: text("priorityReason"),
    payMethod: mysqlEnum("payMethod", PAY_METHOD_VALUES),
    bankAccount: varchar("bankAccount", { length: 64 }),
    invoiceIssued: boolean("invoiceIssued"),
    invoiceNo: varchar("invoiceNo", { length: 64 }),
    /** §9.3 입금예정일 산출의 기준일 */
    invoiceDate: date("invoiceDate", { mode: "string" }),
    source: mysqlEnum("source", SOURCE_VALUES).notNull(),
    sourceRef: varchar("sourceRef", { length: 190 }),
    /** §11.1 슬랙 양식에 추가가 필요한 필드 */
    roundNo: int("roundNo"),
    linkedRevenueCode: varchar("linkedRevenueCode", { length: 32 }),
    undecidedReason: varchar("undecidedReason", { length: 300 }),
    hasEvidence: boolean("hasEvidence").notNull().default(false),
    /** 개인이 식별되는 인건비 건 — 응답 단계 마스킹 대상 (§13.3) */
    isPersonal: boolean("isPersonal").notNull().default(false),
    /**
     * 원천징수 · 상환 · 급여 분할의 근거값 (docs/erp-qa.md A2 · C3 · B6).
     * 전표가 이 값들로 갈라지므로 원장에 남아야 한다 — 화면에서만 받으면
     * DB 를 한 번 돌고 온 뒤 전표를 다시 만들 수 없다.
     */
    incomeType: varchar("incomeType", { length: 20 }),
    withheldAmount: bigint("withheldAmount", { mode: "number" }),
    principalAmount: bigint("principalAmount", { mode: "number" }),
    /** 4대보험 근로자 부담분 — 예수금 (B6) */
    employeeInsurance: bigint("employeeInsurance", { mode: "number" }),
    /** 4대보험 사업주 부담분 — 비용이자 예수금 (B6) */
    employerInsurance: bigint("employerInsurance", { mode: "number" }),
    /** 외화 원문 금액 — amount 는 항상 원화다 (A8) */
    amountForeign: bigint("amountForeign", { mode: "number" }),
    /**
     * 적용 환율 × 10,000 (1 외화당 원화). 이 파일의 규칙대로 DECIMAL/FLOAT 를
     * 쓰지 않기 위해 정수로 저장한다 — 1,350.25 원/USD 는 13,502,500 이다.
     */
    fxRateScaled: bigint("fxRateScaled", { mode: "number" }),
    /** 이연 개월 수 — 손익만 월할로 나눈다 (A7) */
    deferralMonths: int("deferralMonths"),
    /** 낙관적 잠금 (§4) */
    version: int("version").notNull().default(1),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    createdBy: varchar("createdBy", { length: 64 }).notNull(),
  },
  table => [
    uniqueIndex("erp_entry_code_uq").on(table.code),
    // 같은 슬랙 메시지가 두 번 들어오지 않게 (§6.2 · T9)
    uniqueIndex("erp_entry_source_ref_uq").on(table.source, table.sourceRef),
    index("erp_entry_cash_date_idx").on(table.cashDate),
    index("erp_entry_status_idx").on(table.status),
  ]
);

/** §6.3 entry_revision — 화면의 「이력」 탭 */
export const erpEntryRevisions = mysqlTable(
  "erp_entry_revision",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    entryId: varchar("entryId", { length: 36 }).notNull(),
    version: int("version").notNull(),
    before: json("before"),
    after: json("after"),
    reason: text("reason"),
    actor: varchar("actor", { length: 64 }).notNull(),
    at: timestamp("at").defaultNow().notNull(),
  },
  table => [index("erp_entry_revision_entry_idx").on(table.entryId)]
);

/** §6.3 approval — 다단계 승인 이력 */
export const erpApprovals = mysqlTable(
  "erp_approval",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    entryId: varchar("entryId", { length: 36 }).notNull(),
    step: int("step").notNull().default(1),
    approverRole: mysqlEnum("approverRole", ROLE_VALUES).notNull(),
    actor: varchar("actor", { length: 64 }).notNull(),
    decision: mysqlEnum("decision", ["approve", "reject", "hold"]).notNull(),
    reason: text("reason"),
    at: timestamp("at").defaultNow().notNull(),
  },
  table => [index("erp_approval_entry_idx").on(table.entryId)]
);

/** §6.3 day_snapshot — 이관 구간 일계 + 이관 검증 기준값 (§5.4) */
export const erpDaySnapshots = mysqlTable("erp_day_snapshot", {
  date: date("date", { mode: "string" }).primaryKey(),
  open: bigint("open", { mode: "number" }),
  inSum: bigint("inSum", { mode: "number" }).notNull().default(0),
  outSum: bigint("outSum", { mode: "number" }).notNull().default(0),
  close: bigint("close", { mode: "number" }),
  /** 이관 전 시트가 기록하고 있던 값 — V1 대조용 */
  sheetOpen: bigint("sheetOpen", { mode: "number" }),
  sheetClose: bigint("sheetClose", { mode: "number" }),
  note: text("note"),
  isMigrated: boolean("isMigrated").notNull().default(true),
});

/** §6.3 attachment — 증빙 */
export const erpAttachments = mysqlTable(
  "erp_attachment",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    entryId: varchar("entryId", { length: 36 }).notNull(),
    kind: varchar("kind", { length: 40 }).notNull(),
    fileName: varchar("fileName", { length: 300 }),
    url: text("url").notNull(),
    /**
     * file = 이 시스템에 올린 파일 · link = 드라이브 등 외부 링크 (§11.2)
     * none = 증빙이 실제로 없는 건 — 사유(reason)를 반드시 함께 받는다
     */
    storage: mysqlEnum("storage", ["file", "link", "none"])
      .notNull()
      .default("link"),
    /** 증빙 없이 등록한 사유. storage=none 일 때만 채워진다 */
    reason: text("reason"),
    sizeBytes: bigint("sizeBytes", { mode: "number" }),
    contentType: varchar("contentType", { length: 120 }),
    uploadedBy: varchar("uploadedBy", { length: 64 }).notNull(),
    at: timestamp("at").defaultNow().notNull(),
  },
  table => [index("erp_attachment_entry_idx").on(table.entryId)]
);

/** §6.3 setting — 임시 기본값과 기준값 */
export const erpSettings = mysqlTable("erp_setting", {
  key: varchar("key", { length: 80 }).primaryKey(),
  value: json("value"),
  isProvisional: boolean("isProvisional").notNull().default(true),
  ownerRole: mysqlEnum("ownerRole", ROLE_VALUES),
  updatedBy: varchar("updatedBy", { length: 64 }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow(),
});

/** §6.3 audit_log — 전 테이블 변경 이력. 민감 테이블은 조회도 기록. */
export const erpAuditLogs = mysqlTable(
  "erp_audit_log",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tableName: varchar("tableName", { length: 64 }).notNull(),
    rowId: varchar("rowId", { length: 64 }).notNull(),
    action: varchar("action", { length: 40 }).notNull(),
    before: json("before"),
    after: json("after"),
    actor: varchar("actor", { length: 64 }).notNull(),
    ip: varchar("ip", { length: 64 }),
    at: timestamp("at").defaultNow().notNull(),
  },
  table => [index("erp_audit_log_row_idx").on(table.tableName, table.rowId)]
);

/**
 * §6.3 journal / journal_line — 원장 확정 시 자동 생성. 수기 생성 API를 노출하지 않는다 (원칙 12).
 * 사양서는 3차로 잡았으나 인수 기준 T1 ⑤가 1차에서 전표 1건 자동 생성을 요구한다.
 */
export const erpJournals = mysqlTable(
  "erp_journal",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    entryId: varchar("entryId", { length: 36 }).notNull(),
    /** 사람이 읽는 전표 번호 — 2026-08-0001 (docs/erp-qa.md A14) */
    journalNo: varchar("journalNo", { length: 16 }),
    journalDate: date("journalDate", { mode: "string" }).notNull(),
    memo: text("memo"),
    auto: boolean("auto").notNull().default(true),
    reversedBy: varchar("reversedBy", { length: 36 }),
  },
  table => [index("erp_journal_entry_idx").on(table.entryId)]
);

export const erpJournalLines = mysqlTable(
  "erp_journal_line",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    journalId: varchar("journalId", { length: 36 }).notNull(),
    accountCode: varchar("accountCode", { length: 8 }).notNull(),
    /** 차변 합 == 대변 합 — 애플리케이션과 함께 CHECK로도 막는다 */
    debit: bigint("debit", { mode: "number" }).notNull().default(0),
    credit: bigint("credit", { mode: "number" }).notNull().default(0),
    buCode: mysqlEnum("buCode", BU_VALUES),
    projectId: varchar("projectId", { length: 36 }),
  },
  table => [index("erp_journal_line_journal_idx").on(table.journalId)]
);

/** §13.1 권한 매트릭스 */
export const erpUsers = mysqlTable("erp_user", {
  id: varchar("id", { length: 36 }).primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  role: mysqlEnum("role", ROLE_VALUES).notNull(),
  active: boolean("active").notNull().default(true),
});

export const erpRolePermissions = mysqlTable(
  "erp_role_permission",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    role: mysqlEnum("role", ROLE_VALUES).notNull(),
    resource: varchar("resource", { length: 80 }).notNull(),
    canRead: boolean("canRead").notNull().default(false),
    canWrite: boolean("canWrite").notNull().default(false),
    canApprove: boolean("canApprove").notNull().default(false),
  },
  table => [
    uniqueIndex("erp_role_permission_uq").on(table.role, table.resource),
  ]
);

/* ─── 2차 · 3차 테이블 (§6.3) ────────────────────────────────────────────── */

/** 거래처 — vatMode가 사업부별 VAT 표기 차이를 흡수한다 (B3) */
export const erpParties = mysqlTable("erp_party", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  bizNo: varchar("bizNo", { length: 20 }),
  bankAccount: varchar("bankAccount", { length: 64 }),
  vatMode: varchar("vatMode", { length: 20 }),
  /** 소득 구분 — 원천징수율과 지급명세서가 갈린다 (docs/erp-qa.md B9) */
  incomeType: varchar("incomeType", { length: 20 }),
  contact: varchar("contact", { length: 120 }),
  memo: text("memo"),
});

/** 계약 — 입금예정일 산출의 근거 (§9.3) */
export const erpContracts = mysqlTable(
  "erp_contract",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    code: varchar("code", { length: 32 }).notNull(),
    partyId: varchar("partyId", { length: 36 }),
    projectId: varchar("projectId", { length: 36 }),
    amountTotal: bigint("amountTotal", { mode: "number" }),
    installments: json("installments"),
    /** null이면 입금예정일을 산출할 수 없다 — 화면에 「계약서 확인」 */
    paymentTermsDays: int("paymentTermsDays"),
    paymentTermsText: varchar("paymentTermsText", { length: 200 }),
    driveUrl: text("driveUrl"),
    isAgency: boolean("isAgency").notNull().default(false),
  },
  table => [uniqueIndex("erp_contract_code_uq").on(table.code)]
);

export const erpProjects = mysqlTable(
  "erp_project",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    code: varchar("code", { length: 32 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    buCode: mysqlEnum("buCode", BU_VALUES),
    status: varchar("status", { length: 40 }).notNull().default("진행"),
    /**
     * @deprecated 「예산」이라는 이름으로 계약 금액과 원가 예산 두 가지에 쓰이고 있었다.
     * 두 값을 아래 두 컬럼으로 나눴다. 데이터가 없어 지우지 않고 두었을 뿐 읽지 않는다.
     */
    budget: bigint("budget", { mode: "number" }),
    /** 계약 금액 — 매출 쪽. 프로젝트 마진의 분자다 */
    contractAmount: bigint("contractAmount", { mode: "number" }),
    /** 원가 예산 — 지출 쪽. 예산 대비 실적이 비교하는 값이다 */
    costBudget: bigint("costBudget", { mode: "number" }),
    startDate: date("startDate", { mode: "string" }),
    endDate: date("endDate", { mode: "string" }),
  },
  table => [uniqueIndex("erp_project_code_uq").on(table.code)]
);

/** 차입 — maturityDate가 null이면 만기 알람이 발동하지 않는다 (B2) */
export const erpDebts = mysqlTable(
  "erp_debt",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    code: varchar("code", { length: 32 }).notNull(),
    creditor: varchar("creditor", { length: 200 }).notNull(),
    /** null = 건별 잔액 미분해 */
    principal: bigint("principal", { mode: "number" }),
    rate: int("rate"),
    maturityDate: date("maturityDate", { mode: "string" }),
    repayType: varchar("repayType", { length: 60 }),
    isRelatedParty: boolean("isRelatedParty").notNull().default(false),
    monthlyInterest: bigint("monthlyInterest", { mode: "number" }),
    term: mysqlEnum("term", ["단기", "장기"]).notNull(),
    docUrl: text("docUrl"),
  },
  table => [uniqueIndex("erp_debt_code_uq").on(table.code)]
);

export const erpDebtSchedules = mysqlTable(
  "erp_debt_schedule",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    debtId: varchar("debtId", { length: 36 }).notNull(),
    dueDate: date("dueDate", { mode: "string" }).notNull(),
    principal: bigint("principal", { mode: "number" }).notNull().default(0),
    interest: bigint("interest", { mode: "number" }).notNull().default(0),
  },
  table => [index("erp_debt_schedule_debt_idx").on(table.debtId)]
);

/** 수집 검수함 — 원장 진입 전 대기열. 파싱 실패도 여기 남는다. */
export const erpIntakes = mysqlTable(
  "erp_intake",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    source: mysqlEnum("source", SOURCE_VALUES).notNull(),
    sourceRef: varchar("sourceRef", { length: 190 }),
    /** §11.1 슬랙 양식에 추가가 필요한 필드 */
    roundNo: int("roundNo"),
    linkedRevenueCode: varchar("linkedRevenueCode", { length: 32 }),
    raw: text("raw").notNull(),
    parsed: json("parsed"),
    status: varchar("status", { length: 30 }).notNull().default("waiting"),
    failReason: varchar("failReason", { length: 300 }),
    entryId: varchar("entryId", { length: 36 }),
    receivedAt: timestamp("receivedAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("erp_intake_source_uq").on(table.source, table.sourceRef),
  ]
);

export const erpNotificationRules = mysqlTable("erp_notification_rule", {
  id: varchar("id", { length: 36 }).primaryKey(),
  trigger: varchar("trigger", { length: 120 }).notNull(),
  tier: varchar("tier", { length: 10 }).notNull(),
  recipients: json("recipients"),
  channel: varchar("channel", { length: 40 }).notNull(),
  active: boolean("active").notNull().default(true),
  /** 만기 미확인처럼 규칙은 있으나 발동할 수 없는 상태 */
  blockedReason: varchar("blockedReason", { length: 300 }),
});

export const erpNotifications = mysqlTable(
  "erp_notification",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    ruleId: varchar("ruleId", { length: 36 }).notNull(),
    title: varchar("title", { length: 300 }).notNull(),
    body: text("body").notNull(),
    screen: varchar("screen", { length: 60 }),
    sentAt: timestamp("sentAt"),
    readAt: timestamp("readAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("erp_notification_rule_idx").on(table.ruleId)]
);

/** 월 마감 잠금 — closed면 그 기간 entry 수정을 거부한다 (3차) */
export const erpPeriods = mysqlTable("erp_period", {
  ym: varchar("ym", { length: 7 }).primaryKey(),
  status: mysqlEnum("status", ["open", "closing", "closed"])
    .notNull()
    .default("open"),
  closedBy: varchar("closedBy", { length: 64 }),
  closedAt: timestamp("closedAt"),
  blockers: json("blockers"),
});

export type ErpEntryRow = typeof erpEntries.$inferSelect;
export type InsertErpEntry = typeof erpEntries.$inferInsert;
export type ErpAccountRow = typeof erpAccounts.$inferSelect;
export type ErpDaySnapshotRow = typeof erpDaySnapshots.$inferSelect;
export type ErpSettingRow = typeof erpSettings.$inferSelect;
