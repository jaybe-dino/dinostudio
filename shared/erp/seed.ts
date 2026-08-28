/**
 * §5.4 시드 데이터 — 이관 시점(2026-08-27)의 실제 값
 *
 * 이 파일이 이관 결과의 정답지다. 값을 손으로 고쳐 검증을 통과시키지 않는다 (§5.5 · 원칙 8).
 *   확정 지출 33,630,000 (10건) · 확정 수입 22,000,000 · 승인 대기 59,785,000 (8건) · 판정 대기 8건
 *   원장 전건 27 · 이관 구간 일계 7행
 */
import { defaultPriorityOf } from "./accounts";
import type {
  BuCode,
  DaySnapshot,
  Direction,
  Entry,
  EntryStatus,
  Nature,
  PayMethod,
  Setting,
} from "./types";

/** 이관 구간 일계에는 시트에 기록돼 있던 값도 함께 남긴다 — V1 대조용 (§5.5) */
export interface SeedDaySnapshot extends DaySnapshot {
  /** 이관 전 시트가 기록하고 있던 시작 잔액 (다를 때만) */
  sheetOpen?: number;
  sheetClose?: number;
}

/** (가) 일계만 있는 구간 — day_snapshot 7행 */
export const SEED_DAY_SNAPSHOTS: SeedDaySnapshot[] = [
  snap("2026-08-18", 30_000_000, 23_429_608, 16_431_700, "건별 명세 미이관"),
  snap("2026-08-20", 36_997_908, 20_000_000, 11_950_000, "건별 명세 미이관"),
  snap("2026-08-21", 45_047_908, 11_000_000, 3_043_790, "건별 명세 미이관"),
  snap(
    "2026-08-22",
    53_004_118,
    0,
    650_000,
    "셀릿 7,500,000 이력 — 08/27 중복 대조 대상"
  ),
  snap("2026-08-23", 52_354_118, 0, 1_240_000, "EX-260823-01 1건만 코드 있음"),
  {
    ...snap(
      "2026-08-24",
      51_114_118,
      0,
      40_692_790,
      "이관 전 시트는 시작 18,000,000 / 종료 3,000,000 — 대조 필요 (B5)"
    ),
    sheetOpen: 18_000_000,
    sheetClose: 3_000_000,
  },
  snap(
    "2026-08-25",
    10_421_328,
    0,
    7_421_328,
    "08/26 시작에 맞추기 위한 조정 포함 — 사유 미확정"
  ),
];

function snap(
  date: string,
  open: number,
  inSum: number,
  outSum: number,
  note: string
): SeedDaySnapshot {
  return {
    date,
    open,
    inSum,
    outSum,
    close: open + inSum - outSum,
    note,
    isMigrated: true,
  };
}

interface SeedEntryInput {
  code: string;
  date: string;
  title: string;
  amount: number | null;
  account: string | null;
  nature: Nature;
  bu: BuCode | null;
  project?: string | null;
  status: EntryStatus;
  direction?: Direction;
  noteRaw?: string;
  undecidedReason?: string;
  /** 적요칸 후보 금액 — 단위가 불명하면 승격하지 않는다 (§5.2) */
  candidate?: number;
  /** 이미 집행이 끝난 확정 건 (docs/erp-spec-gaps.md) */
  paidAt?: string;
  payMethod?: PayMethod;
  hasEvidence?: boolean;
  /** 개인이 식별되는 인건비 건 — 응답 단계에서 금액을 마스킹한다 (§13.3 · 원칙 10) */
  isPersonal?: boolean;
}

/** (나) 건별 원장 — entry 27행 */
const SEED_INPUT: SeedEntryInput[] = [
  // ── 확정 — 합계에 들어감 ─────────────────────────────────────────────
  {
    code: "EX-260823-01",
    date: "2026-08-23",
    title: "GLOVEK 서버 비용",
    amount: 1_240_000,
    account: "6320",
    nature: "공통배부",
    bu: "GLV",
    status: "confirmed",
    paidAt: "2026-08-23",
    payMethod: "계좌",
  },
  {
    code: "EX-260826-01",
    date: "2026-08-26",
    title: "대출이자",
    amount: 350_000,
    account: "8110",
    nature: "해당없음",
    bu: "CMN",
    status: "confirmed",
    payMethod: "계좌",
  },
  {
    code: "EX-260826-04",
    date: "2026-08-26",
    title: "일반세금 7월",
    amount: 4_800_000,
    account: "6520",
    nature: "공통배부",
    bu: "CMN",
    status: "confirmed",
    payMethod: "계좌",
  },
  {
    code: "EX-260826-05",
    date: "2026-08-26",
    title: "연장 보증료",
    amount: 2_000_000,
    account: "8120",
    nature: "해당없음",
    bu: "CMN",
    status: "confirmed",
    paidAt: "2026-08-26",
    payMethod: "계좌",
  },
  {
    code: "EX-260826-06",
    date: "2026-08-26",
    title: "페르소나AI X 익스펙팅룸 PPL",
    amount: 8_800_000,
    account: "5210",
    nature: "직접원가",
    bu: "NET",
    status: "confirmed",
    paidAt: "2026-08-26",
    payMethod: "계좌",
  },
  {
    code: "EX-260826-08",
    date: "2026-08-26",
    title: "퍼스트메카 잇더핏 유튜브PPL",
    amount: 770_000,
    account: "5220",
    nature: "통과원가",
    bu: "NET",
    status: "confirmed",
    paidAt: "2026-08-26",
    payMethod: "계좌",
  },
  {
    code: "IN-260826-01",
    date: "2026-08-26",
    title: "콜랩 의적단2 선금 수입",
    amount: 22_000_000,
    account: "2140",
    nature: "해당없음",
    bu: "IP",
    project: "PRJ-0132",
    status: "confirmed",
    direction: "in",
    paidAt: "2026-08-26",
  },
  {
    code: "EX-260827-01",
    date: "2026-08-27",
    title: "주차비용",
    amount: 170_000,
    account: "6510",
    nature: "공통배부",
    bu: "CMN",
    status: "confirmed",
    payMethod: "계좌",
  },
  {
    code: "EX-260827-05",
    date: "2026-08-27",
    title: "상환 (저 5일분)",
    amount: 5_000_000,
    account: "2210",
    nature: "손익아님",
    bu: "CMN",
    status: "confirmed",
    paidAt: "2026-08-27",
    payMethod: "계좌",
  },
  {
    code: "EX-260827-06",
    date: "2026-08-27",
    title: "상환 (저 500+150 · 영탁 디지)",
    amount: 6_500_000,
    account: "2210",
    nature: "손익아님",
    bu: "CMN",
    status: "confirmed",
    paidAt: "2026-08-27",
    payMethod: "계좌",
  },
  {
    code: "EX-260825-02",
    date: "2026-08-29",
    title: "사무실 월세 8월",
    amount: 4_000_000,
    account: "6410",
    nature: "공통배부",
    bu: "CMN",
    status: "confirmed",
    payMethod: "계좌",
  },

  // ── 승인 대기 — 합계 미포함 · 예약런웨이에만 반영 ──────────────────────
  {
    code: "EX-260827-07",
    date: "2026-08-27",
    title: "쯔양 3 (요아정)",
    amount: 33_000_000,
    account: "5220",
    nature: "통과원가",
    bu: "IP",
    project: "PRJ-0132",
    status: "pending",
  },
  {
    code: "EX-260831-01",
    date: "2026-08-31",
    title: "액티브스 운영수수료",
    amount: 5_390_000,
    account: "5140",
    nature: "통과원가",
    bu: "NET",
    status: "pending",
  },
  {
    code: "EX-260831-02",
    date: "2026-08-31",
    title: "액티브스 운영수수료 (엔지니어TV)",
    amount: 3_850_000,
    account: "5140",
    nature: "통과원가",
    bu: "NET",
    status: "pending",
  },
  {
    code: "EX-260831-03",
    date: "2026-08-31",
    title: "액티브스 시딩 정산",
    amount: 1_045_000,
    account: "5220",
    nature: "통과원가",
    bu: "NET",
    status: "pending",
  },
  {
    code: "EX-260831-04",
    date: "2026-08-31",
    title: "8월 급여 (전사)",
    amount: null,
    account: "6110",
    nature: "공통배부",
    bu: "CMN",
    status: "pending",
    noteRaw: "금액 미확정 (B1 급여 실액)",
  },
  {
    code: "EX-260901-01",
    date: "2026-09-01",
    title: "퍼스트메카 시딩",
    amount: 1_100_000,
    account: "5220",
    nature: "통과원가",
    bu: "NET",
    status: "pending",
    hasEvidence: false,
  },
  {
    code: "EX-260825-01",
    date: "2026-09-05",
    title: "외주 영상 제작 · 스튜디오A",
    amount: 8_800_000,
    account: "5210",
    nature: "직접원가",
    bu: "NET",
    status: "pending",
  },
  {
    code: "EX-260930-01",
    date: "2026-09-30",
    title: "스튜디오 씽 PPL",
    amount: 6_600_000,
    account: "5220",
    nature: "통과원가",
    bu: "NET",
    status: "pending",
  },

  // ── 판정 대기 — 금액·항목이 확정되지 않아 어느 합계에도 없음 ─────────────
  {
    code: "EX-260826-02",
    date: "2026-08-26",
    title: "부가세 2차",
    amount: null,
    account: "2130",
    nature: "손익아님",
    bu: "CMN",
    status: "undecided",
    noteRaw: "1,200",
    undecidedReason:
      "적요칸 금액 · 단위 불명 — 현금 현황은 12,000,000(카드) (B9)",
    // 두 소스가 다르므로 확정 금액으로 승격하지 않고 후보로만 둔다.
    candidate: 12_000_000,
    payMethod: "법인카드",
  },
  {
    code: "EX-260826-03",
    date: "2026-08-26",
    title: "부가세 1차",
    amount: null,
    account: "2130",
    nature: "손익아님",
    bu: "CMN",
    status: "undecided",
    noteRaw: "350",
    undecidedReason: "적요칸 금액 · 단위 불명",
  },
  {
    code: "EX-260826-07",
    date: "2026-08-26",
    title: "샌드박스 선금",
    amount: null,
    account: null,
    nature: "미지정",
    bu: null,
    status: "undecided",
    noteRaw: "캐치웰 528",
    undecidedReason: "금액 공란",
  },
  {
    code: "EX-260827-02",
    date: "2026-08-27",
    title: "급여 7월 (대표·본인)",
    amount: null,
    account: "6110",
    nature: "공통배부",
    bu: "CMN",
    status: "undecided",
    noteRaw: "12,614,300",
    undecidedReason: "적요칸 금액",
    candidate: 12_614_300,
    isPersonal: true,
  },
  {
    code: "EX-260827-03",
    date: "2026-08-27",
    title: "급여 6월 (본인)",
    amount: null,
    account: "6110",
    nature: "공통배부",
    bu: "CMN",
    status: "undecided",
    noteRaw: "5,307,810",
    undecidedReason: "적요칸 금액",
    candidate: 5_307_810,
    isPersonal: true,
  },
  {
    code: "EX-260827-04",
    date: "2026-08-27",
    title: "셀릿 (줄컴퍼니 거마비)",
    amount: 7_500_000,
    account: "5220",
    nature: "통과원가",
    bu: "NET",
    status: "undecided",
    undecidedReason: "중복 의심 — 08/22 동일액",
    hasEvidence: false,
  },
  {
    code: "EX-260828-01",
    date: "2026-08-28",
    title: "디에스브릿지",
    amount: null,
    account: null,
    nature: "미지정",
    bu: null,
    status: "undecided",
    noteRaw: "80",
    undecidedReason: "단위 불명 — 만원인지 원인지 불명",
  },
  {
    code: "EX-260828-02",
    date: "2026-08-28",
    title: "",
    amount: 30_000_000,
    account: null,
    nature: "미지정",
    bu: null,
    status: "undecided",
    noteRaw: "MBC 영업중",
    undecidedReason: "항목명 없음 · 매출인지 지출인지 불명",
  },
];

function toEntry(input: SeedEntryInput): Entry {
  const direction = input.direction ?? "out";
  return {
    id: input.code,
    code: input.code,
    parentCode: null,
    direction,
    status: input.status,
    title: input.title,
    noteRaw: input.noteRaw ?? null,
    note: null,
    amount: input.amount,
    amountCandidate: input.candidate ?? null,
    amountSupply: null,
    amountVat: null,
    currency: "KRW",
    cashDate: input.date,
    accrualDate: input.date,
    startDate: null,
    deliverDate: null,
    requestDate: null,
    dueDate: input.date,
    paidAt: input.paidAt ?? null,
    accountCode: input.account,
    nature: input.nature,
    buCode: input.bu,
    projectId: input.project ?? null,
    partyId: null,
    contractId: null,
    priority: direction === "in" ? null : defaultPriorityOf(input.account),
    priorityOverride: null,
    priorityReason: null,
    payMethod: input.payMethod ?? null,
    bankAccount: null,
    invoiceIssued: null,
    invoiceNo: null,
    source: "migration",
    sourceRef: `sheet:${input.code}`,
    undecidedReason: input.undecidedReason ?? null,
    hasEvidence: input.hasEvidence ?? true,
    isPersonal: input.isPersonal ?? false,
    version: 1,
    createdAt: "2026-08-27T00:00:00+09:00",
    createdBy: "migration",
  };
}

export const SEED_ENTRIES: Entry[] = SEED_INPUT.map(toEntry);

/** §6.3 setting — 차단 항목의 임시 기본값. is_provisional=true면 화면에 「임시」 배지 */
export const SEED_SETTINGS: Setting[] = [
  {
    key: "cash_on_hand",
    value: 18_000_000,
    isProvisional: true,
    ownerRole: "재무",
    updatedBy: "migration",
    updatedAt: "2026-08-27T00:00:00+09:00",
  },
  {
    key: "cash_requirement_horizon",
    value: "2026-09-01",
    isProvisional: true,
    ownerRole: "재무",
    updatedBy: "migration",
    updatedAt: "2026-08-27T00:00:00+09:00",
  },
  {
    key: "payroll_monthly_actual",
    value: null,
    isProvisional: true,
    ownerRole: "대표",
    updatedBy: null,
    updatedAt: null,
  },
  {
    key: "vat_display_basis",
    value: null,
    isProvisional: true,
    ownerRole: "재무",
    updatedBy: null,
    updatedAt: null,
  },
  {
    key: "approval_single_limit",
    value: 20_000_000,
    isProvisional: false,
    ownerRole: "대표",
    updatedBy: "migration",
    updatedAt: "2026-08-27T00:00:00+09:00",
  },
];

export function settingValue<T>(settings: Setting[], key: string): T | null {
  const found = settings.find(s => s.key === key);
  return found ? ((found.value ?? null) as T | null) : null;
}
