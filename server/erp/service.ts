/**
 * 원장 서비스 — §7 상태 전이 · §10 API 계약 · §13 내부통제의 구현부.
 *
 * 지켜야 할 것
 *   · 파생 뷰는 저장하지 않는다. 매번 원장에서 계산한다 (§4)
 *   · 물리 삭제는 없다. 수정은 -R1, 취소는 -C (원칙 9 · §7.1)
 *   · 승인 없이는 지표가 아니다 (원칙 7) · 모르면 계산불가 (원칙 8)
 */
import {
  ACCOUNTS,
  SEED_DAY_SNAPSHOTS,
  SEED_ENTRIES,
  SEED_SETTINGS,
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
  flattenDailyCashSheet,
  maskSensitive,
  permissionFor,
  segmentPnl,
  trialBalance,
  ROLES,
  anchorToday,
  blockerSummary,
  buildRoleQueues,
  classifyNote,
  readFileName,
  matchEntries,
  parseContractRequest,
  parseDecisionThread,
  classifyWaiting,
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
  evidenceKindSpec,
  evidenceRisk,
  type EvidenceStorage,
  AGENTS,
  BLOCKERS,
  GATES,
  LEVEL_POLICY,
  PERMANENTLY_FORBIDDEN,
  activeBlockers,
  buildDecisionQueue,
  buildJournals,
  readyToStart,
  type ScoreInput,
  type ThresholdState,
  INSURANCE_PAYABLE_ACCOUNT,
  VAT_INPUT_ACCOUNT,
  VAT_OUTPUT_ACCOUNT,
  WITHHOLDING_PAYABLE_ACCOUNT,
  checkBalanceChain,
  parseBankStatement,
  reconcile,
  settleVat,
  vatPeriodOf,
  vatPeriods,
  invoiceObligations,
  taxCalendar,
  productivity,
  projectMargins,
  revenueConcentration,
  runwayDaysCost,
  accountLedger,
  cancelReasonLabel,
  type CancelReasonCode,
  DEFAULT_AGING_BUCKETS,
  agingBucketLabel,
  creditSummary,
  deferralSchedule,
  fsMapping,
  journalChains,
  nextJournalNumber,
  paymentOrder,
  toKrw,
  canExport,
  daysBetween,
  findAccount,
  fsLineOf,
} from "../../shared/erp/index.js";
import type {
  WaitingItem,
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
  Setting,
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
import { readSlackFiles } from "../integrations/documentReader.js";
import type { SlackFileMeta } from "../integrations/slackFiles.js";
import {
  isWatchedChannel,
  postSlackMessage,
  slackConfigured,
} from "../integrations/slack.js";
import {
  fetchHistoryPage,
  fetchThreadReplies,
  isCollectableMessage,
  listBotChannels,
  slackErrorMessage,
} from "../integrations/slackHistory.js";
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
  /**
   * 방금 비밀번호를 다시 넣었는가 (docs/erp-qa.md D7).
   * 급여 원장·세무 제출 파일은 세션 12시간이 아니라 이 값으로 열린다.
   * 테스트·내부 호출에서 값이 없으면 재인증한 적 없는 것으로 본다.
   */
  stepUpFresh?: boolean;
  /**
   * 이 사람의 사업부 — 사업부리더의 조회 범위(§13.1 scope: own_bu)에 쓴다.
   *
   * **아직 세션이 이 값을 채우지 않는다.** 역할 배정(ERP_ROLE_MAP)에 사업부가
   * 없기 때문이다. 값이 없으면 범위를 좁히지 않는다 — 좁히는 척하다가 엉뚱한
   * 것을 감추는 것보다, 안 좁히고 그렇다고 말하는 편이 낫다.
   */
  buCode?: string | null;
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
    /*
     * 일별 보기는 **오늘을 맨 위에** 둔다. 시트에 앞으로 나갈 돈이 미리 적혀
     * 있어서, 그냥 최신순으로 두면 맨 위가 제일 먼 예정일이 된다. 그 숫자를
     * 오늘 잔액으로 읽게 되는 것이 문제다.
     */
    const descending =
      unit === "day"
        ? anchorToday(blocks, await this.today())
        : [...blocks].reverse();
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

  /**
   * GET /approvals/queues — **역할별 대기함** (§13.1 · 원칙 13).
   *
   * 「지금 이 건은 누가 움직여야 하는가」를 역할별로 나눠 준다. 대표는 결재할
   * 것만, 재무는 채워 넣을 것만, 리더는 자기 사업부 것만 본다.
   *
   * 판정은 `approve()` 와 **같은 순서**로 한다 (금액 → 계정과목 → 증빙 →
   * 자기승인 → 한도). 순서가 달라지면 화면은 「결재 대기」라고 하는데 눌러
   * 보면 「증빙이 없습니다」가 뜬다.
   */
  async approvalQueues(actor: Actor) {
    const entries = await this.store.listEntries();
    const waiting = entries.filter(
      e => e.status === "pending" || e.status === "undecided"
    );

    const items: WaitingItem[] = [];
    for (const entry of waiting) {
      // 한도 판정은 쪼개기를 감안한 주간 합계로 한다 (D2)
      const weekTotal =
        entry.amount == null ? null : await this.partyWeekTotal(entry);
      const touched = await this.touchedBy(entry);
      const item = classifyWaiting(entry, {
        weekTotal,
        touchedByViewer: touched.has(actor.id),
      });
      if (item) items.push(item);
    }

    /*
     * 사업부리더는 **자기 사업부 것만** 본다 (§13.1 scope: own_bu).
     * 대기함은 「내가 할 일」이라 범위가 어긋나면 남의 일이 섞인다.
     */
    const scoped = (role: Role) =>
      role === "사업부리더" && actor.buCode
        ? items.filter(item => item.buCode === actor.buCode)
        : items;

    const queues = ROLES.filter(role => permissionFor(role, "entry").read).map(
      role => buildRoleQueues(scoped(role), [role])[0]
    );

    return {
      /** 보는 사람의 대기함 — 화면을 열면 이것이 먼저다 */
      mine: queues.find(queue => queue.role === actor.role) ?? null,
      queues,
      summary: blockerSummary(items),
      total: items.length,
    };
  }

  /**
   * GET /intake/cross-reference — 참조 기록을 원장과 **대조**한다.
   *
   * 지출결의서·계약서 서명요청은 금액이 없어 원장 건이 될 수 없다. 대신 원장에
   * 이미 있는 건과 짝을 지어 「반영됐다 / 아직 없다」를 말해 준다.
   *
   * **자동으로 잇지 않는다.** 잘못 이으면 같은 지출이 두 번 잡히거나, 결재가
   * 끝난 것처럼 보이는데 실제로는 다른 건이 결재된 상태가 된다. 후보를 점수와
   * 근거와 함께 나란히 보여 주고, 잇는 것은 사람이 한다 (원칙 7).
   */
  async crossReference(actor: Actor) {
    const [intakes, entries] = await Promise.all([
      this.store.listIntakes(),
      this.store.listEntries(),
    ]);
    const notes = intakes.filter(item => item.status === "note");

    const rows = notes.map(note => {
      const parsed = (note.parsed ?? {}) as { kind?: string };
      const raw = note.raw ?? "";
      const kind = parsed.kind ?? classifyNote(raw) ?? "참조";
      const date = note.receivedAt?.slice(0, 10) ?? null;

      // 결의서는 스레드 본문이 곧 항목 목록이다. 한 줄이 한 건이다
      const names =
        kind === "지출결의서"
          ? parseDecisionThread([{ text: raw, user: null }]).items
          : parseContractRequest(raw).names;

      const matches = names.map(name => ({
        name,
        ...matchEntries({ name, date }, entries),
      }));

      return {
        id: note.id,
        kind,
        channel: note.channel,
        receivedAt: note.receivedAt,
        // 원문에는 개인정보가 있을 수 있다 — 여기서 가린다 (마스킹은 응답 단계)
        raw: maskSensitive(raw).text,
        names,
        matches,
        /** 하나라도 확실히 맞는 것이 있으면 반영된 것으로 본다 */
        reflected:
          matches.length > 0 && matches.every(m => m.verdict === "확실"),
        note:
          names.length === 0
            ? "대조할 이름을 찾지 못했습니다 — 원문을 보고 사람이 판단해야 합니다"
            : matches.every(m => m.verdict === "확실")
              ? "원장에 전부 들어와 있습니다"
              : matches.some(m => m.verdict === "없음")
                ? "원장에 없는 항목이 있습니다"
                : "닮은 건이 있으나 같은 건인지 확인이 필요합니다",
      };
    });

    await this.audit(
      "intake",
      "cross-reference",
      "read",
      null,
      { notes: rows.length },
      actor
    );

    return {
      rows,
      summary: {
        total: rows.length,
        reflected: rows.filter(r => r.reflected).length,
        missing: rows.filter(r => r.matches.some(m => m.verdict === "없음"))
          .length,
      },
    };
  }

  /**
   * POST /intake/read-attachments — 아직 안 읽은 첨부를 **조금씩** 읽는다.
   *
   * 백필은 첨부 내용을 읽지 않는다. 메시지마다 파일을 내려받고 모델을 부르면
   * 한 번의 호출이 몇 분씩 걸려 서버리스 함수가 시간 초과로 죽기 때문이다.
   * 그래서 읽기는 이 경로로 뗐다 — 한 번에 몇 건씩, 예산 안에서.
   *
   * 읽은 내용은 원문 뒤에 이어 붙이고 **다시 파싱한다.** 계약서 PDF 안에
   * 금액이 있으면 그때 금액이 채워진다.
   */
  async readPendingAttachments(
    input: { limit?: number; budgetMs?: number } = {},
    actor: Actor,
    deps: { readFiles?: typeof readSlackFiles; now?: () => number } = {}
  ) {
    const readFiles = deps.readFiles ?? readSlackFiles;
    const now = deps.now ?? (() => Date.now());
    const startedAt = now();
    const budgetMs = Math.min(
      Math.max(input.budgetMs ?? 20_000, 1_000),
      60_000
    );
    const limit = Math.min(Math.max(input.limit ?? 3, 1), 20);

    const intakes = await this.store.listIntakes();
    const pending = intakes.filter(item => {
      const parsed = (item.parsed ?? {}) as {
        files?: { text?: string | null; meta?: unknown }[];
      };
      return (parsed.files ?? []).some(file => file.text == null && file.meta);
    });

    let read = 0;
    let failed = 0;
    const rows: { id: string; name: string; ok: boolean; note: string }[] = [];

    for (const intake of pending.slice(0, limit)) {
      if (now() - startedAt > budgetMs) break;
      const parsed = (intake.parsed ?? {}) as Record<string, unknown> & {
        files?: {
          name: string;
          text?: string | null;
          reason?: string | null;
          meta?: SlackFileMeta | null;
        }[];
      };
      const files = parsed.files ?? [];
      const metas = files
        .filter(file => file.text == null && file.meta)
        .map(file => file.meta as SlackFileMeta);
      if (metas.length === 0) continue;

      const results = await readFiles(metas, {
        token: process.env.SLACK_BOT_TOKEN,
      });

      let at = 0;
      const updated = files.map(file => {
        if (file.text != null || !file.meta) return file;
        const result = results[at++];
        if (!result) return file;
        if (result.text) read += 1;
        else failed += 1;
        rows.push({
          id: intake.id,
          name: file.name,
          ok: Boolean(result.text),
          note: result.text
            ? `${result.text.length}자 읽음`
            : (result.reason ?? "읽지 못함"),
        });
        return { ...file, text: result.text, reason: result.reason };
      });

      /*
       * 읽은 내용을 원문 뒤에 이어 붙이고 **다시 파싱한다.**
       * 「[첨부 …]」 블록을 통째로 갈아 끼워, 여러 번 눌러도 쌓이지 않게 한다.
       */
      const base = (intake.raw ?? "").split("\n\n[첨부 ")[0];
      const appended = updated
        .map(file =>
          file.text
            ? `\n\n[첨부 ${file.name}]\n${file.text}`
            : `\n\n[첨부 ${file.name} — 읽지 못함: ${file.reason ?? "이유 미상"}]`
        )
        .join("");
      const fullText = `${base}${appended}`;
      const today = await this.today();
      const rule = parseSlackExpense(fullText, Number(today.slice(0, 4)));

      await this.store.upsertIntake({
        ...intake,
        raw: fullText,
        parsed: {
          ...parsed,
          files: updated,
          // 첨부에서 값이 나왔으면 그것으로 갱신한다
          ...(rule.matchedFields > 0
            ? {
                by: "rule",
                ...rule.fields,
                warnings: rule.warnings,
                missing: rule.missingRequired,
              }
            : {}),
        },
      });
    }

    await this.audit(
      "intake",
      "read-attachments",
      "read",
      null,
      { read, failed },
      actor
    );

    return {
      read,
      failed,
      rows,
      remaining: Math.max(0, pending.length - limit),
      note:
        pending.length === 0
          ? "읽을 첨부가 없습니다"
          : read + failed === 0
            ? "시간 안에 한 건도 읽지 못했습니다 — 다시 누르십시오"
            : `${read}건 읽었습니다` +
              (failed > 0 ? ` · ${failed}건 실패` : "") +
              (pending.length > limit
                ? ` · ${pending.length - limit}건 남음`
                : ""),
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

  /**
   * POST /seed — §5.4 시드를 DB 에 적재한다 (대표만).
   *
   * 왜 화면에서 하나 — 원래는 터미널에서 `erp:seed` 를 돌리는 스크립트였다.
   * 그러려면 대표님이 연결 문자열을 로컬에 들고 와야 하는데, 비밀값을 사람
   * 손으로 옮기는 것이 이 시스템에서 가장 위험한 단계다. 배포된 서버가 자기
   * 환경변수로 적재하면 그 단계가 사라진다.
   *
   * **이미 있는 코드는 건드리지 않는다** (§5.6 재이관 금지). 그래서 여러 번
   * 눌러도 덮어쓰지 않고, 무엇을 건너뛰었는지 세어 돌려준다.
   */
  async seedDatabase(actor: Actor) {
    // 원장 전체를 만드는 작업이다 — 대표만
    if (actor.role !== "대표")
      throw erpError(
        "forbidden_field",
        {},
        "시드 적재는 대표만 할 수 있습니다"
      );

    const existingEntries = new Set(
      (await this.store.listEntries()).map(e => e.code)
    );
    const existingSnapshots = new Set(
      (await this.store.listSnapshots()).map(s => s.date)
    );
    const existingSettings = new Set(
      (await this.store.listSettings()).map(s => s.key)
    );
    /*
     * 계정과목은 존재 검사를 하지 않고 **항상** 넣는다. 두 가지 이유다.
     *
     * ① `listAccounts()` 는 테이블이 비어 있으면 코드의 §8.1 목록을 그대로
     *    돌려준다 (읽기에는 맞는 동작이다). 그것으로 존재 검사를 하면 「이미
     *    38개 다 있다」로 읽혀 **테이블이 영원히 비어 있게** 된다.
     * ② 계정과목의 주인은 코드다 (§8.1). 계정을 새로 만들거나 이름을 고치면
     *    적재를 다시 눌러 DB 를 따라오게 하는 것이 맞다.
     */
    let accounts = 0;
    for (const account of ACCOUNTS) {
      await this.store.upsertAccount(account);
      accounts += 1;
    }

    let snapshots = 0;
    for (const snapshot of SEED_DAY_SNAPSHOTS) {
      if (existingSnapshots.has(snapshot.date)) continue;
      await this.store.insertSnapshot(snapshot);
      snapshots += 1;
    }

    let entries = 0;
    let skipped = 0;
    for (const entry of SEED_ENTRIES) {
      if (existingEntries.has(entry.code)) {
        skipped += 1;
        continue;
      }
      await this.store.insertEntry(entry);
      entries += 1;
    }

    let settings = 0;
    for (const setting of SEED_SETTINGS) {
      if (existingSettings.has(setting.key)) continue;
      await this.store.putSetting(setting);
      settings += 1;
    }

    await this.audit(
      "entry",
      "seed",
      "upsert",
      null,
      { accounts, snapshots, entries, settings, skipped },
      actor,
      "§5.4 시드 적재"
    );

    // 적재 직후의 이관 검증 — 무엇이 안 맞는지 그 자리에서 보여 준다
    const report = await this.migrationReport();
    return {
      inserted: { accounts, snapshots, entries, settings },
      skipped,
      ...report,
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

  /** GET /ar — 미수 / 발행 대기 / DSO (§9.3) + 연령분석 (C7) */
  async ar() {
    const [entries, parties, contracts, today, settings] = await Promise.all([
      this.store.listEntries(),
      this.store.listParties(),
      this.store.listContracts(),
      this.today(),
      this.store.listSettings(),
    ]);
    const report = buildArReport(entries, parties, contracts, today);

    /*
     * 연령 구간은 업종마다 다르다 (docs/erp-qa.md C7). 30·60·90 을 코드에 박아
     * 두면 「우리는 15일이 이미 늦은 것」인 회사에서 아무 신호도 못 준다.
     * 기준값 ar_aging_buckets 로 덮을 수 있게 하고, 없으면 기본값을 쓴다.
     */
    const buckets = (
      settingValue<number[]>(settings, "ar_aging_buckets") ??
      Array.from(DEFAULT_AGING_BUCKETS)
    )
      .filter(n => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
    const useBuckets =
      buckets.length > 0 ? buckets : [...DEFAULT_AGING_BUCKETS];

    const aged = report.receivables.filter(
      l => l.entry.amount != null && l.agingDays != null
    );
    const grouped = new Map<string, { count: number; amount: number }>();
    for (const bucket of useBuckets)
      grouped.set(`${bucket}일 이내`, { count: 0, amount: 0 });
    grouped.set(`${useBuckets[useBuckets.length - 1]}일 초과`, {
      count: 0,
      amount: 0,
    });
    for (const line of aged) {
      const label = agingBucketLabel(line.agingDays ?? 0, useBuckets);
      const cell = grouped.get(label) ?? { count: 0, amount: 0 };
      cell.count += 1;
      cell.amount += line.entry.amount ?? 0;
      grouped.set(label, cell);
    }
    const agedTotal = aged.reduce((sum, l) => sum + (l.entry.amount ?? 0), 0);

    return {
      ...report,
      aging: {
        buckets: useBuckets,
        // 경과일을 모르는 건은 구간에 넣지 않는다 — 넣으면 어느 칸이든 거짓이 된다
        unknown: report.receivables.length - aged.length,
        total: agedTotal,
        rows: Array.from(grouped.entries()).map(([label, cell]) => ({
          label,
          count: cell.count,
          amount: cell.amount,
          share: agedTotal === 0 ? null : cell.amount / agedTotal,
        })),
      },
    };
  }

  /** GET /debt — 차입 원장 + D-day + 알람 상태 (§9.4) */
  /**
   * 민감 자료 조회를 기록한다 (docs/erp-qa.md D3).
   * 급여만 기록하고 있었다 — 부채·계약도 밖으로 새면 같은 문제다.
   */
  private async recordSensitiveAccess(
    table: string,
    actor: Actor,
    detail: Record<string, unknown> = {}
  ): Promise<void> {
    const watched = settingValue<string[]>(
      await this.store.listSettings(),
      "sensitive_tables"
    ) ?? ["payroll", "debt", "contract"];
    if (!watched.includes(table)) return;
    await this.audit(table, "-", "read", null, detail, actor);
  }

  async debt(actor?: Actor) {
    const [debts, settings, today] = await Promise.all([
      this.store.listDebts(),
      this.store.listSettings(),
      this.today(),
    ]);
    // 부채 열람도 기록한다 — 급여만 기록하던 것을 넓혔다 (D3)
    if (actor) await this.recordSensitiveAccess("debt", actor);
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
    const withCode = journals.map(j => ({
      ...j,
      entryCode: byId.get(j.entryId)?.code ?? j.entryId,
    }));
    return {
      journals: withCode,
      trialBalance: trialBalance(journals),
      // 수정된 건의 원본 · 역분개 · 재분개 대응 (A16)
      chains: journalChains(withCode),
    };
  }

  /** 마스터 — 거래처 · 프로젝트 · 계약 · 차입 · 검수함 */
  /**
   * 마스터 조회.
   *
   * 검수함 원문(raw)에는 주민등록번호와 계좌번호가 들어 있다 — 각각 원천징수
   * 지급명세서와 실제 송금에 쓰는 값이라 지우지 않는다.
   * 다만 **여기(API 응답 단계)에서** 가린다. 프론트에서만 가리면 네트워크
   * 탭에 그대로 보이므로 가린 것이 아니다. 원본은 revealIntakeRaw() 로만,
   * 재인증을 거쳐서 열린다.
   */
  async masters(actor?: Actor) {
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
    const safeIntakes = intakes.map(intake => {
      const masked = intake.raw
        ? maskSensitive(intake.raw)
        : { text: null, found: 0, kinds: [] as string[] };
      return {
        ...intake,
        raw: masked.text,
        // 화면이 「원본 보기」 버튼을 띄울지 정하는 값. 값 자체는 안 나간다
        hasSensitive: masked.found > 0,
        sensitiveKinds: masked.kinds,
        canReveal: actor ? permissionFor(actor.role, "payroll").read : false,
      };
    });
    return {
      parties,
      projects,
      contracts,
      debts,
      schedules,
      intakes: safeIntakes,
      periods,
    };
  }

  /**
   * 검수함 원문 원본 — 주민번호·계좌번호가 보이는 유일한 자리 (§13 · D7).
   *
   * 원천징수 신고와 지급을 실제로 하는 역할(대표·재무)만, **비밀번호를 다시
   * 확인한 뒤에만** 열린다. 누가 언제 어느 건을 열었는지 감사로그에 남는다 —
   * 민감정보는 「볼 수 있다」보다 「본 것이 남는다」가 더 중요하다.
   */
  async revealIntakeRaw(intakeId: string, actor: Actor) {
    if (!permissionFor(actor.role, "payroll").read)
      throw erpError(
        "forbidden_field",
        {},
        "주민등록번호·계좌번호는 원천징수와 지급을 처리하는 역할만 열 수 있습니다"
      );
    if (!actor.stepUpFresh) throw erpError("reauth_required");

    const intakes = await this.store.listIntakes();
    const intake = intakes.find(item => item.id === intakeId);
    if (!intake) throw erpError("not_found", { intakeId });

    await this.audit(
      "intake",
      intakeId,
      "reveal_sensitive",
      null,
      { channel: intake.channel, sourceRef: intake.sourceRef },
      actor
    );
    return { id: intake.id, raw: intake.raw };
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
        taxPayable: await this.taxPayableBalance(),
      }),
      opex: opexBreakdown(entries),
    };
  }

  /**
   * 예수금 + 미지급세금 잔액 — 전표에서 계산한다.
   *
   * 부가세는 예수(매출세액) − 대급(매입세액) 차액만 납부하므로 상계한다.
   * 원천세·4대보험은 상계 대상이 없어 잔액 그대로가 납부액이다.
   */
  private async taxPayableBalance(): Promise<number | null> {
    const journals = await this.store.listJournals();
    if (journals.length === 0) return null;

    const balance = (code: string) =>
      journals
        .flatMap(j => j.lines)
        .filter(l => l.accountCode === code)
        .reduce((sum, l) => sum + l.credit - l.debit, 0);

    // 부채 계정이므로 대변 잔액이 「내야 할 돈」이다
    const vatNet = balance(VAT_OUTPUT_ACCOUNT) - balance(VAT_INPUT_ACCOUNT);
    const withheld =
      balance(WITHHOLDING_PAYABLE_ACCOUNT) + balance(INSURANCE_PAYABLE_ACCOUNT);

    // 환급 상황(음수)은 0 으로 본다 — 받을 돈을 런웨이에 더해 주면 낙관 편향이 생긴다
    return Math.max(0, vatNet) + Math.max(0, withheld);
  }

  /**
   * GET /tax-package — 세무대리인 제출용 (docs/erp-qa.md E11)
   *
   * 지금 내보내기는 탭 구분 텍스트 중심이다. 세무대리인이 원하는 것은
   * 「계정별 집계 + 증빙 목록」이라는 고정 양식이고, 매달 같은 모양이어야 한다.
   *
   * 외부열람 역할은 내보내지 못한다 — 화면에서 보는 것과 파일로 들고 나가는 것은
   * 다른 위험이다.
   */
  async taxPackage(input: { ym: string }, actor: Actor) {
    if (!canExport(actor.role)) throw erpError("export_forbidden");
    // 파일로 들고 나가는 것은 재인증 뒤에만 (D7)
    if (!actor.stepUpFresh) throw erpError("reauth_required");

    const [entries, journals, attachments] = await Promise.all([
      this.store.listEntries(),
      this.store.listJournals(),
      this.store.listAttachments(),
    ]);

    const inMonth = (date: string | null) => (date ?? "").startsWith(input.ym);
    const monthEntries = entries.filter(
      e =>
        e.status === "confirmed" &&
        (inMonth(e.accrualDate) || inMonth(e.cashDate))
    );

    // 계정별 집계 — 세무대리인 장부와 맞추는 단위
    const byAccount = new Map<string, { debit: number; credit: number }>();
    for (const journal of journals.filter(j => inMonth(j.journalDate)))
      for (const line of journal.lines) {
        const acc = byAccount.get(line.accountCode) ?? { debit: 0, credit: 0 };
        acc.debit += line.debit;
        acc.credit += line.credit;
        byAccount.set(line.accountCode, acc);
      }

    const attachmentsByEntry = new Map<string, typeof attachments>();
    for (const a of attachments) {
      const list = attachmentsByEntry.get(a.entryId);
      if (list) list.push(a);
      else attachmentsByEntry.set(a.entryId, [a]);
    }

    await this.audit(
      "export",
      `tax-package:${input.ym}`,
      "read",
      null,
      { ym: input.ym, entries: monthEntries.length },
      actor
    );

    return {
      ym: input.ym,
      accountSummary: Array.from(byAccount.entries())
        .map(([code, v]) => ({
          code,
          name: findAccount(code)?.name ?? code,
          fsLine: fsLineOf(code),
          debit: v.debit,
          credit: v.credit,
          net: v.debit - v.credit,
        }))
        .sort((a, b) => a.code.localeCompare(b.code)),
      evidence: monthEntries.map(e => {
        const own = attachmentsByEntry.get(e.id) ?? [];
        return {
          code: e.code,
          date: e.accrualDate ?? e.cashDate,
          title: e.title,
          accountCode: e.accountCode,
          amount: e.amount,
          // 적격증빙이 있는지가 세무대리인이 가장 먼저 보는 것이다
          kinds: own.map(a => a.kind),
          qualified: own.some(
            a => a.storage !== "none" && evidenceKindSpec(a.kind)?.qualified
          ),
          missing: own.length === 0,
        };
      }),
      counts: {
        entries: monthEntries.length,
        missingEvidence: monthEntries.filter(
          e => (attachmentsByEntry.get(e.id) ?? []).length === 0
        ).length,
      },
    };
  }

  /**
   * GET /account-ledger — 계정별 원장 (A13)
   *
   * 계정과목 체계는 있었지만 「그 계정에 무엇이 들어왔나」를 볼 방법이 없었다.
   * 잔액이 이상할 때 이 화면 없이는 원인을 찾을 수 없다.
   */
  async accountLedger(
    input: { accountCode: string; from?: string | null; to?: string | null },
    actor: Actor
  ) {
    const journals = await this.store.listJournals();
    // 급여 계정 열람은 기록한다 — 금액이 개인별로 읽힐 수 있다
    if (input.accountCode.startsWith("61")) {
      /*
       * 재인증을 요구한다 (docs/erp-qa.md D7). 세션 12시간은 「오늘 하루
       * 일한다」에 맞춘 값이고, 급여 원장은 그보다 짧아야 한다 — 자리를 비운
       * 노트북에서 열리면 안 된다.
       */
      if (!actor.stepUpFresh) throw erpError("reauth_required");
      await this.audit(
        "journal",
        input.accountCode,
        "read",
        null,
        { accountCode: input.accountCode },
        actor
      );
    }
    return accountLedger(input.accountCode, journals, {
      from: input.from,
      to: input.to,
    });
  }

  /**
   * GET /credit — 여신 한도 (C4)
   *
   * 마이너스통장·카드 한도는 실질 유동성인데 현금 현황에 안 보였다.
   * 「즉시 동원 가능액」을 알아야 부족액의 의미가 달라진다.
   */
  async credit() {
    const settings = await this.store.listSettings();
    const lines =
      settingValue<
        {
          id: string;
          name: string;
          kind: "마이너스통장" | "법인카드" | "기타";
          limit: number;
          used: number;
        }[]
      >(settings, "credit_lines") ?? [];
    const summary = creditSummary(lines);
    const cashOnHand = settingValue<number>(settings, "cash_on_hand");
    return {
      ...summary,
      cashOnHand,
      // 한도는 빌리는 돈이다 — 현금과 합쳐 하나로 보여 주면 착각한다
      immediatelyAvailable:
        cashOnHand == null ? null : cashOnHand + summary.totalAvailable,
      note: "한도는 빌리는 돈입니다. 현금과 성격이 달라 따로 표시합니다.",
    };
  }

  /**
   * GET /deferrals — 선급비용 · 선수수익 이연 (docs/erp-qa.md A7)
   *
   * 연간 SaaS·보험료를 결제월에 전액 잡으면 그 달만 손익이 튀고 나머지
   * 11개월은 실제보다 좋아 보인다. 손익은 이 배분표대로 나뉘고, 현금흐름은
   * 나누지 않는다 — 돈은 한 번에 나갔다.
   */
  async deferrals() {
    const [entries, today] = await Promise.all([
      this.store.listEntries(),
      this.today(),
    ]);
    const thisMonth = today.slice(0, 7);
    const deferred = entries.filter(
      e =>
        (e.deferralMonths ?? 0) > 1 &&
        e.amount != null &&
        e.status === "confirmed"
    );

    const rows = deferred.map(entry => {
      const start = (entry.accrualDate ?? entry.cashDate ?? "").slice(0, 7);
      const schedule = deferralSchedule(
        entry.amount ?? 0,
        start,
        entry.deferralMonths ?? 0
      );
      const current = schedule.find(row => row.month === thisMonth) ?? null;
      const remaining = schedule
        .filter(row => row.month > thisMonth)
        .reduce((sum, row) => sum + row.amount, 0);
      return {
        code: entry.code,
        title: entry.title,
        accountCode: entry.accountCode,
        direction: entry.direction,
        total: entry.amount,
        months: entry.deferralMonths ?? 0,
        startMonth: start,
        endMonth: schedule[schedule.length - 1]?.month ?? start,
        thisMonth: current?.amount ?? null,
        remaining,
        schedule,
      };
    });

    return {
      thisMonth,
      rows,
      // 이번 달 손익에 실제로 얹히는 금액
      thisMonthTotal: rows.reduce((sum, r) => sum + (r.thisMonth ?? 0), 0),
      // 아직 손익에 안 들어간 몫 — 선급비용·선수수익 잔액이다
      remainingTotal: rows.reduce((sum, r) => sum + r.remaining, 0),
    };
  }

  /**
   * GET /bank-accounts — 계좌별 잔액 (docs/erp-qa.md C5)
   *
   * `1110 보통예금` 하나로 합쳐져 있었다. 실제로는 계좌가 여러 개이고,
   * 대사(reconciliation)는 계좌 단위로만 성립한다 — 합계가 맞아도 계좌별로
   * 어긋나 있으면 어느 쪽이 틀렸는지 알 수 없다.
   *
   * 잔액은 은행이 가진 숫자다. 원장에서 만들어 내지 않고, 사람이 넣은 잔액과
   * 원장 증감을 **나란히** 보여 준다. 차이가 있으면 그것이 대사 대상이다.
   */
  async bankAccounts() {
    const [entries, settings] = await Promise.all([
      this.store.listEntries(),
      this.store.listSettings(),
    ]);
    const declared =
      settingValue<
        { code: string; name: string; bank: string; balance: number | null }[]
      >(settings, "bank_accounts") ?? [];

    const movementOf = (code: string | null) =>
      entries
        .filter(
          e =>
            e.status === "confirmed" &&
            e.amount != null &&
            (e.bankAccount ?? null) === code
        )
        .reduce(
          (sum, e) => sum + (e.direction === "in" ? e.amount! : -e.amount!),
          0
        );

    const rows = declared.map(account => ({
      ...account,
      ledgerMovement: movementOf(account.code),
      entries: entries.filter(e => e.bankAccount === account.code).length,
    }));

    // 계좌가 안 붙은 확정 건 — 대사가 불가능한 부분이다
    const unassignedEntries = entries.filter(
      e => e.status === "confirmed" && e.amount != null && !e.bankAccount
    );

    const declaredTotal = rows.every(r => r.balance == null)
      ? null
      : rows.reduce((sum, r) => sum + (r.balance ?? 0), 0);

    return {
      rows,
      declaredTotal,
      cashOnHand: settingValue<number>(settings, "cash_on_hand"),
      unassigned: {
        n: unassignedEntries.length,
        amount: unassignedEntries.reduce(
          (sum, e) => sum + (e.direction === "in" ? e.amount! : -e.amount!),
          0
        ),
      },
      note: "잔액은 은행이 가진 숫자입니다. 원장 증감과 나란히 두어, 차이가 있으면 그것을 대사 대상으로 봅니다.",
    };
  }

  /** GET /fs-mapping — 계정 → 재무제표 줄 매핑 (A10) */
  async fsMapping() {
    return { rows: fsMapping() };
  }

  /**
   * GET /payment-order — 같은 등급 안에서의 지급 순서 (C8)
   *
   * 연체가 먼저다 — 이자·신뢰 비용이 붙는다. 금액을 마지막에 두는 이유는
   * 큰 건을 먼저 내면 작은 건 여러 개가 동시에 연체되기 때문이다.
   */
  async paymentOrder(actor: Actor) {
    const [entries, parties] = await Promise.all([
      this.store.listEntries(),
      this.store.listParties(),
    ]);
    const partyName = new Map(parties.map(p => [p.id, p.name]));
    const today = kstToday();
    const open = entries.filter(
      e =>
        e.direction === "out" &&
        (e.status === "pending" || e.status === "confirmed") &&
        e.paidAt == null &&
        e.amount != null
    );
    const byPriority = new Map<string, Entry[]>();
    for (const entry of open) {
      const key = resolvePriority(entry) ?? "미지정";
      const list = byPriority.get(key);
      if (list) list.push(entry);
      else byPriority.set(key, [entry]);
    }
    return {
      today,
      groups: Array.from(byPriority.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([priority, list]) => ({
          priority,
          total: list.reduce((s, e) => s + (e.amount ?? 0), 0),
          entries: paymentOrder(list, today).map(e => {
            const due = e.dueDate ?? e.cashDate;
            return {
              entry: maskEntryForRole(e, actor.role),
              partyName: e.partyId
                ? (partyName.get(e.partyId) ?? "거래처 미등록")
                : null,
              due,
              // 음수는 연체 일수다 — 화면에서 부호로 갈라 쓴다
              daysToDue: due == null ? null : daysBetween(today, due),
            };
          }),
        })),
    };
  }

  /**
   * GET /insights — 경영 판단 지표 (E4 · E5 · E7)
   *
   * 회계 숫자가 아니라 판단에 쓰는 숫자다. 회계 계단과 섞지 않는다.
   */
  async insights() {
    const [entries, parties, projects, settings, runway, pnl] =
      await Promise.all([
        this.store.listEntries(),
        this.store.listParties(),
        this.store.listProjects(),
        this.store.listSettings(),
        this.runway(),
        this.pnl({}),
      ]);

    const names = new Map(parties.map(p => [p.id, p.name]));
    const estimates = new Map<string, number>(
      Object.entries(
        settingValue<Record<string, number>>(
          settings,
          "project_remaining_estimates"
        ) ?? {}
      )
    );

    return {
      concentration: revenueConcentration(entries, names),
      projects: projectMargins(projects, entries, estimates),
      productivity: productivity({
        headcount: settingValue<number>(settings, "headcount"),
        monthlyRevenue: pnl.total.accounting.revenue,
        monthlyProfit: pnl.total.accounting.operatingProfit,
      }),
      monthlyBurn: runway.burnRate.value,
    };
  }

  /**
   * GET /tax — 세금계산서 발행 의무 + 신고 캘린더 (B4 · B5 · B10)
   *
   * 놓치면 가산세가 붙는 것만 모은다. 「알아두면 좋은 것」은 넣지 않는다 —
   * 캘린더가 길어지면 아무도 안 본다.
   */
  async tax(actor: Actor) {
    const [entries, journals, vat] = await Promise.all([
      this.store.listEntries(),
      this.store.listJournals(),
      this.vat(),
    ]);

    const today = kstToday();
    const obligations = invoiceObligations(entries, today);

    // 예수금 잔액 — 부채 계정이므로 대변 잔액이 낼 돈이다
    const withholdingPayable = journals
      .flatMap(j => j.lines)
      .filter(
        l =>
          l.accountCode === WITHHOLDING_PAYABLE_ACCOUNT ||
          l.accountCode === INSURANCE_PAYABLE_ACCOUNT
      )
      .reduce((sum, l) => sum + l.credit - l.debit, 0);

    // 마지막 급여 지급일 — 원천세 기한의 기준
    const lastPayroll =
      entries
        .filter(e => e.accountCode === "6110" && e.cashDate != null)
        .map(e => e.cashDate!)
        .sort()
        .pop() ?? null;

    const current = vat.settlements.find(
      s => s.period.label === vat.currentPeriod?.label
    );

    return {
      today,
      obligations,
      counts: {
        overdue: obligations.filter(o => o.status === "기한초과").length,
        soon: obligations.filter(o => o.status === "기한임박").length,
        pending: obligations.filter(o => o.status === "발행대기").length,
        issued: obligations.filter(o => o.status === "발행완료").length,
      },
      calendar: taxCalendar(
        {
          withholdingPayable: Math.max(0, withholdingPayable) || null,
          vatPayable: current && !current.isRefund ? current.payable : null,
          lastPayrollDate: lastPayroll,
        },
        today
      ),
      vat: current ?? null,
      role: actor.role,
    };
  }

  /**
   * GET /vat — 과세기간별 부가세 정산 (docs/erp-qa.md A15 · B7)
   *
   * 마감은 월 단위인데 신고는 분기 단위다. 그 축이 달라서 월 마감만으로는
   * 「이번 분기에 얼마 내야 하나」를 답할 수 없었다.
   */
  async vat(options: { year?: number | null } = {}) {
    const journals = await this.store.listJournals();
    const lines = journals.flatMap(j =>
      j.lines.map(l => ({
        accountCode: l.accountCode,
        debit: l.debit,
        credit: l.credit,
        journalDate: j.journalDate,
      }))
    );
    const year = options.year ?? Number(kstToday().slice(0, 4));
    const periods = vatPeriods(year);
    const current = vatPeriodOf(kstToday());
    return {
      year,
      currentPeriod: current,
      settlements: periods.map(p => settleVat(p, lines)),
    };
  }

  /**
   * POST /reconcile/preview — 은행 거래내역과 원장을 맞춰 본다.
   *
   * 저장하지 않는다. 「안 맞는 것」만 보여 주는 것이 목적이고,
   * 무엇을 고칠지는 사람이 정한다 (원칙 7 — 시스템이 가져온 것도 사람이 승인한다).
   */
  async reconcilePreview(
    input: { text: string; account?: string | null },
    actor: Actor
  ) {
    const parsed = parseBankStatement(
      input.text,
      Number(kstToday().slice(0, 4))
    );
    const chain = checkBalanceChain(parsed.txns);
    const entries = await this.store.listEntries();
    const result = reconcile(parsed.txns, entries, {
      accountFilter: input.account ?? null,
    });

    return {
      parsed: { count: parsed.txns.length, skipped: parsed.skipped },
      // 잔액 체인이 끊겼으면 대사 결과를 믿기 전에 그것부터 봐야 한다
      chain,
      matched: result.matched.map(m => ({
        kind: m.kind,
        dayGap: m.dayGap,
        txn: m.txn,
        entry: m.entry ? maskEntryForRole(m.entry, actor.role) : null,
      })),
      bankOnly: result.bankOnly,
      ledgerOnly: result.ledgerOnly.map(e => maskEntryForRole(e, actor.role)),
      difference: result.difference,
    };
  }

  /**
   * GET /brief — 경영자 3줄 브리프 (E1 CFO · E2 런웨이)
   *
   * 대표가 화면에 들어와서 표를 읽어야 판단이 나오면 늦다.
   * 「지금 얼마가 모자라나 · 오늘 무엇을 결정해야 하나 · 얼마나 버티나」 세 가지를
   * 한 줄씩 먼저 답한다. 계산은 각 화면과 같은 함수를 쓴다 — 숫자가 갈리면 안 된다.
   */
  async brief(actor: Actor) {
    const [position, decisions, runway] = await Promise.all([
      this.cashPosition({}, actor),
      this.decisions(actor),
      this.runway(),
    ]);

    const ownerItems = decisions.owner;
    // 되돌릴 수 없는 것이 몇 건인지가 「오늘」의 무게를 정한다
    const irreversible = ownerItems.filter(i => i.score.reversibility === 3);

    return {
      today: decisions.today,
      /** ① 지금 얼마가 모자라나 */
      shortfall: {
        // P0 부족액이 「지금 당장」의 숫자다 — 미룰 수 없는 것만 낸 뒤 남는 돈
        tiers: position.tiers,
        p0: position.tiers.find(t => t.level === 0) ?? null,
        cashOnHand: position.cashOnHand,
        horizon: position.horizon,
        isProvisional: position.cashOnHandIsProvisional,
        excludedUndecided: position.excludedUndecided.n,
      },
      /** ② 오늘 무엇을 결정해야 하나 */
      decisions: {
        owner: ownerItems.length,
        irreversible: irreversible.length,
        top: ownerItems[0] ?? null,
        leader: decisions.counts.leader,
      },
      /** ③ 얼마나 버티나 — 라벨 없이 「런웨이」라고 쓰지 않는다 (원칙 3) */
      runway: {
        simple: runway.simple,
        reserved: runway.reserved,
        expectedWeeks: runway.expected.value,
        monthlyBurn: runway.burnRate.value,
        deductions: runway.reservedDeductions,
        threshold: decisions.threshold,
      },
    };
  }

  /**
   * GET /decisions — 오늘의 3가지 · 결정 큐 (E3 비서실장)
   *
   * 4축 점수를 서버에서 한 번 계산한다. 화면이 각자 계산하면 순위가 갈리고,
   * 「같은 입력이면 같은 순위」라는 약속이 깨진다.
   */
  async decisions(actor: Actor) {
    const [entries, settings, runway] = await Promise.all([
      this.store.listEntries(),
      this.store.listSettings(),
      this.runway(),
    ]);

    const monthlyBurn = runway.burnRate.value;
    // 예상런웨이는 주 단위 지표로 나온다 (§9.6)
    const expectedWeeks = runway.expected.value;

    // 임계선은 회사 상태이므로 모든 안건에 같은 점수가 붙는다.
    // 예상런웨이 4주 미만이 심각선, 8주 미만이 경보선이다 (조달은 8주가 협상 가능한 최소).
    const threshold: ThresholdState =
      expectedWeeks == null
        ? "approaching"
        : expectedWeeks < 4
          ? "critical"
          : expectedWeeks < 8
            ? "warning"
            : "clear";

    const today = kstToday();
    const openStatuses: Entry["status"][] = ["pending", "held", "undecided"];
    const candidates: ScoreInput[] = entries
      .filter(e => openStatuses.includes(e.status))
      .map(e => ({
        code: e.code,
        title: e.title || e.noteRaw || e.code,
        status: e.status,
        priority: resolvePriority(e),
        payMethod: e.payMethod,
        amount: e.amount,
        due: e.dueDate ?? e.cashDate,
      }));

    const queue = buildDecisionQueue(candidates, {
      today,
      monthlyBurn,
      threshold,
    }).map(item => ({
      ...item,
      // 건별 런웨이 비용 — 승인 화면에서 이걸 보고 결정한다
      runwayDays: runwayDaysCost(
        candidates.find(c => c.code === item.code)?.amount ?? null,
        monthlyBurn
      ),
    }));

    return {
      today,
      threshold,
      monthlyBurn,
      expectedRunwayWeeks: expectedWeeks,
      /**
       * 이 안건들을 다 승인하면 런웨이가 며칠 줄어드는가 (E3).
       * 금액이 큰지 작은지는 사람마다 다르지만 「6일」은 누구에게나 같다.
       */
      runwayDaysIfApproved: runwayDaysCost(
        candidates.reduce((sum, c) => sum + (c.amount ?? 0), 0),
        monthlyBurn
      ),
      // 대표에게 올라가는 것과 걸러진 것을 나눠서 준다
      // ownerTop 은 DecisionItem[] 으로 좁혀 runwayDays 를 잃으므로 여기서 직접 걸러낸다
      owner: queue.filter(q => q.routing === "대표"),
      queue,
      counts: {
        owner: queue.filter(q => q.routing === "대표").length,
        leader: queue.filter(q => q.routing === "리더").length,
        held: queue.filter(q => q.routing === "보류함").length,
      },
      // 급여가 섞여 있으면 역할에 따라 금액이 가려진다
      role: actor.role,
    };
  }

  /**
   * GET /agents — 에이전트 13종 현황
   *
   * 정확도·처리량은 내보내지 않는다. 측정된 적이 없으므로 목표치를 실측처럼
   * 보여 주면 돌고 있다고 착각하게 된다.
   */
  async agents() {
    const env = {
      SLACK_NOTIFY_CHANNEL: Boolean(process.env.SLACK_NOTIFY_CHANNEL),
      DATABASE_URL: Boolean(process.env.DATABASE_URL),
      ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
    };
    return {
      agents: AGENTS,
      levelPolicy: LEVEL_POLICY,
      forbidden: PERMANENTLY_FORBIDDEN,
      gates: GATES,
      blockers: activeBlockers(env),
      allBlockers: BLOCKERS,
      readyToStart: readyToStart(),
      env,
      counts: {
        designed: AGENTS.length,
        implemented: AGENTS.filter(a => a.implemented).length,
        ready: readyToStart().length,
      },
    };
  }

  /** GET /pnl — 회계 계단 + 관리 계단 동시 반환 (§9.7) */
  async pnl(options: {
    from?: string | null;
    to?: string | null;
    bu?: string | null;
    project?: string | null;
  }) {
    const [entries, settings] = await Promise.all([
      this.store.listEntries(),
      this.store.listSettings(),
    ]);

    /*
     * 이 숫자를 얼마나 믿을 수 있는지 (docs/erp-qa.md E12) 와 공통비를 무슨
     * 기준으로 나눴는지 (E8) 를 숫자와 같은 응답에 담는다. 다른 화면에 있으면
     * 사람이 숫자만 보고 판단한다.
     */
    const inPeriod = (e: Entry) => {
      const date = e.accrualDate ?? e.cashDate;
      if (options.from && (!date || date < options.from)) return false;
      if (options.to && (!date || date > options.to)) return false;
      return true;
    };
    const scoped = entries.filter(inPeriod);

    return {
      confidence: {
        confirmed: scoped.filter(e => e.status === "confirmed").length,
        estimated: scoped.filter(e => e.status === "pending").length,
        undecided: scoped.filter(e => e.status === "undecided").length,
      },
      // 배부 기준은 사람이 정한다 — 시스템이 고르면 근거가 없다
      allocationBasis:
        settingValue<string>(settings, "allocation_basis") ?? null,
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
    const [entries, snapshots, settings] = await Promise.all([
      this.store.listEntries(),
      this.store.listSnapshots(),
      this.store.listSettings(),
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

    /*
     * 다음 달 기초잔액을 여기서 만든다 (docs/erp-qa.md A12).
     *
     * 지금까지 시작 잔액은 사람이 cash_on_hand 에 넣던 숫자였다. 매달 손으로
     * 넣으면 ① 넣는 것을 잊고 ② 원장과 어긋나도 아무도 모른다. 마감이
     * 끝난 달의 현금 증감은 더 바뀌지 않으므로, 그 시점에 계산해 두는 것이
     * 유일하게 안전한 자동화다.
     *
     * 수동 입력은 이관 첫 달에만 남는다 — 그 달의 기초는 원장 밖에 있다.
     */
    const opening = this.openingCashFor(ym, settings);
    const nextYm = this.nextMonth(ym);
    const movement = entries
      .filter(
        e => e.status === "confirmed" && (e.cashDate ?? "").startsWith(ym)
      )
      .reduce(
        (sum, e) =>
          sum + (e.direction === "in" ? (e.amount ?? 0) : -(e.amount ?? 0)),
        0
      );
    const carried =
      opening == null
        ? null
        : await this.putSetting(
            `opening_cash:${nextYm}`,
            opening + movement,
            // 원장에서 계산한 값이므로 임시가 아니다
            false,
            actor,
            `${ym} 마감 이월 — 기초 ${opening} + 증감 ${movement}`
          );

    return {
      ...period,
      carryForward:
        carried == null
          ? {
              ym: nextYm,
              value: null,
              blockedBy:
                "이 달의 기초잔액이 없어 이월을 계산하지 못했습니다 — 이관 첫 달은 cash_on_hand 를 먼저 넣어야 합니다",
            }
          : { ym: nextYm, value: carried.value as number, blockedBy: null },
    };
  }

  /** 다음 달 (YYYY-MM) */
  private nextMonth(ym: string): string {
    const [y, m] = ym.split("-").map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  }

  /**
   * 그 달의 기초잔액. 마감으로 만들어진 이월값이 있으면 그것이 우선이고,
   * 없으면 이관 첫 달로 보고 cash_on_hand 를 쓴다 (A12).
   */
  private openingCashFor(ym: string, settings: Setting[]): number | null {
    return (
      settingValue<number>(settings, `opening_cash:${ym}`) ??
      settingValue<number>(settings, "cash_on_hand")
    );
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
   * §5.6 개시 전 재이관 — 「데일리 현금흐름」 시트를 최종본으로 다시 깐다.
   *
   * **이것은 원칙 9(물리 삭제 없음)의 유일한 예외다.** 원칙 9 가 지키려는 것은
   * 운영 중인 원장의 이력이 사라지지 않는 것이고, 개시 전 기준 데이터를 다시
   * 까는 것은 이력을 지우는 일이 아니라 출발점을 바꾸는 일이다. 그래서 예외를
   * 열되 문을 네 개 달았다.
   *
   *   ① 대표만
   *   ② 비밀번호를 다시 확인한 뒤에만 (D7) — 자리를 비운 노트북에서 돌면 안 된다
   *   ③ 확인 문구를 **직접 타이핑**해야 한다. 버튼 오클릭으로는 안 돌아간다
   *   ④ **마감된 기간이 하나라도 있으면 거부한다** — 마감은 「이 기간은 확정됐다」는
   *      선언이다. 그 뒤로는 개시 전이 아니므로 이 경로를 쓸 수 없다
   *
   * 감사로그는 남긴다. 무엇이 언제 왜 초기화됐는지가 남지 않으면 예외가 아니라
   * 구멍이 된다.
   */
  static readonly REBUILD_CONFIRM = "기존 원장을 모두 지우고 다시 만든다";

  async rebuildFromDailyCashSheet(
    input: { text: string; year?: number; confirm: string },
    actor: Actor
  ) {
    if (actor.role !== "대표")
      throw erpError(
        "forbidden_field",
        {},
        "원장 재이관은 대표만 할 수 있습니다"
      );
    if (!actor.stepUpFresh) throw erpError("reauth_required");
    if (input.confirm.trim() !== LedgerService.REBUILD_CONFIRM)
      throw erpError(
        "reason_required",
        { expected: LedgerService.REBUILD_CONFIRM },
        `확인 문구를 정확히 입력하십시오 — 「${LedgerService.REBUILD_CONFIRM}」`
      );

    const periods = await this.store.listPeriods();
    const closed = periods.filter(p => p.status === "closed");
    if (closed.length > 0)
      throw erpError(
        "period_closed",
        { closed: closed.map(p => p.ym) },
        `마감된 기간이 있습니다 (${closed.map(p => p.ym).join(" · ")}) — 재이관은 개시 전에만 할 수 있습니다`
      );

    const year = input.year ?? Number((await this.today()).slice(0, 4));
    const flat = flattenDailyCashSheet(input.text, { year });
    if (flat.rows === 0)
      throw erpError(
        "not_found",
        {},
        "시트에서 읽은 줄이 없습니다 — 구글 시트에서 전체를 복사해 붙여 넣으십시오"
      );

    // 먼저 읽어 본다. 읽히지 않는 시트로 원장을 비우는 일이 없어야 한다
    const parsed = importSheet(flat.tsv, {
      existingCodes: [],
      actor: actor.id,
      fallbackYear: year,
    });

    const removed = await this.store.resetLedger();

    for (const item of parsed.entries) await this.store.insertEntry(item.entry);
    for (const snapshot of parsed.snapshots)
      await this.store.insertSnapshot(snapshot);

    await this.audit(
      "entry",
      "ledger-rebuild",
      "rebuild",
      removed,
      {
        days: flat.days.length,
        rows: flat.rows,
        inserted: parsed.entries.length,
        snapshots: parsed.snapshots.length,
        undecided: parsed.summary.undecided,
        warnings: flat.warnings.length,
      },
      actor
    );

    return {
      removed,
      days: flat.days,
      warnings: flat.warnings,
      ...parsed,
      inserted: parsed.entries.length,
    };
  }

  /**
   * §11.1 슬랙 수집 — 규칙 파서를 먼저 돌리고, 못 읽은 것만 AI에 넘긴다.
   * 어느 쪽이든 결과는 원장이 아니라 **검수함**에 선다. 사람이 확인해야 원장으로 올라간다 (원칙 7).
   */
  async collectSlackMessage(
    message: {
      channel: string;
      ts: string;
      text: string;
      user: string | null;
      /** 붙은 파일 — 본문만 읽으면 계약서·견적서가 통째로 사라진다 */
      files?: SlackFileMeta[];
    },
    actor: Actor,
    deps: {
      readFiles?: typeof readSlackFiles;
      /**
       * 첨부를 **지금** 읽을 것인가.
       *
       * 실시간 경로(메시지 한 건)는 읽는다. 백필은 읽지 않는다 — 메시지마다
       * 파일을 내려받고 모델을 부르면 한 번의 호출이 몇 분씩 걸려 서버리스
       * 함수가 시간 초과로 죽는다. 백필은 파일 **정보만** 남기고, 내용은
       * 「첨부 읽기」에서 조금씩 읽는다.
       */
      readAttachments?: boolean;
      /** 부르는 쪽이 이미 중복을 걸렀으면 건너뛴다 — 메시지마다 질의하지 않기 위해 */
      skipDuplicateCheck?: boolean;
    } = {}
  ) {
    if (!deps.skipDuplicateCheck) {
      const existing = await this.store.listIntakes();
      if (
        existing.some(
          item => item.source === "slack" && item.sourceRef === message.ts
        )
      ) {
        // 같은 스레드 ts는 두 번 들어오지 않는다 (§6.2 UNIQUE · T9)
        return { status: "duplicate" as const, id: null };
      }
    }
    /*
     * 붙은 파일을 먼저 읽는다.
     *
     * 계약서 PDF 안에 금액과 기간이 들어 있고, 본문에는 「서명 부탁드립니다」
     * 한 줄뿐인 경우가 많다. 파일에서 꺼낸 글자를 **본문 뒤에 이어 붙여**
     * 같은 파서에 넘긴다 — 파서를 두 벌 만들지 않기 위해서다.
     *
     * 파일 하나를 못 읽어도 메시지를 버리지 않는다. 못 읽은 이유를 적어 두고
     * 이름만이라도 남긴다 (이름에 거래처·날짜·문서 종류가 들어 있다).
     */
    const readFiles = deps.readFiles ?? readSlackFiles;
    const readNow = deps.readAttachments ?? true;
    const files = message.files ?? [];
    const attachments =
      files.length > 0 && readNow
        ? await readFiles(files, { token: process.env.SLACK_BOT_TOKEN })
        : files.map(file => ({
            name: file.name ?? file.title ?? "이름 없는 파일",
            mimetype: file.mimetype ?? null,
            size: file.size ?? null,
            permalink: file.permalink ?? null,
            text: null as string | null,
            reason: readNow
              ? null
              : "아직 읽지 않았습니다 — 「첨부 읽기」에서 읽습니다",
          }));
    const year = Number((await this.today()).slice(0, 4));
    const fileHints = attachments.map((file, at) => ({
      ...file,
      hints: readFileName(file.name, year),
      // 나중에 다시 내려받으려면 슬랙 주소가 있어야 한다
      meta: files[at] ?? null,
    }));
    const attachmentText = fileHints
      .map(file =>
        file.text
          ? `\n\n[첨부 ${file.name}]\n${file.text}`
          : `\n\n[첨부 ${file.name} — 읽지 못함: ${file.reason ?? "이유 미상"}]`
      )
      .join("");
    const fullText = `${message.text}${attachmentText}`;

    /*
     * 지출 요청이 아니면 버리기 전에 한 번 더 본다.
     *
     * 지출결의서와 계약서 서명요청은 **금액도 양식도 없어서** 지출 요청 판별을
     * 통과하지 못한다. 그렇다고 버리면 「대표가 무엇을 결재했는가」와 「어떤
     * 계약이 곧 생기는가」가 통째로 사라진다. 원장 건으로 만들지는 않고,
     * 원장과 대조할 **참조 기록**으로 남긴다.
     */
    if (!looksLikeExpenseRequest(fullText)) {
      const noteKind = classifyNote(fullText);
      if (!noteKind) return { status: "ignored" as const, id: null };

      const id = randomUUID();
      await this.store.upsertIntake({
        id,
        source: "slack",
        sourceRef: message.ts,
        channel: message.channel,
        raw: fullText,
        parsed: { by: "note", kind: noteKind, files: fileHints },
        // 원장으로 올라갈 건이 아니다 — 대조해서 보여 주는 데까지다
        status: "note",
        failReason: null,
        entryId: null,
        receivedAt: nowIso(),
      });
      await this.audit(
        "intake",
        id,
        "collect",
        null,
        { channel: message.channel, status: "note", kind: noteKind },
        actor
      );
      return { status: "note" as const, id };
    }

    const today = await this.today();
    const rule = parseSlackExpense(fullText, Number(today.slice(0, 4)));

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
        const ai = await aiParseExpense(fullText, today);
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
      channel: message.channel,
      raw: fullText,
      parsed: parsed ? { ...parsed, files: fileHints } : { files: fileHints },
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

  /**
   * POST /intake/slack/backfill — 슬랙 과거 메시지 백필 (§11.1).
   *
   * Events API 는 구독 이후만 보낸다. 켜기 전에 오간 요청은 여기서 긁어온다.
   *
   * 지키는 것
   *   · **수집 규칙은 한 벌이다.** 채널 허용(isWatchedChannel)도 파싱도
   *     실시간 경로와 같은 함수를 쓴다. 두 벌이 되면 반드시 갈라진다
   *   · 검수함까지만 온다. 원장 적재는 사람이 검수함에서 누른다 (원칙 7)
   *   · 같은 ts 는 두 번 들어오지 않는다 — **여러 번 눌러도 안전하다**
   *   · 기다리지 않는다. 시간 예산을 넘거나 429 를 받으면 커서를 돌려주고
   *     멈춘다. 호출한 쪽이 「이어서」를 누르면 그 자리에서 다시 시작한다
   *     (슬랙은 새 앱의 history 를 분당 1회로 조인다)
   */
  async backfillSlackHistory(
    input: {
      days?: number;
      channels?: string[];
      cursors?: Record<string, string>;
      budgetMs?: number;
    },
    actor: Actor,
    deps: {
      listChannels?: typeof listBotChannels;
      fetchPage?: typeof fetchHistoryPage;
      fetchThread?: typeof fetchThreadReplies;
      now?: () => number;
    } = {}
  ) {
    // 원장 앞단을 통째로 채우는 작업이다 — 대표만
    if (actor.role !== "대표")
      throw erpError(
        "forbidden_field",
        {},
        "슬랙 백필은 대표만 실행할 수 있습니다"
      );

    const token = process.env.SLACK_BOT_TOKEN;
    if (!token)
      throw erpError(
        "not_found",
        {},
        "SLACK_BOT_TOKEN 이 없습니다 — 슬랙 연동을 먼저 마치십시오"
      );

    const listChannels = deps.listChannels ?? listBotChannels;
    const fetchPage = deps.fetchPage ?? fetchHistoryPage;
    const fetchThread = deps.fetchThread ?? fetchThreadReplies;
    const now = deps.now ?? (() => Date.now());
    // 1일 미만은 의미가 없고, 1년을 넘기면 한 번에 끝날 수 없다
    const days = Math.min(Math.max(Math.round(input.days ?? 30), 1), 365);
    const startedAt = now();
    /*
     * 시간 예산.
     *
     * 서버리스 함수는 짧게 끊긴다. 넘기면 브라우저에는 이유 없이
     * `Failed to fetch` 만 뜬다 — 무엇이 잘못됐는지 알 길이 없는 최악의
     * 실패다. 그래서 함수 상한보다 넉넉히 아래에서 **우리가 먼저** 멈춘다.
     */
    const budgetMs = Math.min(Math.max(input.budgetMs ?? 6_000, 1_000), 60_000);
    const oldestSec = Math.floor(startedAt / 1000) - days * 86_400;

    /*
     * 대상 채널을 정하는 순서.
     *
     *   ① 호출자가 직접 준 목록
     *   ② SLACK_EXPENSE_CHANNELS 가 **명시 목록**인 경우 — 그것이 곧 대상이다
     *   ③ `*` 인 경우 — 봇이 들어가 있는 채널을 슬랙에 물어본다
     *
     * ② 를 따로 둔 이유가 있다. ③ 의 users.conversations 는 `channels:read`
     * 권한을 더 요구한다. 그 권한을 붙이기 전이라도 환경변수에 채널 ID 를
     * 적어 두면 백필이 돌아가야 한다 — 권한 하나 때문에 과거 데이터가
     * 통째로 막히는 것이 더 나쁘다.
     */
    const names = new Map<string, string | null>();
    const configured = (process.env.SLACK_EXPENSE_CHANNELS ?? "")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean);
    let targets: string[];
    if (input.channels && input.channels.length > 0) {
      targets = input.channels;
    } else if (configured.length > 0 && !configured.includes("*")) {
      targets = configured;
    } else if (configured.length === 0) {
      // 기본값은 닫힘 — 설치만으로 조용히 과거를 긁어오면 안 된다
      targets = [];
    } else {
      const found = await listChannels(token);
      if ("error" in found)
        throw erpError(
          "not_found",
          { slack: found.error },
          slackErrorMessage(found)
        );
      for (const channel of found.channels) names.set(channel.id, channel.name);
      targets = found.channels.map(channel => channel.id);
    }

    // 허용 판정은 실시간 경로와 **같은 함수**를 쓴다
    const allowed = targets.filter(id => isWatchedChannel(id));
    const skippedChannels = targets.length - allowed.length;
    // A resume map includes every unfinished channel, even those not started
    // yet (empty cursor). Completed channels must not consume the next budget.
    const pendingChannels = Object.keys(input.cursors ?? {});
    const watched = pendingChannels.length
      ? allowed
          .filter(id => pendingChannels.includes(id))
          .sort(
            (a, b) =>
              Number(Boolean(input.cursors?.[a])) -
              Number(Boolean(input.cursors?.[b]))
          )
      : allowed;

    // ts 하나마다 listIntakes() 를 돌면 메시지 수만큼 질의가 나간다.
    // 이미 들어온 것은 여기서 먼저 걸러 낸다 (collectSlackMessage 안의
    // 중복 검사는 그대로 둔다 — 실시간 경로가 그것에 기대고 있다)
    const seen = new Set(
      (await this.store.listIntakes())
        .filter(item => item.source === "slack")
        .map(item => item.sourceRef)
        .filter((ref): ref is string => Boolean(ref))
    );

    const report: {
      channel: string;
      name: string | null;
      scanned: number;
      collected: number;
      duplicate: number;
      ignored: number;
      failed: number;
      cursor: string | null;
      done: boolean;
      error: string | null;
      lastMessageTs: string | null;
    }[] = [];
    let stopped: string | null = null;
    let retryAfterSec: number | null = null;

    for (const channel of watched) {
      const line = {
        channel,
        name: names.get(channel) ?? null,
        scanned: 0,
        collected: 0,
        duplicate: 0,
        ignored: 0,
        failed: 0,
        cursor: input.cursors?.[channel] || null,
        done: false,
        error: null as string | null,
        /** 이 채널의 가장 최근 사람 글 (슬랙 ts). 안 쓰는 채널을 가려내는 값 */
        lastMessageTs: null as string | null,
      };
      report.push(line);

      if (stopped) continue; // 앞 채널에서 멈췄으면 이 채널은 손대지 않는다

      for (;;) {
        if (now() - startedAt > budgetMs) {
          stopped = "budget";
          break;
        }
        const page = await fetchPage({
          token,
          channel,
          oldest: String(oldestSec),
          cursor: line.cursor,
          limit: 200,
        });
        if ("error" in page) {
          line.error = slackErrorMessage(page);
          if (page.error === "ratelimited") {
            stopped = "ratelimited";
            retryAfterSec = page.retryAfterSec ?? 60;
          }
          // 권한·채널 문제는 그 채널만의 문제다 — 나머지 채널은 계속 간다
          break;
        }

        /*
         * 스레드까지 따라간다.
         *
         * 지출결의서는 부모 글이 「@대표 지출결의서」 한 줄뿐이고 **본문이
         * 답글 안에** 있다. 부모만 가져오면 무엇을 결재했는지가 통째로 빠진다.
         * 답글을 부모 바로 뒤에 끼워 같은 흐름으로 처리한다.
         */
        const expanded: typeof page.messages = [];
        for (const message of page.messages) {
          const hasThread = Boolean(
            message.ts && message.reply_count && message.reply_count > 0
          );
          if (!hasThread) {
            expanded.push(message);
            continue;
          }

          const thread = await fetchThread({
            token,
            channel,
            ts: message.ts as string,
          });
          if ("error" in thread) {
            // 스레드 하나를 못 읽었다고 채널 전체를 멈추지 않는다
            line.error = line.error ?? slackErrorMessage(thread);
            expanded.push(message);
            continue;
          }

          /*
           * 결의서는 **스레드 하나가 곧 한 건**이다. 부모는 「@대표 지출결의서」
           * 한 줄이고 항목은 답글에, 승인도 답글에 있다. 따로 떼면 답글에는
           * 아무 표시가 없어 잡담으로 버려지고, 부모에는 내용이 없다.
           * 그래서 **하나로 합쳐** 부모 ts 로 수집한다.
           *
           * 그 밖의 글은 예전대로 따로 둔다 — 지출 요청에 달린 「확인했습니다」
           * 같은 답글까지 본문에 섞으면 파싱이 흐려진다.
           */
          if (classifyNote(message.text ?? "")) {
            const body = [
              message.text ?? "",
              ...thread.messages.map(reply => reply.text ?? ""),
            ]
              .filter(Boolean)
              .join("\n");
            expanded.push({
              ...message,
              text: body,
              files: [
                ...(message.files ?? []),
                ...thread.messages.flatMap(reply => reply.files ?? []),
              ],
            });
            continue;
          }

          expanded.push(message, ...thread.messages);
        }

        for (const message of expanded) {
          /*
           * **메시지마다** 예산을 본다.
           *
           * 예전에는 페이지 사이에서만 봤다. 그런데 한 페이지 안에서 스레드
           * 조회와 수집이 메시지 수만큼 일어나므로, 한 번의 반복이 몇 분까지
           * 늘어날 수 있었다. 그것이 `Failed to fetch` 의 정체다.
           */
          if (now() - startedAt > budgetMs) {
            stopped = "budget";
            break;
          }
          if (!isCollectableMessage(message)) continue;
          line.scanned += 1;
          // conversations.history 는 최신부터 준다 — 첫 건이 곧 마지막 글이다
          if (line.lastMessageTs === null)
            line.lastMessageTs = message.ts ?? null;
          const ts = message.ts as string;
          if (seen.has(ts)) {
            line.duplicate += 1;
            continue;
          }
          /*
           * 잡담은 검수함에 넣지 않는다 — 실시간 경로와 **같은 판정**이어야 한다.
           *
           * 여기서 지출 요청만 통과시키면 지출결의서·계약서 서명요청이
           * `collectSlackMessage()` 에 닿기도 전에 버려진다. 같은 규칙을 두
           * 군데 적으면 이렇게 어긋난다.
           */
          const text = message.text as string;
          if (!looksLikeExpenseRequest(text) && !classifyNote(text)) {
            line.ignored += 1;
            continue;
          }
          const result = await this.collectSlackMessage(
            {
              channel,
              ts,
              text: message.text as string,
              user: message.user ?? message.bot_id ?? null,
              files: message.files,
            },
            actor,
            {
              // 중복은 위의 seen 으로 이미 걸렀다 — 메시지마다 질의하지 않는다
              skipDuplicateCheck: true,
              // 첨부 내용은 여기서 읽지 않는다. 읽으면 함수가 시간 초과로 죽는다
              readAttachments: false,
            }
          );
          seen.add(ts);
          if (result.status === "duplicate") line.duplicate += 1;
          else if (result.status === "ignored") line.ignored += 1;
          else if (result.status === "failed") line.failed += 1;
          else line.collected += 1;
        }

        if (stopped === "budget") break;

        line.cursor = page.nextCursor;
        if (!page.nextCursor) {
          line.done = true;
          break;
        }
      }
    }

    /*
     * 「30일 안에 사람 글이 없으면 안 쓰는 채널이다」 — 대표님이 준 규칙이다.
     *
     * 백필에서 **거르지는 않는다.** 과거를 긁는 것이 백필의 목적이고, 안 쓰는
     * 채널일수록 과거만 있기 때문이다. 대신 결과에 표시해서, 앞으로 실시간
     * 수집 대상에서 뺄지(봇을 내보낼지) 사람이 판단할 수 있게 한다.
     */
    const dormantCutoffSec = Math.floor(startedAt / 1000) - 30 * 86_400;
    const channels = report.map(line => ({
      ...line,
      lastMessageAt: line.lastMessageTs
        ? new Date(Number(line.lastMessageTs) * 1000).toISOString().slice(0, 10)
        : null,
      dormant:
        line.error === null &&
        (line.lastMessageTs === null ||
          Number(line.lastMessageTs) < dormantCutoffSec),
    }));

    const totals = report.reduce(
      (sum, line) => ({
        scanned: sum.scanned + line.scanned,
        collected: sum.collected + line.collected,
        duplicate: sum.duplicate + line.duplicate,
        ignored: sum.ignored + line.ignored,
        failed: sum.failed + line.failed,
      }),
      { scanned: 0, collected: 0, duplicate: 0, ignored: 0, failed: 0 }
    );
    /*
     * 「남았는가」는 `done` 이 아니라 **이어서 부를 수 있는가**로 판단한다.
     * 속도 제한으로 멈춘 채널은 error 가 붙지만 끝난 것이 아니다 — 그것을
     * 끝난 것으로 세면 화면이 「모두 훑었습니다」라고 거짓말을 한다.
     */
    const remaining =
      stopped !== null || report.some(line => !line.done && !line.error);
    const cursors: Record<string, string> = {};
    for (const line of report) {
      if (!line.done) cursors[line.channel] = line.cursor ?? "";
    }

    await this.audit(
      "intake",
      "slack-backfill",
      "backfill",
      null,
      { days, channels: watched.length, ...totals },
      actor
    );

    return {
      from: new Date(oldestSec * 1000).toISOString().slice(0, 10),
      days,
      channels,
      dormantChannels: channels
        .filter(line => line.dormant)
        .map(l => l.channel),
      totals,
      skippedChannels,
      remaining,
      cursors,
      stopped,
      retryAfterSec,
      note: remaining
        ? stopped === "ratelimited"
          ? `슬랙이 속도 제한을 걸었습니다 — ${retryAfterSec ?? 60}초 뒤에 「이어서 가져오기」를 누르십시오`
          : "아직 남았습니다 — 「이어서 가져오기」를 누르면 멈춘 자리에서 계속합니다"
        : "지정한 기간을 모두 훑었습니다",
    };
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

    /*
     * 방향은 파서가 읽은 것을 쓴다. 예전에는 무조건 지출이었는데, 계산서 발행
     * 요청(우리가 청구하는 건)이 같은 경로로 들어오면서 **매출이 지출로**
     * 적재됐다. 손익 부호가 통째로 뒤집히는 자리다.
     */
    const direction =
      str("direction") === "in" ? ("in" as const) : ("out" as const);
    const created = await this.createEntry(
      {
        direction,
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
        // 접대비 계정이 마스터에 없다 (docs/erp-qa.md B2) — 생기면 여기서 판정한다.
        // 6410 은 지급임차료이므로 접대비로 볼 수 없다.
        isEntertainment: false,
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
      /**
       * 귀속일(발생일). 없으면 지급일과 같다고 본다.
       * 손익은 이 날짜를, 현금흐름은 cashDate 를 축으로 쓴다 (docs/erp-qa.md A4).
       */
      accrualDate?: string | null;
      /** 거래처 — 한도 쪼개기 판정(D2)과 채권·채무 대응에 쓰인다 */
      partyId?: string | null;
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
      /** 입출금 계좌 — 계좌별 잔액·대사의 단위다 (docs/erp-qa.md C5) */
      bankAccount?: string | null;
      /** 원천징수 근거 (A2) */
      incomeType?: Entry["incomeType"];
      withheldAmount?: number | null;
      /** 차입 상환의 원금 몫 (C3) */
      principalAmount?: number | null;
      /** 4대보험 분리 (B6) */
      employeeInsurance?: number | null;
      employerInsurance?: number | null;
      /** 외화 (A8) — amount 는 환산된 원화다 */
      currency?: string | null;
      amountForeign?: number | null;
      fxRate?: number | null;
      /** 이연 개월 수 (A7) — 손익만 월할로 나눈다 */
      deferralMonths?: number | null;
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

    /*
     * 외화는 여기서 원화로 환산한다 (docs/erp-qa.md A8).
     * 환율을 모르면 환산하지 않고 금액을 비운 채 판정 대기로 둔다 — 임의 환율로
     * 원장에 넣으면 나중에 어느 줄이 추정이었는지 구분할 수 없다.
     */
    const currency = (input.currency ?? "KRW").toUpperCase();
    const fx =
      currency === "KRW" || input.amountForeign == null
        ? { krw: input.amount, reason: null }
        : toKrw({
            amount: input.amountForeign,
            currency,
            rate: input.fxRate ?? null,
          });
    const amount = currency === "KRW" ? input.amount : fx.krw;

    // 항목명이 없거나 금액이 확정되지 않으면 판정 대기다 (§7.2 · §6.2)
    const undecidedReason =
      input.title.trim() === ""
        ? "항목명 없음"
        : amount == null
          ? (fx.reason ?? "금액 미확정")
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
      amount,
      amountCandidate: input.amountCandidate ?? null,
      amountSupply: null,
      amountVat: null,
      currency,
      amountForeign: input.amountForeign ?? null,
      fxRate: input.fxRate ?? null,
      deferralMonths: input.deferralMonths ?? null,
      cashDate: input.cashDate,
      accrualDate: input.accrualDate ?? input.cashDate,
      startDate: null,
      deliverDate: null,
      requestDate: null,
      dueDate: input.cashDate,
      paidAt: null,
      accountCode: input.accountCode ?? null,
      nature: input.nature ?? "미지정",
      buCode: input.buCode ?? null,
      projectId: input.projectId ?? null,
      partyId: input.partyId ?? null,
      contractId: null,
      priority:
        input.direction === "in" ? null : defaultPriorityOf(input.accountCode),
      priorityOverride: null,
      priorityReason: null,
      payMethod: input.payMethod ?? null,
      bankAccount: input.bankAccount ?? null,
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
      incomeType: input.incomeType ?? null,
      withheldAmount: input.withheldAmount ?? null,
      principalAmount: input.principalAmount ?? null,
      employeeInsurance: input.employeeInsurance ?? null,
      employerInsurance: input.employerInsurance ?? null,
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
    actor: Actor,
    /**
     * 취소 사유 분류 (docs/erp-qa.md D6).
     * 자유 텍스트만 받으면 「중복 입력이 몇 건인지」를 셀 수 없어
     * 개선할 곳을 못 찾는다.
     */
    reasonCode?: CancelReasonCode | null
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
      // 분류를 함께 남긴다 — 「중복 입력 몇 건」을 셀 수 있어야 개선할 곳이 보인다
      { ...counter, cancelReasonCode: reasonCode ?? "other" },
      actor,
      reasonCode ? `${cancelReasonLabel(reasonCode)} — ${reason}` : reason
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
    // D1 — 만든 사람뿐 아니라 이 건을 손댄 사람 전부를 승인에서 제외한다.
    // 생성자만 막으면 수정본(-R1)을 만든 사람이 자기 수정을 승인할 수 있다.
    const touched = await this.touchedBy(entry);
    if (touched.has(actor.id)) throw erpError("self_approval");

    // D2 — 같은 거래처에 쪼개서 올리면 건별 한도를 우회할 수 있다.
    // 같은 주에 같은 거래처로 나가는 확정·대기 합계로 다시 판정한다.
    const weekTotal = await this.partyWeekTotal(entry);
    if (weekTotal > entry.amount && !canApproveAmount(actor.role, weekTotal))
      throw erpError("approval_limit", { amount: weekTotal });
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

  /**
   * 이 건을 손댄 사람 전부 — 생성자와 수정본 계보 전체의 생성자.
   * 자기승인 차단은 「만든 사람」이 아니라 「관여한 사람」 기준이어야 한다 (D1).
   */
  private async touchedBy(entry: Entry): Promise<Set<string>> {
    const all = await this.store.listEntries();
    const people = new Set<string>([entry.createdBy]);
    // 수정본 계보를 거슬러 올라간다
    let cursor: Entry | undefined = entry;
    const seen = new Set<string>();
    while (cursor?.parentCode && !seen.has(cursor.parentCode)) {
      seen.add(cursor.parentCode);
      const parentCode: string = cursor.parentCode;
      cursor = all.find(e => e.code === parentCode);
      if (cursor) people.add(cursor.createdBy);
    }
    return people;
  }

  /**
   * 같은 거래처에 같은 주(월~일)로 나가는 금액 합계 — 한도 쪼개기를 막는다 (D2).
   * 거래처가 지정되지 않은 건은 묶을 근거가 없으므로 건별 금액 그대로 본다.
   */
  private async partyWeekTotal(entry: Entry): Promise<number> {
    if (!entry.partyId || entry.amount == null) return entry.amount ?? 0;
    const date = entry.cashDate ?? entry.accrualDate;
    if (!date) return entry.amount;

    const day = new Date(`${date}T00:00:00+09:00`);
    const weekday = (day.getDay() + 6) % 7; // 월요일을 0으로
    const monday = new Date(day);
    monday.setDate(day.getDate() - weekday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const from = monday.toISOString().slice(0, 10);
    const to = sunday.toISOString().slice(0, 10);

    const all = await this.store.listEntries();
    return all
      .filter(e => {
        if (e.partyId !== entry.partyId) return false;
        if (e.direction !== "out" || e.amount == null) return false;
        if (e.status !== "pending" && e.status !== "confirmed") return false;
        const d = e.cashDate ?? e.accrualDate;
        return d != null && d >= from && d <= to;
      })
      .reduce((sum, e) => sum + (e.amount ?? 0), 0);
  }

  private async requireWritable(code: string, actor: Actor): Promise<Entry> {
    const entry = await this.store.getEntry(code);
    if (!entry) throw erpError("not_found", { code });
    // 이관 구간은 건별 명세가 없으므로 원장에 존재하지 않는다 (§5.3) — 도달하면 코드 오류
    const parsed = parseCode(entry.code);
    if (!parsed) throw erpError("invalid_transition", { code });
    const settings = await this.store.listSettings();
    const closed = settingValue<string[]>(settings, "closed_periods") ?? [];
    // 발생월과 지급월을 모두 본다 — 하나만 보면 발생월이 마감된 건이 통과한다
    // (docs/erp-qa.md D4)
    for (const date of [entry.accrualDate, entry.cashDate]) {
      const ym = (date ?? "").slice(0, 7);
      if (ym && closed.includes(ym)) throw erpError("period_closed", { ym });
    }
    return entry;
  }

  /** 원장이 확정되는 순간 전표(분개)가 자동 생성된다. 사람이 분개를 만들지 않는다 (원칙 12). */
  private async createJournal(entry: Entry): Promise<Journal | null> {
    // 세액을 분리할지는 붙어 있는 증빙으로 갈린다 — 적격증빙이 없으면 분리하지 않는다
    const attachments = await this.store.listAttachments(entry.id);
    const hasQualifiedEvidence = attachments.some(
      a =>
        a.storage !== "none" &&
        (evidenceKindSpec(a.kind)?.vatDeductible ?? false)
    );
    // 한 건에서 전표가 2건 나올 수 있다 — 발생/지급이 다른 달이거나 차입 상환일 때
    const journals = buildJournals(entry, () => randomUUID(), {
      hasQualifiedEvidence,
    });

    // 사람이 읽는 번호를 붙인다 (A14). 같은 달 안에서 순번이 이어져야 하므로
    // 기존 번호를 보고 다음 값을 찾는다.
    const existing = (await this.store.listJournals()).map(j => j.journalNo);
    for (const journal of journals) {
      journal.journalNo = nextJournalNumber(journal.journalDate, existing);
      existing.push(journal.journalNo);
      await this.store.appendJournal(journal);
    }
    return journals[0] ?? null;
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
