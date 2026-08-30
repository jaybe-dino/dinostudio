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
};

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

/** 마스킹된 건들의 총액 — 화면은 이 값만 본다 */
export function payrollTotal(entries: Entry[]): number {
  return entries
    .filter(e => isPayrollAccount(e.accountCode))
    .reduce((acc, e) => acc + (e.amount ?? e.amountCandidate ?? 0), 0);
}
