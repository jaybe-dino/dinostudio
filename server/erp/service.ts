/**
 * 원장 서비스 — §7 상태 전이 · §10 API 계약 · §13 내부통제의 구현부.
 *
 * 지켜야 할 것
 *   · 파생 뷰는 저장하지 않는다. 매번 원장에서 계산한다 (§4)
 *   · 물리 삭제는 없다. 수정은 -R1, 취소는 -C (원칙 9 · §7.1)
 *   · 승인 없이는 지표가 아니다 (원칙 7) · 모르면 계산불가 (원칙 8)
 */
import {
  buildCashflow,
  canApproveAmount,
  cancelCode,
  computeCashPosition,
  confirmedTotals,
  counterAccountFor,
  defaultPriorityOf,
  findDuplicateCandidates,
  maskEntryForRole,
  nextCode,
  nextRevisionCode,
  parseCode,
  payrollTotal,
  prefixFor,
  requiredByPriority,
  resolvePriority,
  runMigrationChecks,
  settingValue,
  STATUS_RULES,
} from "@shared/erp";
import type {
  CashflowUnit,
  Direction,
  Entry,
  Journal,
  MaskedEntry,
  Priority,
  PriorityOverrideInput,
  Role,
} from "@shared/erp";
import { randomUUID } from "node:crypto";
import { erpError } from "./errors";
import type { EntryFilter, LedgerStore } from "./store";

export interface Actor {
  /** 감사로그·본인 승인 금지 판정에 쓰는 식별자 */
  id: string;
  role: Role;
  ip?: string | null;
}

const nowIso = () => new Date().toISOString();

export class LedgerService {
  constructor(private readonly store: LedgerStore) {}

  // ── 조회 ────────────────────────────────────────────────────────────────

  /** GET /entries — 마스킹은 응답 단계에서 한다 (§13.3) */
  async listEntries(filter: EntryFilter, actor: Actor) {
    const entries = await this.store.listEntries(filter);
    return {
      entries: entries.map(e => maskEntryForRole(e, actor.role)),
      /** 개인 금액을 못 보는 역할도 총액은 본다 (원칙 10) */
      payrollTotal: payrollTotal(entries),
      out: confirmedTotals(entries, "out"),
      in: confirmedTotals(entries, "in"),
    };
  }

  /** GET /entries/:code — 단건 + 이력 + 승인 + 연결 */
  async getEntry(code: string, actor: Actor) {
    const entry = await this.store.getEntry(code);
    if (!entry) throw erpError("not_found", { code });
    const all = await this.store.listEntries();
    return {
      entry: maskEntryForRole(entry, actor.role),
      revisions: await this.store.listRevisions(entry.id),
      approvals: await this.store.listApprovals(entry.id),
      journals: await this.store.listJournals(entry.id),
      duplicates: findDuplicateCandidates(entry, all),
      priorityEff: resolvePriority(entry),
      /** 수정본·취소본 체인 */
      related: all
        .filter(
          e =>
            e.parentCode === entry.code ||
            (entry.parentCode && e.code === entry.parentCode)
        )
        .map(e => ({ code: e.code, status: e.status })),
    };
  }

  /** GET /cashflow?unit=day|month|year */
  async cashflow(unit: CashflowUnit) {
    const [entries, snapshots] = await Promise.all([
      this.store.listEntries(),
      this.store.listSnapshots(),
    ]);
    const blocks = buildCashflow(entries, snapshots, unit);
    const undecided = entries.filter(e => e.status === "undecided");
    return {
      unit,
      blocks,
      /** T4 — 화면에 「n건 제외 중」 */
      excludedUndecided: {
        n: undecided.length,
        codes: undecided.map(e => e.code),
        amount: null as number | null,
      },
    };
  }

  /** GET /cash-position · POST /cash-position/simulate */
  async cashPosition(
    options: {
      includeUndecided?: boolean;
      overrides?: PriorityOverrideInput[];
    },
    actor: Actor
  ) {
    const [entries, settings] = await Promise.all([
      this.store.listEntries(),
      this.store.listSettings(),
    ]);
    const position = computeCashPosition(entries, {
      cashOnHand: settingValue<number>(settings, "cash_on_hand"),
      horizon: settingValue<string>(settings, "cash_requirement_horizon"),
      includeUndecided: options.includeUndecided,
      overrides: options.overrides,
    });
    return {
      ...position,
      // 합계는 원장 전체로 계산하고, 건별 금액만 마스킹한다 (총액만 — 원칙 10)
      lines: position.lines.map(line => ({
        ...line,
        entry: maskEntryForRole(line.entry, actor.role),
      })),
      byPriority: requiredByPriority(position),
      cashOnHandIsProvisional:
        settings.find(s => s.key === "cash_on_hand")?.isProvisional ?? true,
    };
  }

  /** §5.5 이관 검증 리포트 (G2) */
  async migrationReport() {
    const [entries, snapshots] = await Promise.all([
      this.store.listEntries(),
      this.store.listSnapshots(),
    ]);
    return {
      checks: runMigrationChecks(entries, snapshots),
      entryCount: entries.length,
      snapshotCount: snapshots.length,
    };
  }

  async accounts() {
    return this.store.listAccounts();
  }

  async settings() {
    return this.store.listSettings();
  }

  async auditTrail(filter: { table?: string; rowId?: string }) {
    return this.store.listAudit(filter);
  }

  // ── 입력 · 수정 ──────────────────────────────────────────────────────────

  /** POST /entries — code는 서버가 부여한다 */
  async createEntry(
    input: {
      direction: Direction;
      title: string;
      amount: number | null;
      amountCandidate?: number | null;
      cashDate: string;
      accountCode?: string | null;
      nature?: Entry["nature"];
      buCode?: Entry["buCode"];
      projectId?: string | null;
      payMethod?: Entry["payMethod"];
      hasEvidence?: boolean;
      noteRaw?: string | null;
      note?: string | null;
      source?: Entry["source"];
      sourceRef?: string | null;
      /** 중복 경고를 확인하고 강행할 때의 사유 — 감사로그에 남는다 (§13.2) */
      duplicateOverrideReason?: string;
    },
    actor: Actor
  ) {
    const existing = await this.store.listEntries();
    const code = nextCode(
      prefixFor(input.direction),
      input.cashDate,
      existing.map(e => e.code)
    );

    // 항목명이 없거나 금액이 확정되지 않으면 판정 대기다 (§7.2 · §6.2)
    const undecidedReason =
      input.title.trim() === ""
        ? "항목명 없음"
        : input.amount == null
          ? "금액 미확정"
          : null;

    const entry: Entry = {
      id: randomUUID(),
      code,
      parentCode: null,
      direction: input.direction,
      status: undecidedReason ? "undecided" : "pending",
      title: input.title,
      noteRaw: input.noteRaw ?? null,
      note: input.note ?? null,
      amount: input.amount,
      amountCandidate: input.amountCandidate ?? null,
      amountSupply: null,
      amountVat: null,
      currency: "KRW",
      cashDate: input.cashDate,
      accrualDate: input.cashDate,
      startDate: null,
      deliverDate: null,
      requestDate: null,
      dueDate: input.cashDate,
      paidAt: null,
      accountCode: input.accountCode ?? null,
      nature: input.nature ?? "미지정",
      buCode: input.buCode ?? null,
      projectId: input.projectId ?? null,
      partyId: null,
      contractId: null,
      priority:
        input.direction === "in" ? null : defaultPriorityOf(input.accountCode),
      priorityOverride: null,
      priorityReason: null,
      payMethod: input.payMethod ?? null,
      bankAccount: null,
      invoiceIssued: null,
      invoiceNo: null,
      source: input.source ?? "manual",
      sourceRef: input.sourceRef ?? null,
      undecidedReason,
      hasEvidence: input.hasEvidence ?? false,
      isPersonal: false,
      version: 1,
      createdAt: nowIso(),
      createdBy: actor.id,
    };

    // UNIQUE (source, source_ref) — 같은 메시지의 재수집은 경고가 아니라 거부다 (T9).
    // 사람이 판단할 여지가 없으므로 duplicate_suspected 휴리스틱보다 먼저 막는다.
    if (entry.sourceRef) {
      const collision = existing.find(
        e => e.source === entry.source && e.sourceRef === entry.sourceRef
      );
      if (collision) {
        throw erpError(
          "duplicate_suspected",
          { collision: collision.code },
          `중복 수집 — 같은 원본(${entry.source}/${entry.sourceRef})이 이미 ${collision.code}로 적재돼 있습니다`
        );
      }
    }

    // §10.3 duplicate_suspected — 경고 후 강행 가능하되 사유가 감사로그에 남는다
    const duplicates = findDuplicateCandidates(entry, existing);
    if (duplicates.length > 0 && !input.duplicateOverrideReason) {
      throw erpError("duplicate_suspected", { duplicates });
    }

    const saved = await this.store.insertEntry(entry);
    await this.audit(
      "entry",
      saved.id,
      duplicates.length > 0 ? "create_duplicate_override" : "create",
      null,
      saved,
      actor,
      input.duplicateOverrideReason
    );
    return { entry: maskEntryForRole(saved, actor.role), duplicates };
  }

  /**
   * PATCH /entries/:code — 확정 건이면 -R1을 만들고 원본은 superseded,
   * 미확정이면 제자리 수정. If-Match: version 필수 (§10.1)
   */
  async patchEntry(
    code: string,
    patch: Partial<
      Pick<
        Entry,
        | "title"
        | "amount"
        | "amountCandidate"
        | "cashDate"
        | "accountCode"
        | "nature"
        | "buCode"
        | "projectId"
        | "payMethod"
        | "hasEvidence"
        | "note"
      >
    >,
    expectedVersion: number,
    actor: Actor,
    reason?: string
  ) {
    const entry = await this.requireWritable(code, actor);
    this.assertFresh(entry, expectedVersion);

    if (entry.status === "confirmed") {
      const all = await this.store.listEntries();
      const revisionCode = nextRevisionCode(
        entry.code,
        all.map(e => e.code)
      );
      const revision: Entry = {
        ...entry,
        ...patch,
        id: randomUUID(),
        code: revisionCode,
        parentCode: entry.code,
        status: "pending",
        // 원본과 같은 (source, source_ref)는 UNIQUE 제약에 걸리므로 수정본은 새 참조를 갖는다
        sourceRef: entry.sourceRef
          ? `${entry.sourceRef}#${revisionCode}`
          : null,
        priority:
          patch.accountCode !== undefined
            ? defaultPriorityOf(patch.accountCode)
            : entry.priority,
        version: 1,
        createdAt: nowIso(),
        createdBy: actor.id,
      };
      const superseded = {
        ...entry,
        status: "superseded" as const,
        version: entry.version + 1,
      };
      const locked = await this.store.replaceEntry(superseded, expectedVersion);
      if (!locked)
        throw erpError("version_conflict", {
          current: await this.store.getEntry(code),
        });
      await this.store.insertEntry(revision);
      await this.store.appendRevision({
        id: randomUUID(),
        entryId: entry.id,
        version: superseded.version,
        before: entry,
        after: revision,
        reason: reason ?? null,
        actor: actor.id,
        at: nowIso(),
      });
      await this.audit(
        "entry",
        entry.id,
        "supersede",
        entry,
        revision,
        actor,
        reason
      );
      return {
        entry: maskEntryForRole(revision, actor.role),
        supersededCode: entry.code,
      };
    }

    const updated: Entry = {
      ...entry,
      ...patch,
      priority:
        patch.accountCode !== undefined
          ? defaultPriorityOf(patch.accountCode)
          : entry.priority,
      version: entry.version + 1,
    };
    // 금액·항목이 채워지면 판정 대기에서 벗어난다 (§7.2)
    if (
      updated.status === "undecided" &&
      updated.amount != null &&
      updated.title.trim() !== ""
    ) {
      updated.status = "pending";
      updated.undecidedReason = null;
    }
    const saved = await this.store.replaceEntry(updated, expectedVersion);
    if (!saved)
      throw erpError("version_conflict", {
        current: await this.store.getEntry(code),
      });
    await this.store.appendRevision({
      id: randomUUID(),
      entryId: entry.id,
      version: updated.version,
      before: entry,
      after: updated,
      reason: reason ?? null,
      actor: actor.id,
      at: nowIso(),
    });
    await this.audit(
      "entry",
      entry.id,
      "update",
      entry,
      updated,
      actor,
      reason
    );
    return { entry: maskEntryForRole(saved, actor.role), supersededCode: null };
  }

  /** POST /entries/:code/cancel — -C 상계. reason 필수 */
  async cancelEntry(
    code: string,
    reason: string,
    expectedVersion: number,
    actor: Actor
  ) {
    if (!reason?.trim()) throw erpError("reason_required");
    const entry = await this.requireWritable(code, actor);
    this.assertFresh(entry, expectedVersion);
    const cancelled = {
      ...entry,
      status: "cancelled" as const,
      version: entry.version + 1,
    };
    const locked = await this.store.replaceEntry(cancelled, expectedVersion);
    if (!locked)
      throw erpError("version_conflict", {
        current: await this.store.getEntry(code),
      });

    const counter: Entry = {
      ...entry,
      id: randomUUID(),
      code: cancelCode(entry.code),
      parentCode: entry.code,
      status: "confirmed",
      amount: entry.amount == null ? null : -entry.amount,
      note: `취소 상계 — ${reason}`,
      sourceRef: entry.sourceRef ? `${entry.sourceRef}#C` : null,
      version: 1,
      createdAt: nowIso(),
      createdBy: actor.id,
    };
    await this.store.insertEntry(counter);
    if (counter.amount != null && counter.accountCode)
      await this.createJournal(counter);
    await this.audit(
      "entry",
      entry.id,
      "cancel",
      entry,
      counter,
      actor,
      reason
    );
    return { cancelledCode: entry.code, counterCode: counter.code };
  }

  /** 우선순위 등급 상향 — 사유 필수, 계정 기본값은 지우지 않는다 (§8.2) */
  async setPriorityOverride(
    code: string,
    priority: Priority | null,
    reason: string | null,
    expectedVersion: number,
    actor: Actor
  ) {
    if (priority && !reason?.trim()) throw erpError("reason_required");
    const entry = await this.requireWritable(code, actor);
    this.assertFresh(entry, expectedVersion);
    const updated: Entry = {
      ...entry,
      priorityOverride: priority,
      priorityReason: priority ? (reason ?? null) : null,
      version: entry.version + 1,
    };
    const saved = await this.store.replaceEntry(updated, expectedVersion);
    if (!saved)
      throw erpError("version_conflict", {
        current: await this.store.getEntry(code),
      });
    await this.audit(
      "entry",
      entry.id,
      "priority_override",
      entry,
      updated,
      actor,
      reason ?? undefined
    );
    return { entry: maskEntryForRole(saved, actor.role) };
  }

  // ── 승인 ────────────────────────────────────────────────────────────────

  /** POST /entries/:code/approve — 확정 + 전표 자동 생성 */
  async approve(code: string, expectedVersion: number, actor: Actor) {
    const entry = await this.requireWritable(code, actor);
    this.assertFresh(entry, expectedVersion);
    if (entry.status !== "pending")
      throw erpError("invalid_transition", { status: entry.status });
    if (entry.amount == null) throw erpError("amount_undecided");
    if (!entry.accountCode) throw erpError("account_required");
    if (!entry.hasEvidence) throw erpError("evidence_required");
    if (entry.createdBy === actor.id) throw erpError("self_approval");
    if (!canApproveAmount(actor.role, entry.amount))
      throw erpError("approval_limit", { amount: entry.amount });

    const confirmed = {
      ...entry,
      status: "confirmed" as const,
      version: entry.version + 1,
    };
    const saved = await this.store.replaceEntry(confirmed, expectedVersion);
    if (!saved) {
      const current = await this.store.getEntry(code);
      throw erpError(
        "version_conflict",
        { current },
        current?.status === "confirmed"
          ? "다른 사람이 먼저 처리했습니다 — 현재 상태는 확정입니다"
          : undefined
      );
    }
    await this.store.appendApproval({
      id: randomUUID(),
      entryId: entry.id,
      step: 1,
      approverRole: actor.role,
      actor: actor.id,
      decision: "approve",
      reason: null,
      at: nowIso(),
    });
    const journal = await this.createJournal(confirmed);
    await this.audit("entry", entry.id, "approve", entry, confirmed, actor);

    // 응답에 영향받은 날짜의 재계산 결과를 함께 돌려준다 (§10.1)
    const cashflow = await this.cashflow("day");
    const affected =
      cashflow.blocks.find(b => b.key === confirmed.cashDate) ?? null;
    return {
      entry: maskEntryForRole(confirmed, actor.role),
      journal,
      affectedBlock: affected,
    };
  }

  async reject(
    code: string,
    reason: string,
    expectedVersion: number,
    actor: Actor
  ) {
    if (!reason?.trim()) throw erpError("reason_required");
    return this.decide(
      code,
      "rejected",
      "reject",
      reason,
      expectedVersion,
      actor
    );
  }

  async hold(
    code: string,
    reason: string,
    expectedVersion: number,
    actor: Actor
  ) {
    if (!reason?.trim()) throw erpError("reason_required");
    return this.decide(code, "held", "hold", reason, expectedVersion, actor);
  }

  /** POST /approvals/bulk — 부분 실패를 건별로 반환한다 (§10.1) */
  async bulkApprove(
    codes: string[],
    decision: "approve" | "reject",
    reason: string | null,
    actor: Actor
  ) {
    const results: { code: string; ok: boolean; error?: string }[] = [];
    for (const code of codes) {
      const entry = await this.store.getEntry(code);
      if (!entry) {
        results.push({
          code,
          ok: false,
          error: "해당 코드를 찾을 수 없습니다",
        });
        continue;
      }
      try {
        if (decision === "approve")
          await this.approve(code, entry.version, actor);
        else
          await this.reject(code, reason ?? "일괄 반려", entry.version, actor);
        results.push({ code, ok: true });
      } catch (error) {
        results.push({
          code,
          ok: false,
          error: error instanceof Error ? error.message : "처리 실패",
        });
      }
    }
    return {
      results,
      ok: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
    };
  }

  // ── 내부 ────────────────────────────────────────────────────────────────

  private async decide(
    code: string,
    status: Entry["status"],
    decision: "reject" | "hold",
    reason: string,
    expectedVersion: number,
    actor: Actor
  ) {
    const entry = await this.requireWritable(code, actor);
    this.assertFresh(entry, expectedVersion);
    const updated = { ...entry, status, version: entry.version + 1 };
    const saved = await this.store.replaceEntry(updated, expectedVersion);
    if (!saved)
      throw erpError("version_conflict", {
        current: await this.store.getEntry(code),
      });
    await this.store.appendApproval({
      id: randomUUID(),
      entryId: entry.id,
      step: 1,
      approverRole: actor.role,
      actor: actor.id,
      decision,
      reason,
      at: nowIso(),
    });
    await this.audit(
      "entry",
      entry.id,
      decision,
      entry,
      updated,
      actor,
      reason
    );
    return { entry: maskEntryForRole(saved, actor.role) };
  }

  /**
   * 낙관적 잠금 — 다른 사람이 먼저 처리했으면 상태 검증보다 먼저 409를 돌려준다.
   * 그래야 "왜 안 되는지"가 "이 상태에서는 안 됨"이 아니라 "먼저 처리됨"으로 나온다 (§4 · T8).
   */
  private assertFresh(entry: Entry, expectedVersion: number) {
    if (entry.version === expectedVersion) return;
    throw erpError(
      "version_conflict",
      { current: entry },
      `다른 사람이 먼저 처리했습니다 — 현재 상태는 ${STATUS_RULES[entry.status].label}입니다`
    );
  }

  private async requireWritable(code: string, actor: Actor): Promise<Entry> {
    const entry = await this.store.getEntry(code);
    if (!entry) throw erpError("not_found", { code });
    // 이관 구간은 건별 명세가 없으므로 원장에 존재하지 않는다 (§5.3) — 도달하면 코드 오류
    const parsed = parseCode(entry.code);
    if (!parsed) throw erpError("invalid_transition", { code });
    const settings = await this.store.listSettings();
    const closed = settingValue<string[]>(settings, "closed_periods") ?? [];
    const ym = (entry.cashDate ?? entry.accrualDate ?? "").slice(0, 7);
    if (ym && closed.includes(ym)) throw erpError("period_closed", { ym });
    return entry;
  }

  /** 원장이 확정되는 순간 전표(분개)가 자동 생성된다. 사람이 분개를 만들지 않는다 (원칙 12). */
  private async createJournal(entry: Entry): Promise<Journal | null> {
    if (entry.amount == null || !entry.accountCode) return null;
    const journalId = randomUUID();
    const counter = counterAccountFor(entry.payMethod);
    const amount = Math.abs(entry.amount);
    const sign = entry.amount < 0 ? -1 : 1;
    // 지출: 비용/자산 차변 · 현금 대변. 수입: 현금 차변 · 수익/부채 대변.
    const outward = entry.direction === "out";
    const debitAccount = outward ? entry.accountCode : counter;
    const creditAccount = outward ? counter : entry.accountCode;
    const journal: Journal = {
      id: journalId,
      entryId: entry.id,
      journalDate: entry.cashDate ?? entry.accrualDate ?? nowIso().slice(0, 10),
      memo: entry.title || entry.noteRaw,
      auto: true,
      reversedBy: null,
      lines: [
        {
          id: randomUUID(),
          journalId,
          accountCode: debitAccount,
          debit: amount * sign,
          credit: 0,
          buCode: entry.buCode,
          projectId: entry.projectId,
        },
        {
          id: randomUUID(),
          journalId,
          accountCode: creditAccount,
          debit: 0,
          credit: amount * sign,
          buCode: entry.buCode,
          projectId: entry.projectId,
        },
      ],
    };
    await this.store.appendJournal(journal);
    return journal;
  }

  private async audit(
    table: string,
    rowId: string,
    action: string,
    before: unknown,
    after: unknown,
    actor: Actor,
    reason?: string
  ) {
    await this.store.appendAudit({
      id: randomUUID(),
      table,
      rowId,
      action,
      before,
      after: reason ? { ...(after as object), _reason: reason } : after,
      actor: actor.id,
      ip: actor.ip ?? null,
      at: nowIso(),
    });
  }
}

export type { MaskedEntry };
