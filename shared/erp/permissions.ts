/**
 * §13 권한 · 내부통제
 *
 * §13.1 역할 매트릭스는 초안이지만, 권한 적용 자체는 1차 오픈의 필수 항목이다 (G10).
 * 프로토타입은 매트릭스만 있고 적용이 없어 급여·부채가 전원에게 노출돼 있었다.
 */
import type { Entry, Role } from "./types.js";

export type Resource =
  | "entry"
  | "priority_override"
  | "payroll"
  | "debt"
  | "account"
  | "setting"
  | "period_close"
  | "audit";

export interface Permission {
  read: boolean;
  write: boolean;
  approve: boolean;
  /** 자기 사업부 / 본인 입력분으로 범위가 좁혀지는 역할 */
  scope?: "all" | "own_bu" | "own_input";
}

const N: Permission = { read: false, write: false, approve: false };
const R: Permission = { read: true, write: false, approve: false };
const RW: Permission = { read: true, write: true, approve: false };
const RWA: Permission = { read: true, write: true, approve: true };

/** §13.1 역할 매트릭스 (R 조회 · W 입력/수정 · A 승인 · — 접근 불가) */
export const ROLE_MATRIX: Record<Role, Record<Resource, Permission>> = {
  대표: {
    entry: RWA,
    priority_override: RW,
    payroll: R, // 총액만
    debt: RW,
    account: R,
    setting: RWA,
    period_close: { read: true, write: false, approve: true },
    audit: R,
  },
  부대표: {
    entry: RWA,
    priority_override: RW,
    payroll: N,
    debt: R,
    account: R,
    setting: R,
    period_close: N,
    audit: R,
  },
  재무: {
    entry: RWA,
    priority_override: RW,
    payroll: RW, // 총액만
    debt: RW,
    account: RW,
    setting: { read: true, write: true, approve: false }, // 제안까지
    period_close: { read: true, write: true, approve: false }, // 요청까지
    audit: R,
  },
  사업부리더: {
    entry: { read: true, write: true, approve: true, scope: "own_bu" },
    priority_override: N,
    payroll: N,
    debt: N,
    account: R,
    setting: N,
    period_close: N,
    audit: N,
  },
  담당자: {
    entry: { read: true, write: true, approve: false, scope: "own_input" },
    priority_override: N,
    payroll: N,
    debt: N,
    account: R,
    setting: N,
    period_close: N,
    audit: N,
  },
  외부세무: {
    entry: R,
    priority_override: N,
    payroll: R,
    debt: R,
    account: R,
    setting: N,
    period_close: N,
    audit: R,
  },
  /**
   * 외부열람 (docs/erp-qa.md D5) — 감사인·투자자에게 보여 줄 때.
   * 급여는 아예 내려가지 않고, 내보내기도 막는다 (canExport).
   */
  외부열람: {
    entry: R,
    priority_override: N,
    payroll: N,
    debt: R,
    account: R,
    setting: N,
    period_close: N,
    audit: N,
  },
};

/**
 * 내보내기 가능 여부 (D5).
 * 화면에서 보는 것과 파일로 들고 나가는 것은 다른 위험이다 —
 * 외부열람은 보되 들고 나가지 못한다.
 */
export function canExport(role: Role): boolean {
  return role !== "외부열람";
}

export function permissionFor(role: Role, resource: Resource): Permission {
  return ROLE_MATRIX[role][resource];
}

/** §13.1 승인 금액 구간 — 20,000,000 초과는 대표 단독 */
export function rolesAllowedToApprove(amount: number | null): Role[] {
  if (amount == null) return []; // 금액 미확정 건은 승인 불가 (§10.3 amount_undecided)
  if (amount <= 5_000_000) return ["대표", "부대표", "재무", "사업부리더"];
  if (amount <= 20_000_000) return ["대표", "부대표", "재무"];
  return ["대표"];
}

export function canApproveAmount(role: Role, amount: number | null): boolean {
  return rolesAllowedToApprove(amount).includes(role);
}

/** §13.3 인건비 계정 — 개인별 금액은 어느 화면에도 표시하지 않는다 (원칙 10) */
export const PAYROLL_ACCOUNTS = new Set(["6110", "6120", "6130", "6140"]);

export function isPayrollAccount(code: string | null | undefined): boolean {
  return code != null && PAYROLL_ACCOUNTS.has(code);
}

export interface MaskedEntry extends Entry {
  masked: boolean;
  maskReason: string | null;
}

/**
 * 응답 단계 마스킹 — 프론트에서 숨기는 방식은 금지 (§13.3).
 * 개인이 식별되는 인건비 건은 역할과 무관하게 금액을 내려보내지 않고,
 * 인건비 열람 권한이 없는 역할에는 인건비 건 전부를 마스킹한다 (T10).
 */
export function maskEntryForRole(entry: Entry, role: Role): MaskedEntry {
  if (!isPayrollAccount(entry.accountCode)) {
    return { ...entry, masked: false, maskReason: null };
  }
  const allowed = permissionFor(role, "payroll").read;
  if (!allowed) {
    return {
      ...entry,
      amount: null,
      amountCandidate: null,
      amountSupply: null,
      amountVat: null,
      noteRaw: null,
      masked: true,
      maskReason: "개인별 급여는 표시하지 않습니다. 총액만 조회할 수 있습니다",
    };
  }
  if (entry.isPersonal) {
    return {
      ...entry,
      amount: null,
      amountCandidate: null,
      amountSupply: null,
      amountVat: null,
      noteRaw: null,
      masked: true,
      maskReason: "개인이 식별되는 인건비 건은 총액으로만 조회합니다 (원칙 10)",
    };
  }
  return { ...entry, masked: false, maskReason: null };
}

/**
 * 전표(분개)에 걸리는 같은 규칙 (원칙 10).
 *
 * 원장 목록은 `maskEntryForRole` 로 금액을 지우면 되지만 **전표는 금액을 지울
 * 수 없다** — 차변·대변을 0 으로 바꾸면 시산표가 안 맞고, 남겨 두면 가린 것이
 * 아니다. 그래서 전표는 **줄째로 내리지 않는다.**
 *
 * 판정 기준은 `maskEntryForRole` 과 **같은 두 갈래**다. 규칙이 두 곳에서
 * 갈리면 한쪽이 반드시 뒤처진다.
 *
 * 건을 찾을 수 없으면 **안 보여 준다.** 계정을 모르면 인건비인지 판정할 수
 * 없고, 모를 때 보여 주는 쪽을 택하면 규칙이 있으나 마나다 (원칙 8).
 */
export function journalVisibleToRole(
  entry: Entry | undefined,
  role: Role
): boolean {
  if (!entry) return false;
  if (!isPayrollAccount(entry.accountCode)) return true;
  if (!permissionFor(role, "payroll").read) return false;
  return !entry.isPersonal;
}

/** 마스킹된 건들의 총액 — 화면은 이 값만 본다 */
export function payrollTotal(entries: Entry[]): number {
  return entries
    .filter(e => isPayrollAccount(e.accountCode))
    .reduce((acc, e) => acc + (e.amount ?? e.amountCandidate ?? 0), 0);
}
