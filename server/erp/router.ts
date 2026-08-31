/**
 * §10.1 엔드포인트 — 1차 오픈 범위. tRPC로 노출한다.
 * DELETE는 제공하지 않는다 (원칙 9).
 */
import {
  ENTRY_STATUSES,
  PRIORITIES,
  EVIDENCE_KIND_NAMES,
} from "../../shared/erp/index.js";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc.js";
import { getLedgerService, resolveErpRole } from "./index.js";
import { ErpError } from "./errors.js";
import type { Actor } from "./service.js";

/** 세션 사용자를 §13.1 역할로 옮긴다. 역할이 없으면 접근 불가. */
function actorFrom(ctx: {
  user: { openId: string; email: string | null } | null;
  req: { ip?: string };
}): Actor {
  const role = resolveErpRole(ctx.user?.email ?? null);
  if (!role) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "경영관리 시스템 역할이 지정되지 않았습니다. 관리자에게 역할 지정을 요청하십시오",
    });
  }
  return {
    id: ctx.user?.email ?? ctx.user?.openId ?? "unknown",
    role,
    ip: ctx.req.ip ?? null,
  };
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ErpError) throw error.toTRPCError();
    throw error;
  }
}

const statusEnum = z.enum(ENTRY_STATUSES);
const priorityEnum = z.enum(PRIORITIES);

const entryFilter = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  direction: z.enum(["out", "in"]).optional(),
  status: z.array(statusEnum).optional(),
  account: z.string().optional(),
  bu: z.string().optional(),
  project: z.string().optional(),
  nature: z.string().optional(),
  priority: z.string().optional(),
  q: z.string().optional(),
});

const overrideInput = z.object({
  code: z.string(),
  priority: priorityEnum,
  reason: z.string().min(1),
});

export const erpRouter = router({
  /** 내 역할 — 화면이 권한에 맞게 그려지도록 */
  me: protectedProcedure.query(({ ctx }) => {
    const actor = actorFrom(ctx);
    return { id: actor.id, role: actor.role };
  }),

  // ── 원장 ────────────────────────────────────────────────────────────────
  entries: router({
    list: protectedProcedure
      .input(
        entryFilter
          .extend({
            // §14 offset 금지 — 코드는 불변이라 커서로 안전하다
            cursor: z.string().nullable().default(null),
            limit: z.number().int().min(1).max(500).optional(),
          })
          .optional()
      )
      .query(({ ctx, input }) =>
        run(() =>
          getLedgerService().listEntries(input ?? {}, actorFrom(ctx), {
            cursor: input?.cursor ?? null,
            limit: input?.limit,
          })
        )
      ),

    get: protectedProcedure
      .input(z.object({ code: z.string() }))
      .query(({ ctx, input }) =>
        run(() => getLedgerService().getEntry(input.code, actorFrom(ctx)))
      ),

    create: protectedProcedure
      .input(
        z.object({
          direction: z.enum(["out", "in"]),
          title: z.string(),
          amount: z.number().int().nullable(),
          amountCandidate: z.number().int().nullable().optional(),
          cashDate: z.string(),
          accrualDate: z.string().nullable().optional(),
          accountCode: z.string().nullable().optional(),
          nature: z
            .enum([
              "통과원가",
              "직접원가",
              "공통배부",
              "해당없음",
              "손익아님",
              "미지정",
            ])
            .optional(),
          buCode: z
            .enum(["IP", "NET", "COM", "GLV", "CMN"])
            .nullable()
            .optional(),
          projectId: z.string().nullable().optional(),
          payMethod: z
            .enum(["계좌", "법인카드", "개인카드선결제", "현금"])
            .nullable()
            .optional(),
          hasEvidence: z.boolean().optional(),
          noteRaw: z.string().nullable().optional(),
          note: z.string().nullable().optional(),
          duplicateOverrideReason: z.string().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        run(() => getLedgerService().createEntry(input, actorFrom(ctx)))
      ),

    /** If-Match: version 필수 (§10.1) */
    patch: protectedProcedure
      .input(
        z.object({
          code: z.string(),
          version: z.number().int(),
          reason: z.string().optional(),
          patch: z.object({
            title: z.string().optional(),
            amount: z.number().int().nullable().optional(),
            amountCandidate: z.number().int().nullable().optional(),
            cashDate: z.string().optional(),
            accountCode: z.string().nullable().optional(),
            nature: z
              .enum([
                "통과원가",
                "직접원가",
                "공통배부",
                "해당없음",
                "손익아님",
                "미지정",
              ])
              .optional(),
            buCode: z
              .enum(["IP", "NET", "COM", "GLV", "CMN"])
              .nullable()
              .optional(),
            projectId: z.string().nullable().optional(),
            payMethod: z
              .enum(["계좌", "법인카드", "개인카드선결제", "현금"])
              .nullable()
              .optional(),
            hasEvidence: z.boolean().optional(),
            note: z.string().nullable().optional(),
          }),
        })
      )
      .mutation(({ ctx, input }) =>
        run(() =>
          getLedgerService().patchEntry(
            input.code,
            input.patch,
            input.version,
            actorFrom(ctx),
            input.reason
          )
        )
      ),

    cancel: protectedProcedure
      .input(
        z.object({
          code: z.string(),
          version: z.number().int(),
          reason: z.string().min(1),
        })
      )
      .mutation(({ ctx, input }) =>
        run(() =>
          getLedgerService().cancelEntry(
            input.code,
            input.reason,
            input.version,
            actorFrom(ctx)
          )
        )
      ),

    setPriority: protectedProcedure
      .input(
        z.object({
          code: z.string(),
          version: z.number().int(),
          priority: priorityEnum.nullable(),
          reason: z.string().nullable(),
        })
      )
      .mutation(({ ctx, input }) =>
        run(() =>
          getLedgerService().setPriorityOverride(
            input.code,
            input.priority,
            input.reason,
            input.version,
            actorFrom(ctx)
          )
        )
      ),

    approve: protectedProcedure
      .input(z.object({ code: z.string(), version: z.number().int() }))
      .mutation(({ ctx, input }) =>
        run(() =>
          getLedgerService().approve(input.code, input.version, actorFrom(ctx))
        )
      ),

    reject: protectedProcedure
      .input(
        z.object({
          code: z.string(),
          version: z.number().int(),
          reason: z.string().min(1),
        })
      )
      .mutation(({ ctx, input }) =>
        run(() =>
          getLedgerService().reject(
            input.code,
            input.reason,
            input.version,
            actorFrom(ctx)
          )
        )
      ),

    hold: protectedProcedure
      .input(
        z.object({
          code: z.string(),
          version: z.number().int(),
          reason: z.string().min(1),
        })
      )
      .mutation(({ ctx, input }) =>
        run(() =>
          getLedgerService().hold(
            input.code,
            input.reason,
            input.version,
            actorFrom(ctx)
          )
        )
      ),
  }),

  /** POST /approvals/bulk — 기간 전체 승인. 부분 실패를 건별로 반환 */
  approvals: router({
    bulk: protectedProcedure
      .input(
        z.object({
          codes: z.array(z.string()).min(1),
          decision: z.enum(["approve", "reject"]),
          reason: z.string().nullable().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        run(() =>
          getLedgerService().bulkApprove(
            input.codes,
            input.decision,
            input.reason ?? null,
            actorFrom(ctx)
          )
        )
      ),
  }),

  // ── 파생 뷰 (읽기 전용) ──────────────────────────────────────────────────
  views: router({
    cashflow: protectedProcedure
      .input(
        z
          .object({
            unit: z.enum(["day", "month", "year"]).default("month"),
            // offset 금지 — 승인으로 순서가 바뀌므로 커서로만 이어 받는다 (§14)
            cursor: z.string().nullable().default(null),
            limit: z.number().int().min(1).max(24).default(3),
          })
          .optional()
      )
      .query(({ ctx, input }) => {
        actorFrom(ctx);
        return run(() =>
          getLedgerService().cashflow(
            input?.unit ?? "month",
            input?.cursor ?? null,
            input?.limit ?? 3
          )
        );
      }),

    cashPosition: protectedProcedure
      .input(
        z.object({ includeUndecided: z.boolean().default(true) }).optional()
      )
      .query(({ ctx, input }) =>
        run(() =>
          getLedgerService().cashPosition(
            { includeUndecided: input?.includeUndecided ?? true },
            actorFrom(ctx)
          )
        )
      ),

    /** 저장하지 않는 시뮬레이션 (§10.1) */
    simulate: protectedProcedure
      .input(
        z.object({
          includeUndecided: z.boolean().default(true),
          overrides: z.array(overrideInput).default([]),
        })
      )
      .mutation(({ ctx, input }) =>
        run(() =>
          getLedgerService().cashPosition(
            {
              includeUndecided: input.includeUndecided,
              overrides: input.overrides,
            },
            actorFrom(ctx)
          )
        )
      ),
  }),

  // ── 2차 파생 뷰 ──────────────────────────────────────────────────────────
  ar: protectedProcedure.query(({ ctx }) => {
    actorFrom(ctx);
    return run(() => getLedgerService().ar());
  }),

  debt: protectedProcedure.query(({ ctx }) => {
    actorFrom(ctx);
    return run(() => getLedgerService().debt());
  }),

  forecast: protectedProcedure
    .input(
      z
        .object({
          scenario: z.enum(["Base", "Stress", "Upside"]).default("Base"),
        })
        .optional()
    )
    .query(({ ctx, input }) => {
      actorFrom(ctx);
      return run(() => getLedgerService().forecast(input?.scenario ?? "Base"));
    }),

  journals: protectedProcedure.query(({ ctx }) => {
    actorFrom(ctx);
    return run(() => getLedgerService().journals());
  }),

  masters: protectedProcedure.query(({ ctx }) => {
    actorFrom(ctx);
    return run(() => getLedgerService().masters());
  }),

  upsertMaster: protectedProcedure
    .input(
      z.object({
        kind: z.enum(["party", "project", "contract", "debt", "debtSchedule"]),
        payload: z.record(z.string(), z.unknown()),
      })
    )
    .mutation(({ ctx, input }) =>
      run(() =>
        getLedgerService().upsertMaster(
          input.kind,
          input.payload as never,
          actorFrom(ctx)
        )
      )
    ),

  notifications: protectedProcedure.query(({ ctx }) =>
    run(() => getLedgerService().notifications(actorFrom(ctx)))
  ),

  // ── 3차 파생 뷰 ──────────────────────────────────────────────────────────
  runway: protectedProcedure.query(({ ctx }) => {
    actorFrom(ctx);
    return run(() => getLedgerService().runway());
  }),

  /** GET /decisions — 오늘의 3가지 · 결정 큐 (E3) */
  decisions: protectedProcedure.query(({ ctx }) =>
    run(() => getLedgerService().decisions(actorFrom(ctx)))
  ),

  /** GET /agents — 에이전트 13종 현황 */
  agents: protectedProcedure.query(() =>
    run(() => getLedgerService().agents())
  ),

  pnl: protectedProcedure
    .input(
      z
        .object({
          from: z.string().nullable().optional(),
          to: z.string().nullable().optional(),
          bu: z.string().nullable().optional(),
          project: z.string().nullable().optional(),
        })
        .optional()
    )
    .query(({ ctx, input }) => {
      actorFrom(ctx);
      return run(() => getLedgerService().pnl(input ?? {}));
    }),

  financialStatements: protectedProcedure
    .input(z.object({ ym: z.string().nullable().default(null) }).optional())
    .query(({ ctx, input }) => {
      actorFrom(ctx);
      return run(() =>
        getLedgerService().financialStatements(input?.ym ?? null)
      );
    }),

  closePeriod: protectedProcedure
    .input(z.object({ ym: z.string() }))
    .mutation(({ ctx, input }) =>
      run(() => getLedgerService().closePeriod(input.ym, actorFrom(ctx)))
    ),

  /** 증빙 (§6.3 · §13.2) — 증빙을 올릴 수 있어야 「증빙 없으면 확정 불가」가 규칙이 된다 */
  evidence: router({
    list: protectedProcedure
      .input(z.object({ code: z.string() }))
      .query(({ ctx, input }) => {
        actorFrom(ctx);
        return run(() => getLedgerService().evidence(input.code));
      }),
    requestUpload: protectedProcedure
      .input(
        z.object({
          code: z.string(),
          fileName: z.string().min(1),
          contentType: z.string().min(1),
          sizeBytes: z.number().int().positive(),
        })
      )
      .mutation(({ ctx, input }) =>
        run(() =>
          getLedgerService().requestEvidenceUpload(
            input.code,
            input.fileName,
            input.contentType,
            input.sizeBytes,
            actorFrom(ctx)
          )
        )
      ),
    add: protectedProcedure
      .input(
        z.object({
          code: z.string(),
          // 종류는 EVIDENCE_KINDS 가 유일한 출처다 — 여기에 목록을 또 적으면 어긋난다
          kind: z.enum(EVIDENCE_KIND_NAMES as [string, ...string[]]),
          storage: z.enum(["file", "link", "none"]),
          // 증빙 없음(none)은 주소가 없고 사유가 온다
          url: z.string().nullable().optional(),
          reason: z.string().nullable().optional(),
          fileName: z.string().nullable().optional(),
          sizeBytes: z.number().int().nullable().optional(),
          contentType: z.string().nullable().optional(),
          attachmentId: z.string().nullable().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        run(() => getLedgerService().addEvidence(input, actorFrom(ctx)))
      ),
  }),

  /** 사용자 · 역할 (§13.1 · G13) — 환경변수가 아니라 화면에서 관리한다 */
  users: router({
    list: protectedProcedure.query(({ ctx }) =>
      run(() => getLedgerService().appUsers(actorFrom(ctx)))
    ),
    put: protectedProcedure
      .input(
        z.object({
          id: z.string().min(1),
          email: z.string().email(),
          name: z.string().min(1),
          role: z.enum([
            "대표",
            "부대표",
            "재무",
            "사업부리더",
            "담당자",
            "외부세무",
          ]),
          active: z.boolean().default(true),
        })
      )
      .mutation(({ ctx, input }) =>
        run(() => getLedgerService().putAppUser(input, actorFrom(ctx)))
      ),
  }),

  markNotificationRead: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) =>
      run(() =>
        getLedgerService().markNotificationRead(input.id, actorFrom(ctx))
      )
    ),

  /** §11.1 수집 검수함 — 검수 통과해야 원장으로 올라간다 */
  intake: router({
    promote: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ ctx, input }) =>
        run(() => getLedgerService().promoteIntake(input.id, actorFrom(ctx)))
      ),
    reject: protectedProcedure
      .input(z.object({ id: z.string(), reason: z.string().min(1) }))
      .mutation(({ ctx, input }) =>
        run(() =>
          getLedgerService().rejectIntake(
            input.id,
            input.reason,
            actorFrom(ctx)
          )
        )
      ),
  }),

  /** 시트 이관 — 미리보기 후 확인해야 적재된다 */
  sheetImport: router({
    preview: protectedProcedure
      .input(
        z.object({
          text: z.string().min(1),
          from: z.string().nullable().default(null),
        })
      )
      .mutation(({ ctx, input }) =>
        run(() =>
          getLedgerService().previewSheetImport(
            input.text,
            input.from,
            actorFrom(ctx)
          )
        )
      ),
    commit: protectedProcedure
      .input(
        z.object({
          text: z.string().min(1),
          from: z.string().nullable().default(null),
        })
      )
      .mutation(({ ctx, input }) =>
        run(() =>
          getLedgerService().commitSheetImport(
            input.text,
            input.from,
            actorFrom(ctx)
          )
        )
      ),
  }),

  // ── 마스터 · 운영 ────────────────────────────────────────────────────────
  accounts: protectedProcedure.query(({ ctx }) => {
    actorFrom(ctx);
    return run(() => getLedgerService().accounts());
  }),

  putSetting: protectedProcedure
    .input(
      z.object({
        key: z.string().min(1),
        value: z.unknown(),
        isProvisional: z.boolean().default(false),
        reason: z.string().optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      run(() =>
        getLedgerService().putSetting(
          input.key,
          input.value ?? null,
          input.isProvisional,
          actorFrom(ctx),
          input.reason
        )
      )
    ),

  putAccount: protectedProcedure
    .input(
      z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        type: z.string().min(1),
        parentCode: z.string().nullable().default(null),
        cfSection: z.enum(["영업", "투자", "재무", "현금유출없음", "판정불가"]),
        isOpex: z.boolean(),
        defaultPriority: z
          .enum(["P0", "P1", "P2", "P3"])
          .nullable()
          .default(null),
        active: z.boolean().default(true),
      })
    )
    .mutation(({ ctx, input }) =>
      run(() => getLedgerService().putAccount(input, actorFrom(ctx)))
    ),

  settings: protectedProcedure.query(({ ctx }) => {
    actorFrom(ctx);
    return run(() => getLedgerService().settings());
  }),

  audit: protectedProcedure
    .input(
      z
        .object({ table: z.string().optional(), rowId: z.string().optional() })
        .optional()
    )
    .query(({ ctx, input }) => {
      actorFrom(ctx);
      return run(() => getLedgerService().auditTrail(input ?? {}));
    }),

  /** §5.5 이관 검증 리포트 (G2) */
  migration: protectedProcedure.query(({ ctx }) => {
    actorFrom(ctx);
    return run(() => getLedgerService().migrationReport());
  }),
});
