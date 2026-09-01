/**
 * §10.3 오류 — 메시지는 사용자에게 그대로 노출된다.
 */
import { TRPCError } from "@trpc/server";
import type { TRPC_ERROR_CODE_KEY } from "@trpc/server/rpc";

export type ErpErrorCode =
  | "version_conflict"
  | "period_closed"
  | "reason_required"
  | "account_required"
  | "amount_undecided"
  | "duplicate_suspected"
  | "forbidden_field"
  | "evidence_required"
  | "self_approval"
  | "approval_limit"
  | "export_forbidden"
  | "not_found"
  | "invalid_transition";

const MAP: Record<
  ErpErrorCode,
  { trpc: TRPC_ERROR_CODE_KEY; message: string }
> = {
  version_conflict: {
    trpc: "CONFLICT",
    message: "다른 사람이 먼저 처리했습니다 — 현재 상태를 확인하십시오",
  },
  period_closed: {
    trpc: "CONFLICT",
    message: "마감된 기간은 수정할 수 없습니다. 수정하려면 마감을 해제하십시오",
  },
  reason_required: {
    trpc: "UNPROCESSABLE_CONTENT",
    message: "등급을 올리면 사유가 남아야 합니다",
  },
  account_required: {
    trpc: "UNPROCESSABLE_CONTENT",
    message:
      "계정과목이 없으면 전표가 생성되지 않습니다. 계정을 먼저 지정하십시오",
  },
  amount_undecided: {
    trpc: "UNPROCESSABLE_CONTENT",
    message: "금액이 확정되지 않은 건은 승인할 수 없습니다",
  },
  duplicate_suspected: {
    trpc: "CONFLICT",
    message:
      "같은 거래처·금액의 건이 7일 이내에 있습니다 — 확인 후 진행하십시오",
  },
  forbidden_field: {
    trpc: "FORBIDDEN",
    message: "개인별 급여는 표시하지 않습니다. 총액만 조회할 수 있습니다",
  },
  evidence_required: {
    trpc: "UNPROCESSABLE_CONTENT",
    message: "증빙이 없는 건은 보류까지만 가능합니다. 확정되지 않습니다",
  },
  self_approval: {
    trpc: "FORBIDDEN",
    message: "본인이 입력한 건은 본인이 승인할 수 없습니다",
  },
  approval_limit: {
    trpc: "FORBIDDEN",
    message: "이 금액은 상위 승인자만 승인할 수 있습니다",
  },
  export_forbidden: {
    trpc: "FORBIDDEN",
    message: "이 역할은 파일로 내보낼 수 없습니다. 화면에서만 확인하십시오",
  },
  not_found: {
    trpc: "NOT_FOUND",
    message: "해당 집행원장 코드를 찾을 수 없습니다",
  },
  invalid_transition: {
    trpc: "UNPROCESSABLE_CONTENT",
    message: "현재 상태에서는 그 처리를 할 수 없습니다",
  },
};

export class ErpError extends Error {
  readonly code: ErpErrorCode;
  readonly data: Record<string, unknown>;

  constructor(
    code: ErpErrorCode,
    data: Record<string, unknown> = {},
    message?: string
  ) {
    super(message ?? MAP[code].message);
    this.code = code;
    this.data = data;
    this.name = "ErpError";
  }

  toTRPCError(): TRPCError {
    return new TRPCError({
      code: MAP[this.code].trpc,
      message: this.message,
      cause: this,
    });
  }
}

export function erpError(
  code: ErpErrorCode,
  data?: Record<string, unknown>,
  message?: string
): ErpError {
  return new ErpError(code, data, message);
}
