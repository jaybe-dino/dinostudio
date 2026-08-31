/**
 * 원장 서비스 — §7 상태 전이 · §10 API 계약 · §13 내부통제의 구현부.
 *
 * 지켜야 할 것
 *   · 파생 뷰는 저장하지 않는다. 매번 원장에서 계산한다 (§4)
 *   · 물리 삭제는 없다. 수정은 -R1, 취소는 -C (원칙 9 · §7.1)
 *   · 승인 없이는 지표가 아니다 (원칙 7) · 모르면 계산불가 (원칙 8)
 */
import {
  NOTIFICATION_RULES,
  applyCeoCap,
  buildArReport,
  buildDebtReport,
  buildFinancialStatements,
  buildForecast,
  buildJournal,
  buildReversal,
  isPayrollAccount,
  buildPnl,
  buildRunway,
  closingBlockers,
  evaluateNotifications,
  importSheet,
  looksLikeExpenseRequest,
  opexBreakdown,
  parseSlackExpense,
  kstIso,
  kstToday,
  permissionFor,
  segmentPnl,
  trialBalance,
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
  checkEvidenceInput,
  evidenceRisk,
  type EvidenceStorage,
} from "../../shared/erp/index.js";
import type {
  Account,
  AppUser,
  Attachment,
  Contract,
  Debt,
  DebtSchedule,
  Party,
  Period,
  Project,
  Scenario,
  CashflowUnit,
  Direction,
  Entry,
  Journal,
  MaskedEntry,
  Priority,
  PriorityOverrideInput,
  Role,
} from "../../shared/erp/index.js";
import { randomUUID } from "node:crypto";
import { aiParseExpense } from "../integrations/aiParser.js";
import { postSlackMessage, slackConfigured } from "../integrations/slack.js";
import {
  createUploadTicket,
  storageConfigured,
  validateUpload,
  viewPath,
} from "./attachments.js";
import { erpError } from "./errors.js";
import type { EntryFilter, LedgerStore } from "./store.js";

export interface Actor {
  /** 감사로그·본인 승인 금지 판정에 쓰는 식별자 */
  id: string;
  role: Role;
  ip?: string | null;
}

// §14 — 모든 시각·일자는 KST 기준으로 만든다
const nowIso = () => kstIso();

export class LedgerService {
  constructor(private readonly store: LedgerStore) {}

  // ── 조회 ────────────────────────────────────────────────────────────────

  /** GET /entries — 마스킹은 응답 단계에서 한다 (§13.3) */
  async listEntries(
    filter: EntryFilter,
    actor: Actor,
    page?: { cursor?: string | null; limit?: number }
  ) {
    const entries = await this.store.listEntries(filter);
    // §13.3 — 급여·부채는 조회도 감사로그에 남긴다
    await this.recordSensitiveRead(entries, actor, "entries");

    // §14 — offset 금지. 코드는 불변이므로 커서로 쓰기에 안전하다 (승인으로 순서가 바뀌지 않음)
    const ordered = [...entries].sort((a, b) =>
      `${a.cashDate ?? ""}${a.code}` < `${b.cashDate ?? ""}${b.code}` ? -1 : 1
    );
    const limit = page?.limit ?? ordered.length;
    const start = page?.cursor
      ? ordered.findIndex(e => e.code === page.cursor) + 1
      : 0;
    const slice = ordered.slice(start, start + limit);
    const nextCursor =
      start + limit < ordered.length ? (slice.at(-1)?.code ?? null) : null;

    return {
      page: slice.map(e => maskEntryForRole(e, actor.role)),
      nextCursor,
      total: ordered.length,
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

  /**
   * GET /cashflow?unit=day|month|year&cursor=&limit=
   *
   * 커서 페이징이다. offset을 쓰면 스크롤 중에 승인이 일어나 순서가 바뀔 때
   * 같은 블록이 두 번 나오거나 건너뛴다 (§14). 커서는 마지막으로 받은 블록 키다.
   */
  async cashflow(unit: CashflowUnit, cursor: string | null = null, limit = 3) {
    const [entries, snapshots] = await Promise.all([
      this.store.listEntries(),
      this.store.listSnapshots(),
    ]);
    const blocks = buildCashflow(entries, snapshots, unit);
    // 최신순으로 내려간다 — 커서보다 오래된 블록만
    const descending = [...blocks].reverse();
    const start = cursor
      ? descending.findIndex(block => block.key === cursor) + 1
      : 0;
    const page = descending.slice(start, start + limit);
    const nextCursor =
      start + limit < descending.length ? (page.at(-1)?.key ?? null) : null;
    // 현금흐름표의 「n건 제외 중」은 이 화면의 모집단(입출금일이 있는 건)에 대한 것이다.
    // 아직 들어오지 않은 채권처럼 입출금일이 없는 건은 애초에 어느 블록에도 없다.
    const undecided = entries.filter(
      e => e.status === "undecided" && e.cashDate != null
    );
    return {
      unit,
      /** 이 페이지의 블록 (최신순) — 커서로 이어 받는다 */
      page,
      nextCursor,
      totalBlocks: descending.length,
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

  /**
   * 오늘 — D-day · 연체 판정의 기준일.
   * setting.today_override가 있으면 그것을 쓴다. 이관 시점(2026-08-27) 기준으로
   * 사양서의 D-day를 재현·검증할 수 있어야 하기 때문이다.
   */
  private async today(): Promise<string> {
    const settings = await this.store.listSettings();
    return settingValue<string>(settings, "today_override") ?? kstToday();
  }

  /** GET /ar — 미수 / 발행 대기 / DSO (§9.3) */
  async ar() {
    const [entries, parties, contracts, today] = await Promise.all([
      this.store.listEntries(),
      this.store.listParties(),
      this.store.listContracts(),
      this.today(),
    ]);
    return buildArReport(entries, parties, contracts, today);
  }

  /** GET /debt — 차입 원장 + D-day + 알람 상태 (§9.4) */
  async debt() {
    const [debts, settings, today] = await Promise.all([
      this.store.listDebts(),
      this.store.listSettings(),
      this.today(),
    ]);
    return buildDebtReport(
      debts,
      today,
      settingValue<number>(settings, "debt_long_term_total")
    );
  }

  /** GET /forecast/13w — 주차별 잔액 · 예상런웨이 (§9.5) */
  async forecast(scenario: Scenario = "Base") {
    const [entries, schedules, settings, today] = await Promise.all([
      this.store.listEntries(),
      this.store.listDebtSchedules(),
      this.store.listSettings(),
      this.today(),
    ]);
    return buildForecast(entries, schedules, {
      today,
      openingCash: settingValue<number>(settings, "cash_on_hand"),
      scenario,
      pipelineProbability: settingValue<Record<string, number>>(
        settings,
        "pipeline_probability"
      ),
    });
  }

  /** 전표 · 분개장 + 시산표 */
  async journals() {
    const [journals, entries] = await Promise.all([
      this.store.listJournals(),
      this.store.listEntries(),
    ]);
    const byId = new Map(entries.map(e => [e.id, e]));
    return {
      journals: journals.map(j => ({
        ...j,
        entryCode: byId.get(j.entryId)?.code ?? j.entryId,
      })),
      trialBalance: trialBalance(journals),
    };
  }

  /** 마스터 — 거래처 · 프로젝트 · 계약 · 차입 · 검수함 */
  async masters() {
    const [parties, projects, contracts, debts, schedules, intakes, periods] =
      await Promise.all([
        this.store.listParties(),
        this.store.listProjects(),
        this.store.listContracts(),
        this.store.listDebts(),
        this.store.listDebtSchedules(),
        this.store.listIntakes(),
        this.store.listPeriods(),
      ]);
    return { parties, projects, contracts, debts, schedules, intakes, periods };
  }

  async upsertMaster(
    kind: "party" | "project" | "contract" | "debt" | "debtSchedule",
    payload: Party | Project | Contract | Debt | DebtSchedule,
    actor: Actor
  ) {
    let saved: unknown;
    if (kind === "party")
      saved = await this.store.upsertParty(payload as Party);
    else if (kind === "project")
      saved = await this.store.upsertProject(payload as Project);
    else if (kind === "contract")
      saved = await this.store.upsertContract(payload as Contract);
    else if (kind === "debt")
      saved = await this.store.upsertDebt(payload as Debt);
    else saved = await this.store.upsertDebtSchedule(payload as DebtSchedule);
    await this.audit(
      kind,
      (payload as { id: string }).id,
      "upsert",
      null,
      saved,
      actor
    );
    return saved;
  }

  /**
   * §12 알림 — 지금 울려야 할 것을 계산해 **알림함에 적재**하고, 도착지가 설정돼 있으면 발송한다.
   * 발송 실패도 알림함에는 남는다 — 도착지가 죽어 있어도 경보가 사라지면 안 된다 (B7).
   */
  async notifications(actor: Actor) {
    const [cashPosition, ar, debt, today, stored] = await Promise.all([
      this.cashPosition({}, actor),
      this.ar(),
      this.debt(),
      this.today(),
      this.store.listNotifications(),
    ]);

    const evaluated = evaluateNotifications({ cashPosition, ar, debt, today });
    const { delivered, capped } = applyCeoCap(evaluated, NOTIFICATION_RULES);
    const byId = new Map(stored.map(item => [item.id, item]));

    for (const notification of delivered) {
      const existing = byId.get(notification.id);
      // 이미 적재된 알림은 읽음 표시를 지우지 않는다
      if (existing) continue;
      const channel = process.env.SLACK_NOTIFY_CHANNEL;
      let sentAt: string | null = null;
      if (channel && slackConfigured()) {
        const result = await postSlackMessage(
          channel,
          `*${notification.title}*\n${notification.body}`
        );
        if (result.sent) sentAt = nowIso();
      }
      const saved = { ...notification, sentAt };
      await this.store.upsertNotification(saved);
      byId.set(saved.id, saved);
    }

    const inbox = Array.from(byId.values()).sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1
    );
    return {
      rules: NOTIFICATION_RULES,
      delivered: inbox,
      capped,
      unread: inbox.filter(item => item.readAt == null).length,
      /** 도착지가 설정돼 있는가 — 아니면 알림함에만 쌓인다 */
      destination:
        process.env.SLACK_NOTIFY_CHANNEL && slackConfigured() ? "슬랙" : null,
    };
  }

  async markNotificationRead(id: string, actor: Actor) {
    const stored = await this.store.listNotifications();
    const found = stored.find(item => item.id === id);
    if (!found) throw erpError("not_found", { id });
    const saved = await this.store.upsertNotification({
      ...found,
      readAt: nowIso(),
    });
    await this.audit("notification", id, "read", found, saved, actor);
    return saved;
  }

  /** GET /metrics/runway — 단순 · 예상 · 예약 3종 (§9.6 · T15) */
  async runway() {
    const [entries, periods, settings, forecast, debts] = await Promise.all([
      this.store.listEntries(),
      this.store.listPeriods(),
      this.store.listSettings(),
      this.forecast("Base"),
      this.store.listDebts(),
    ]);
    const confirmedInterest = debts
      .map(d => d.monthlyInterest)
      .filter((v): v is number => v != null);
    return {
      ...buildRunway({
        entries,
        periods,
        cashOnHand: settingValue<number>(settings, "cash_on_hand"),
        payrollMonthly: settingValue<number>(
          settings,
          "payroll_monthly_actual"
        ),
        subscriptionsRegistered: settingValue<unknown[]>(
          settings,
          "subscriptions"
        )?.length
          ? true
          : false,
        // 약정서가 없으므로(B2) 이자 월액은 확정으로 보지 않는다
        debtMonthlyInterest:
          debts.every(d => d.maturityDate != null) &&
          confirmedInterest.length > 0
            ? confirmedInterest.reduce((a, b) => a + b, 0)
            : null,
        expectedRunwayWeeks: forecast.expectedRunwayWeeks,
      }),
      opex: opexBreakdown(entries),
    };
  }

  /** GET /pnl — 회계 계단 + 관리 계단 동시 반환 (§9.7) */
  async pnl(options: {
    from?: string | null;
    to?: string | null;
    bu?: string | null;
    project?: string | null;
  }) {
    const entries = await this.store.listEntries();
    return {
      total: buildPnl(entries, {
        from: options.from,
        to: options.to,
        buCode: options.bu,
        projectId: options.project,
      }),
      byBu: segmentPnl(entries, "buCode", {
        from: options.from,
        to: options.to,
      }),
      byProject: segmentPnl(entries, "projectId", {
        from: options.from,
        to: options.to,
      }),
    };
  }

  /** GET /fs/:kind — 재무제표 5종 (§9.8) */
  async financialStatements(ym: string | null) {
    const [entries, journals, periods, settings] = await Promise.all([
      this.store.listEntries(),
      this.store.listJournals(),
      this.store.listPeriods(),
      this.store.listSettings(),
    ]);
    return buildFinancialStatements(entries, journals, {
      ym,
      periods,
      openingEquity: settingValue<number>(settings, "opening_equity"),
    });
  }

  /** POST /periods/:ym/close — blockers가 비어야만 성공 (T12) */
  async closePeriod(ym: string, actor: Actor) {
    const [entries, snapshots] = await Promise.all([
      this.store.listEntries(),
      this.store.listSnapshots(),
    ]);
    const failures = runMigrationChecks(entries, snapshots)
      .filter(c => c.verdict === "fail")
      .map(c => `${c.id} ${c.name} — ${c.detail}`);
    const blockers = closingBlockers(entries, ym, failures);
    const period: Period = {
      ym,
      status: blockers.length === 0 ? "closed" : "open",
      closedBy: blockers.length === 0 ? actor.id : null,
      closedAt: blockers.length === 0 ? nowIso() : null,
      blockers,
    };
    await this.store.upsertPeriod(period);
    await this.audit(
      "period",
      ym,
      blockers.length === 0 ? "close" : "close_rejected",
      null,
      period,
      actor
    );
    if (blockers.length > 0)
      throw erpError(
        "period_closed",
        { ym, blockers },
        `${ym} 마감 불가 — ${blockers.length}건이 막고 있습니다`
      );
    return period;
  }

  /**
   * 시트 이관 — 구글 시트에서 복사한 표를 미리보기하고, 확인 후에만 적재한다.
   * 적요칸 숫자를 금액으로 승격하지 않고, 단위 불명은 후보로도 올리지 않는다 (§5.2 · 원칙 8).
   */
  async previewSheetImport(text: string, from: string | null, actor: Actor) {
    const existing = await this.store.listEntries();
    return importSheet(text, {
      existingCodes: existing.map(e => e.code),
      from,
      actor: actor.id,
    });
  }

  async commitSheetImport(text: string, from: string | null, actor: Actor) {
    const existing = await this.store.listEntries();
    const seen = new Set(existing.map(e => `${e.source}:${e.sourceRef}`));
    const result = importSheet(text, {
      existingCodes: existing.map(e => e.code),
      from,
      actor: actor.id,
    });

    let inserted = 0;
    let skipped = 0;
    for (const item of result.entries) {
      // 같은 줄을 두 번 들여오지 않는다 — UNIQUE (source, source_ref)
      if (seen.has(`${item.entry.source}:${item.entry.sourceRef}`)) {
        skipped += 1;
        continue;
      }
      await this.store.insertEntry(item.entry);
      seen.add(`${item.entry.source}:${item.entry.sourceRef}`);
      inserted += 1;
    }
    await this.audit(
      "entry",
      "sheet-import",
      "import",
      null,
      { inserted, skipped, from },
      actor
    );
    return { ...result, inserted, skipped };
  }

  /**
   * §11.1 슬랙 수집 — 규칙 파서를 먼저 돌리고, 못 읽은 것만 AI에 넘긴다.
   * 어느 쪽이든 결과는 원장이 아니라 **검수함**에 선다. 사람이 확인해야 원장으로 올라간다 (원칙 7).
   */
  async collectSlackMessage(
    message: { channel: string; ts: string; text: string; user: string | null },
    actor: Actor
  ) {
    const existing = await this.store.listIntakes();
    if (
      existing.some(
        item => item.source === "slack" && item.sourceRef === message.ts
      )
    ) {
      // 같은 스레드 ts는 두 번 들어오지 않는다 (§6.2 UNIQUE · T9)
      return { status: "duplicate" as const, id: null };
    }
    if (!looksLikeExpenseRequest(message.text)) {
      return { status: "ignored" as const, id: null };
    }

    const today = await this.today();
    const rule = parseSlackExpense(message.text, Number(today.slice(0, 4)));

    let parsed: Record<string, unknown> | null = null;
    let status = "waiting";
    let failReason: string | null = null;

    if (rule.matchedFields > 0) {
      parsed = {
        by: "rule",
        ...rule.fields,
        warnings: rule.warnings,
        missing: rule.missingRequired,
      };
      if (rule.missingRequired.length > 0) {
        failReason = `필수 항목 누락 — ${rule.missingRequired.join(" · ")}`;
      }
    } else {
      // 비정형(수기) 메시지 — 파싱 실패를 허용하고 AI에 넘긴다 (§11.1)
      try {
        const ai = await aiParseExpense(message.text, today);
        if (ai && ai.isExpenseRequest) {
          parsed = {
            by: "ai",
            model: ai.model,
            ...ai.fields,
            uncertain: ai.uncertain,
          };
          if (ai.uncertain.length > 0) failReason = ai.uncertain.join(" · ");
        } else if (ai) {
          return { status: "ignored" as const, id: null };
        } else {
          status = "failed";
          failReason =
            "규칙 파서가 읽지 못했고 AI 파서가 설정되지 않았습니다 — 수기 입력이 필요합니다";
        }
      } catch (error) {
        status = "failed";
        failReason = error instanceof Error ? error.message : "AI 파싱 실패";
      }
    }

    const id = randomUUID();
    await this.store.upsertIntake({
      id,
      source: "slack",
      sourceRef: message.ts,
      raw: message.text,
      parsed,
      status,
      failReason,
      entryId: null,
      receivedAt: nowIso(),
    });
    await this.audit(
      "intake",
      id,
      "collect",
      null,
      { channel: message.channel, status },
      actor
    );
    return { status: status as "waiting" | "failed", id };
  }

  /** POST /intake/:id/promote — 검수 통과 → entry 생성 (§10.1) */
  async promoteIntake(intakeId: string, actor: Actor) {
    const intakes = await this.store.listIntakes();
    const intake = intakes.find(item => item.id === intakeId);
    if (!intake) throw erpError("not_found", { intakeId });
    if (intake.entryId)
      throw erpError(
        "duplicate_suspected",
        { entryId: intake.entryId },
        "이미 원장에 적재된 건입니다"
      );

    const parsed = (intake.parsed ?? {}) as Record<string, unknown>;
    const str = (key: string) =>
      typeof parsed[key] === "string" ? (parsed[key] as string) : null;
    const num = (key: string) =>
      typeof parsed[key] === "number" ? (parsed[key] as number) : null;
    const parties = await this.store.listParties();
    const partyName = str("partyName");
    const party = partyName
      ? parties.find(p => p.name === partyName)
      : undefined;

    const created = await this.createEntry(
      {
        direction: "out",
        title: str("title") ?? "",
        amount: num("amount"),
        cashDate: str("requestDate") ?? (await this.today()),
        accountCode: null,
        nature: "미지정",
        buCode: (str("buCode") ?? null) as never,
        hasEvidence: false,
        noteRaw: intake.raw,
        source: "slack",
        sourceRef: intake.sourceRef,
        // 검수함을 통과한 건은 사람이 이미 중복을 봤다
        duplicateOverrideReason: "검수함에서 확인 후 적재",
      },
      actor
    );

    await this.store.upsertIntake({
      ...intake,
      status: "promoted",
      entryId: created.entry.id,
    });
    await this.audit(
      "intake",
      intake.id,
      "promote",
      intake,
      { entryCode: created.entry.code },
      actor
    );
    return {
      entry: created.entry,
      /** 거래처가 마스터에 없으면 신규 후보로 남긴다 (§11.1) */
      partyMatched: party ? party.name : null,
      partyCandidate: party ? null : partyName,
    };
  }

  async rejectIntake(intakeId: string, reason: string, actor: Actor) {
    const intakes = await this.store.listIntakes();
    const intake = intakes.find(item => item.id === intakeId);
    if (!intake) throw erpError("not_found", { intakeId });
    if (!reason.trim()) throw erpError("reason_required");
    await this.store.upsertIntake({
      ...intake,
      status: "rejected",
      failReason: reason,
    });
    await this.audit("intake", intake.id, "reject", intake, { reason }, actor);
    return { ok: true };
  }

  /**
   * PUT /settings/:key — 임시 기본값·기준값 교체. 변경 시 감사로그 필수 (§10.1).
   * 급여 실액(B1) · 보유현금 · 소요 지평 같은 차단 항목이 여기서 풀린다.
   */
  async putSetting(
    key: string,
    value: unknown,
    isProvisional: boolean,
    actor: Actor,
    reason?: string
  ) {
    const settings = await this.store.listSettings();
    const before = settings.find(item => item.key === key) ?? null;

    // §13.1 기준값 — 대표는 승인(RWA), 재무는 제안(W). 그 외 역할은 손대지 못한다.
    const permission = permissionFor(actor.role, "setting");
    if (!permission.write)
      throw erpError(
        "forbidden_field",
        { key },
        "기준값을 변경할 권한이 없습니다"
      );

    const saved = await this.store.putSetting({
      key,
      value,
      isProvisional,
      ownerRole: before?.ownerRole ?? actor.role,
      updatedBy: actor.id,
      updatedAt: nowIso(),
    });
    await this.audit("setting", key, "put", before, saved, actor, reason);
    return saved;
  }

  /** PUT /accounts — 계정과목 마스터. 자동 판정 3종이 전부 이 컬럼에서 나온다 (§8) */
  async putAccount(account: Account, actor: Actor) {
    const permission = permissionFor(actor.role, "account");
    if (!permission.write)
      throw erpError(
        "forbidden_field",
        { code: account.code },
        "계정과목 마스터를 변경할 권한이 없습니다"
      );
    const before =
      (await this.store.listAccounts()).find(
        item => item.code === account.code
      ) ?? null;
    const saved = await this.store.upsertAccount(account);
    await this.audit("account", account.code, "put", before, saved, actor);
    return saved;
  }

  // ── 증빙 (§6.3 attachment · §13.2) ──────────────────────────────────────

  /** 파일 업로드 티켓 — 스토리지가 없으면 링크 등록만 열어 둔다 */
  async requestEvidenceUpload(
    code: string,
    fileName: string,
    contentType: string,
    sizeBytes: number,
    actor: Actor
  ) {
    const entry = await this.store.getEntry(code);
    if (!entry) throw erpError("not_found", { code });
    if (!storageConfigured()) {
      throw erpError(
        "evidence_required",
        {},
        "파일 스토리지가 설정되지 않았습니다 — 드라이브 링크로 등록하십시오"
      );
    }
    const problem = validateUpload(fileName, contentType, sizeBytes);
    if (problem) throw erpError("evidence_required", { fileName }, problem);
    const id = randomUUID();
    const ticket = await createUploadTicket(
      entry.code,
      fileName,
      contentType,
      id
    );
    await this.audit(
      "attachment",
      id,
      "upload_ticket",
      null,
      { code, fileName },
      actor
    );
    return { ...ticket, attachmentId: id };
  }

  /**
   * 증빙 등록 — 파일 · 외부 링크 · 증빙 없음(사유 필수).
   *
   * 증빙이 하나라도 붙으면 hasEvidence 가 켜져 확정이 가능해진다 (§13.2).
   * 「증빙 없음」도 여기에 포함된다 — 막는 대신 사유를 남기고 손해액을 보여 준다.
   * 세무상 결과(매입세액·가산세)는 evidenceRisk 가 계산해 화면에 표시한다.
   */
  async addEvidence(
    input: {
      code: string;
      kind: string;
      storage: EvidenceStorage;
      url?: string | null;
      reason?: string | null;
      fileName?: string | null;
      sizeBytes?: number | null;
      contentType?: string | null;
      attachmentId?: string | null;
    },
    actor: Actor
  ) {
    const entry = await this.store.getEntry(input.code);
    if (!entry) throw erpError("not_found", { code: input.code });

    const problem = checkEvidenceInput({
      kind: input.kind,
      storage: input.storage,
      url: input.url,
      reason: input.reason,
    });
    if (problem) throw erpError("evidence_required", {}, problem);

    const attachment: Attachment = {
      id: input.attachmentId ?? randomUUID(),
      entryId: entry.id,
      kind: input.kind,
      fileName: input.fileName ?? null,
      url:
        input.storage === "file"
          ? viewPath(input.url ?? "")
          : input.storage === "link"
            ? (input.url ?? "")
            : "",
      storage: input.storage,
      reason: input.storage === "none" ? (input.reason ?? "").trim() : null,
      sizeBytes: input.sizeBytes ?? null,
      contentType: input.contentType ?? null,
      uploadedBy: actor.id,
      at: nowIso(),
    };
    await this.store.appendAttachment(attachment);

    if (!entry.hasEvidence) {
      // 증빙이 붙었으므로 확정을 막던 사유가 사라진다
      await this.store.replaceEntry(
        { ...entry, hasEvidence: true, version: entry.version + 1 },
        entry.version
      );
    }
    await this.audit(
      "attachment",
      attachment.id,
      "add",
      null,
      attachment,
      actor
    );
    return attachment;
  }

  async evidence(code: string) {
    const entry = await this.store.getEntry(code);
    if (!entry) throw erpError("not_found", { code });
    const attachments = await this.store.listAttachments(entry.id);
    return {
      attachments,
      storageConfigured: storageConfigured(),
      // 손해액은 서버에서 한 번만 계산한다 — 화면이 각자 계산하면 숫자가 갈린다 (원칙 12)
      risk: evidenceRisk({
        direction: entry.direction,
        amount: entry.amount,
        isEntertainment: entry.accountCode === "6410",
        attachments: attachments.map(a => ({
          kind: a.kind,
          storage: a.storage,
        })),
      }),
    };
  }

  // ── 사용자 · 역할 (§13.1 · G13) ─────────────────────────────────────────

  async appUsers(actor: Actor) {
    if (!permissionFor(actor.role, "setting").read) {
      throw erpError("forbidden_field", {}, "사용자 목록을 볼 권한이 없습니다");
    }
    return this.store.listAppUsers();
  }

  /** 계정 발급 · 역할 지정 — 대표만. 권한을 나눠주는 일은 위임하지 않는다 */
  async putAppUser(user: AppUser, actor: Actor) {
    if (actor.role !== "대표") {
      throw erpError(
        "forbidden_field",
        {},
        "역할 지정은 대표만 할 수 있습니다"
      );
    }
    const before =
      (await this.store.listAppUsers()).find(u => u.id === user.id) ?? null;
    const saved = await this.store.upsertAppUser(user);
    // 배정이 바뀌면 역할 해석 캐시를 즉시 갱신한다
    const { setAssignedRoles } = await import("./index.js");
    setAssignedRoles(await this.store.listAppUsers());
    await this.audit("app_user", user.id, "put", before, saved, actor);
    return saved;
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
      invoiceDate: null,
      source: input.source ?? "manual",
      sourceRef: input.sourceRef ?? null,
      roundNo: null,
      linkedRevenueCode: null,
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
      // §7.3 — 대체된 건의 전표는 역분개로 상계한다. 지우지 않는다 (원칙 9).
      for (const journal of await this.store.listJournals(entry.id)) {
        if (journal.reversedBy) continue; // 이미 역분개된 전표는 건너뛴다
        await this.store.appendJournal(
          buildReversal(journal, () => randomUUID())
        );
      }
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

  /**
   * §13.3 — 급여·부채 테이블은 조회도 감사로그에 남긴다.
   * 누가 언제 인건비를 들여다봤는지가 남아야 마스킹이 통제로 성립한다.
   */
  private async recordSensitiveRead(
    entries: Entry[],
    actor: Actor,
    scope: string
  ) {
    const sensitive = entries.filter(
      e =>
        isPayrollAccount(e.accountCode) ||
        e.accountCode === "2210" ||
        e.accountCode === "2310"
    );
    if (sensitive.length === 0) return;
    await this.audit(
      "entry",
      scope,
      "read_sensitive",
      null,
      { n: sensitive.length, codes: sensitive.map(e => e.code) },
      actor
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
    const journal = buildJournal(entry, () => randomUUID());
    if (journal) await this.store.appendJournal(journal);
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
