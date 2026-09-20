/**
 * 원장 저장소 — 단일 원본 하나만 읽고 쓴다 (§4 · 원칙 12).
 *
 * 파생 뷰용 테이블은 만들지 않는다. 현금흐름표·현금현황은 전부 이 저장소에서 계산된다.
 * 물리 삭제 메서드를 노출하지 않는다 (원칙 9).
 *
 * DATABASE_URL이 있으면 MySQL(Drizzle), 없으면 §5.4 시드로 초기화된 메모리 저장소를 쓴다 —
 * 기존 server/db.ts와 같은 graceful degradation 방식이다.
 */
import {
  ACCOUNTS,
  SEED_AR_ENTRIES,
  SEED_DAY_SNAPSHOTS,
  SEED_DEBTS,
  SEED_ENTRIES,
  SEED_PARTIES,
  SEED_PROJECTS,
  SEED_SETTINGS,
  SEED_STAGE2_SETTINGS,
  buildJournal,
} from "../../shared/erp/index.js";
import type {
  Account,
  AppUser,
  Approval,
  Settlement,
  Attachment,
  AuditLog,
  Contract,
  Debt,
  DebtSchedule,
  Entry,
  EntryRevision,
  Intake,
  Journal,
  Notification,
  Party,
  Period,
  Project,
  Setting,
} from "../../shared/erp/index.js";
import type { SeedDaySnapshot } from "../../shared/erp/seed.js";

export interface EntryFilter {
  from?: string;
  to?: string;
  direction?: "out" | "in";
  status?: Entry["status"][];
  account?: string;
  bu?: string;
  project?: string;
  nature?: string;
  priority?: string;
  q?: string;
}

export interface LedgerStore {
  listEntries(filter?: EntryFilter): Promise<Entry[]>;
  getEntry(code: string): Promise<Entry | undefined>;
  insertEntry(entry: Entry): Promise<Entry>;
  /** 낙관적 잠금 — expectedVersion이 맞지 않으면 undefined를 돌려준다 (§4) */
  replaceEntry(
    entry: Entry,
    expectedVersion: number
  ): Promise<Entry | undefined>;
  listSnapshots(): Promise<SeedDaySnapshot[]>;
  /** 이관 일계 적재 — §5.4 시드에서만 쓴다. 이관 구간은 원장이 아니다 (§5.3) */
  insertSnapshot(snapshot: SeedDaySnapshot): Promise<SeedDaySnapshot>;
  listAccounts(): Promise<Account[]>;
  upsertAccount(account: Account): Promise<Account>;
  listSettings(): Promise<Setting[]>;
  putSetting(setting: Setting): Promise<Setting>;
  appendRevision(revision: EntryRevision): Promise<void>;
  listRevisions(entryId: string): Promise<EntryRevision[]>;
  appendApproval(approval: Approval): Promise<void>;
  listApprovals(entryId: string): Promise<Approval[]>;

  /** 실제 입출금 확인 — entryId 를 비우면 전부 */
  appendSettlement(settlement: Settlement): Promise<void>;
  /**
   * **초과 없이** 확인 줄을 넣는다 — 합계 검사와 삽입이 **한 번에** 일어난다.
   *
   * 서비스에서 「읽고 → 검사하고 → 넣는」 방식은 동시 호출을 막지 못한다.
   * 두 호출이 같은 시점에 합계를 읽으면 둘 다 여유가 있다고 판단하고 둘 다
   * 통과한다 — 1,000원짜리 건에 600 + 600 이 들어간다. 버전으로도 못 막는다:
   * 부분 확인은 건을 바꾸지 않으므로 두 호출의 expectedVersion 이 똑같이
   * 유효하다. 화면에서 두 번 못 누르게 하는 것도 대책이 아니다 — API 를
   * 직접 부르면 그대로 통과한다.
   *
   * 그래서 **검사를 삽입과 같은 연산 안에** 둔다.
   */
  /**
   * 한도와 **마감 여부를 같은 문장 안에서** 본다 (QA-007).
   *
   * 앱이 먼저 읽고 나중에 쓰면 그 사이에 마감이 끼어든다. 「읽은 값으로
   * 판단」이 아니라 「쓰는 순간의 값으로 판단」이어야 한다.
   *
   * `closed` 는 **왜 못 들어갔는지 사람에게 말해 주기 위한 것**이지 판정
   * 근거가 아니다. 판정은 이미 문장 안에서 끝났다.
   */
  appendSettlementGuarded(
    settlement: Settlement,
    maxTotal: number
  ): Promise<{ inserted: boolean; settled: number; closed: boolean }>;
  listSettlements(entryId?: string): Promise<Settlement[]>;
  replaceSettlement(settlement: Settlement): Promise<Settlement | null>;
  /**
   * **살아 있을 때만** 무효 처리한다 — 두 사람이 같은 줄을 동시에 취소해도
   * 실제로 바꾸는 쪽은 하나다. 둘 다 성공했다고 답하면 감사로그에 취소가 두 번
   * 남고, 사람은 무엇이 실제로 일어났는지 알 수 없다.
   */
  /**
   * 살아 있고 **그 달이 열려 있을 때만** 무효 처리한다 (QA-007).
   *
   * 취소도 그 달 현금을 바꾼다. 삽입만 막고 취소를 열어 두면 마감된 달의
   * 숫자가 빠지는 방향으로 틀어진다.
   */
  voidSettlementIfLive(
    id: string,
    patch: { voidedAt: string; voidedBy: string; voidReason: string }
  ): Promise<{ voided: Settlement | null; closed: boolean }>;
  appendAudit(log: AuditLog): Promise<void>;
  listAudit(filter?: { table?: string; rowId?: string }): Promise<AuditLog[]>;
  appendJournal(journal: Journal): Promise<void>;
  listJournals(entryId?: string): Promise<Journal[]>;
  /* 2차 · 3차 마스터 */
  listParties(): Promise<Party[]>;
  upsertParty(party: Party): Promise<Party>;
  listProjects(): Promise<Project[]>;
  upsertProject(project: Project): Promise<Project>;
  listContracts(): Promise<Contract[]>;
  upsertContract(contract: Contract): Promise<Contract>;
  listDebts(): Promise<Debt[]>;
  upsertDebt(debt: Debt): Promise<Debt>;
  listDebtSchedules(): Promise<DebtSchedule[]>;
  upsertDebtSchedule(schedule: DebtSchedule): Promise<DebtSchedule>;
  listIntakes(): Promise<Intake[]>;
  upsertIntake(intake: Intake): Promise<Intake>;
  listPeriods(): Promise<Period[]>;
  upsertPeriod(period: Period): Promise<Period>;
  /** 증빙 — 삭제는 없다. 잘못 올린 것은 kind를 「기타」로 두고 사유를 적는다 (원칙 9) */
  listAttachments(entryId?: string): Promise<Attachment[]>;
  appendAttachment(attachment: Attachment): Promise<Attachment>;
  /** §12 알림 — 미발송이어도 적재된다 (B7) */
  listNotifications(): Promise<Notification[]>;
  upsertNotification(notification: Notification): Promise<Notification>;
  /**
   * 발송 직전에 **한 문장으로** 선점한다 (QA-004).
   *
   * 「읽고 → 보내고 → 저장」 사이에는 아무 보호가 없었다. 화면 조회와 크론이
   * 겹치면 둘 다 「아직 안 보냈다」를 읽고 둘 다 보낸다. 프로세스 안의 잠금
   * 으로는 못 막는다 — 운영은 서버리스라 인스턴스가 여럿이다.
   *
   * 집었으면 `claimed: true`. 못 집었으면 이미 보냈거나, 다른 쪽이 보내는
   * 중이거나, 시도 횟수를 다 쓴 것이다. `current` 는 화면에 보여 줄 현재
   * 상태다 — 진 쪽도 「보냈다」를 보여 줘야 사람이 다시 누르지 않는다.
   */
  claimNotification(
    notification: Notification,
    opts: { now: string; leaseUntil: string; maxAttempts: number }
  ): Promise<{ claimed: boolean; current: Notification }>;
  /**
   * 선점을 놓는다. **성공은 덮지 않는다** — 늦게 도착한 실패가 먼저 성공한
   * 발송을 지우면 「안 갔다」로 보여 사람이 다시 보낸다.
   */
  releaseNotification(
    id: string,
    patch: { sentAt: string | null; lastError: string | null }
  ): Promise<Notification>;
  listAppUsers(): Promise<AppUser[]>;
  upsertAppUser(user: AppUser): Promise<AppUser>;
  /**
   * 원장 초기화 — **개시 전 재이관에만** 쓴다 (§5.6).
   *
   * 「물리 삭제는 없다」(원칙 9)의 유일한 예외다. 원칙 9 가 지키려는 것은
   * 「운영 중인 원장의 이력이 사라지지 않는 것」인데, 개시 전 기준 데이터를
   * 다시 까는 것은 이력을 지우는 일이 아니라 **출발점을 바꾸는 일**이다.
   *
   * 그래서 범위를 좁혔다. 원장·전표·일계·검수함만 비우고
   * **감사로그·계정과목·기준값·마스터는 남긴다** — 무엇이 언제 왜 초기화됐는지는
   * 남아야 하고, 그 기록까지 지우면 예외가 아니라 구멍이 된다.
   */
  resetLedger(): Promise<{
    entries: number;
    snapshots: number;
    journals: number;
    intakes: number;
  }>;
}

function matches(entry: Entry, filter: EntryFilter): boolean {
  const date = entry.cashDate ?? entry.accrualDate;
  if (filter.from && (!date || date < filter.from)) return false;
  if (filter.to && (!date || date > filter.to)) return false;
  if (filter.direction && entry.direction !== filter.direction) return false;
  if (filter.status && !filter.status.includes(entry.status)) return false;
  if (filter.account && entry.accountCode !== filter.account) return false;
  if (filter.bu && entry.buCode !== filter.bu) return false;
  if (filter.project && entry.projectId !== filter.project) return false;
  if (filter.nature && entry.nature !== filter.nature) return false;
  if (
    filter.priority &&
    (entry.priorityOverride ?? entry.priority) !== filter.priority
  )
    return false;
  if (filter.q) {
    const needle = filter.q.toLowerCase();
    const haystack =
      `${entry.code} ${entry.title} ${entry.noteRaw ?? ""} ${entry.note ?? ""}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

/** §5.4 시드로 초기화된 메모리 저장소. DB 없이도 8화면이 실제로 동작한다. */

/** 메모리 저장소용 upsert — 지정한 키 기준 */
function upsertBy<T, K extends keyof T>(list: T[], item: T, key: K): T {
  const index = list.findIndex(row => row[key] === item[key]);
  if (index < 0) list.push({ ...item });
  else list[index] = { ...item };
  return { ...item };
}

export class InMemoryLedgerStore implements LedgerStore {
  private entries: Entry[];
  private snapshots: SeedDaySnapshot[];
  private settings: Setting[];
  private revisions: EntryRevision[] = [];
  private approvals: Approval[] = [];
  private settlements: Settlement[] = [];
  private audits: AuditLog[] = [];
  private journals: Journal[] = [];
  private accounts: Account[] = ACCOUNTS.map(a => ({ ...a }));
  private parties: Party[];
  private projects: Project[];
  private contracts: Contract[] = [];
  private debts: Debt[];
  private debtSchedules: DebtSchedule[] = [];
  private intakes: Intake[] = [];
  private periods: Period[] = [];
  private attachments: Attachment[] = [];
  private notifications: Notification[] = [];
  private appUsers: AppUser[] = [];

  constructor(seed?: {
    entries?: Entry[];
    snapshots?: SeedDaySnapshot[];
    settings?: Setting[];
  }) {
    // 1차 원장 27건 + 2차 채권·발행대기 7건. 채권은 미입금이라 확정 합계를 바꾸지 않는다.
    this.entries = (seed?.entries ?? [...SEED_ENTRIES, ...SEED_AR_ENTRIES]).map(
      e => ({ ...e })
    );
    this.snapshots = (seed?.snapshots ?? SEED_DAY_SNAPSHOTS).map(s => ({
      ...s,
    }));
    this.settings = (
      seed?.settings ?? [...SEED_SETTINGS, ...SEED_STAGE2_SETTINGS]
    ).map(s => ({
      ...s,
    }));
    this.parties = SEED_PARTIES.map(p => ({ ...p }));
    this.projects = SEED_PROJECTS.map(p => ({ ...p }));
    this.debts = SEED_DEBTS.map(d => ({ ...d }));

    // 확정된 건은 전표가 있어야 한다 (§7.3) — 이관 확정분의 전표를 여기서 만들어 둔다.
    let seq = 0;
    const newId = () => `JRN-SEED-${String((seq += 1)).padStart(4, "0")}`;
    for (const entry of this.entries) {
      if (entry.status !== "confirmed") continue;
      const journal = buildJournal(entry, newId);
      if (journal) this.journals.push(journal);
    }
  }

  async listEntries(filter: EntryFilter = {}): Promise<Entry[]> {
    return this.entries.filter(e => matches(e, filter)).map(e => ({ ...e }));
  }

  async getEntry(code: string): Promise<Entry | undefined> {
    const found = this.entries.find(e => e.code === code);
    return found ? { ...found } : undefined;
  }

  async insertEntry(entry: Entry): Promise<Entry> {
    if (this.entries.some(e => e.code === entry.code)) {
      throw new Error(`code 재사용 금지 — ${entry.code}`);
    }
    if (entry.sourceRef) {
      const clash = this.entries.find(
        e => e.source === entry.source && e.sourceRef === entry.sourceRef
      );
      // UNIQUE (source, source_ref) — 같은 슬랙 메시지가 두 번 들어오지 않게 (T9)
      if (clash)
        throw new Error(`중복 수집 — ${entry.source}/${entry.sourceRef}`);
    }
    this.entries.push({ ...entry });
    return { ...entry };
  }

  async replaceEntry(
    entry: Entry,
    expectedVersion: number
  ): Promise<Entry | undefined> {
    const index = this.entries.findIndex(e => e.code === entry.code);
    if (index < 0) return undefined;
    if (this.entries[index].version !== expectedVersion) return undefined;
    this.entries[index] = { ...entry };
    return { ...entry };
  }

  async listSnapshots(): Promise<SeedDaySnapshot[]> {
    return this.snapshots.map(s => ({ ...s }));
  }

  async insertSnapshot(snapshot: SeedDaySnapshot): Promise<SeedDaySnapshot> {
    const index = this.snapshots.findIndex(s => s.date === snapshot.date);
    if (index >= 0) this.snapshots[index] = { ...snapshot };
    else this.snapshots.push({ ...snapshot });
    return { ...snapshot };
  }

  async listAccounts(): Promise<Account[]> {
    return this.accounts.map(a => ({ ...a }));
  }

  async upsertAccount(account: Account): Promise<Account> {
    return upsertBy(this.accounts, account, "code");
  }

  async listSettings(): Promise<Setting[]> {
    return this.settings.map(s => ({ ...s }));
  }

  async putSetting(setting: Setting): Promise<Setting> {
    const index = this.settings.findIndex(s => s.key === setting.key);
    if (index < 0) this.settings.push({ ...setting });
    else this.settings[index] = { ...setting };
    return { ...setting };
  }

  async appendRevision(revision: EntryRevision): Promise<void> {
    this.revisions.push(revision);
  }

  async listRevisions(entryId: string): Promise<EntryRevision[]> {
    return this.revisions.filter(r => r.entryId === entryId);
  }

  async appendApproval(approval: Approval): Promise<void> {
    this.approvals.push(approval);
  }

  async appendSettlement(settlement: Settlement): Promise<void> {
    this.settlements.push({ ...settlement });
  }
  async appendSettlementGuarded(
    settlement: Settlement,
    maxTotal: number
  ): Promise<{ inserted: boolean; settled: number; closed: boolean }> {
    /*
     * **이 블록 안에 `await` 가 하나도 없다 — 그래서 원자적이다.**
     *
     * 자바스크립트는 한 번에 한 흐름만 돈다. `await` 가 없으면 중간에 다른
     * 호출이 끼어들 수 없다. 한 줄이라도 `await` 를 넣으면 그 자리에서
     * 동시 호출이 갈라져 둘 다 통과하게 된다.
     *
     * 마감 확인도 **여기 안에서** 한다 (QA-007). 앱이 먼저 읽고 나중에
     * 쓰면 그 사이에 마감이 끼어든다.
     */
    if (this.isMonthClosedSync(settlement.settledOn.slice(0, 7))) {
      const settled = this.settlements
        .filter(x => x.entryId === settlement.entryId && x.voidedAt == null)
        .reduce((n, x) => n + x.amount, 0);
      return { inserted: false, settled, closed: true };
    }
    const settled = this.settlements
      .filter(x => x.entryId === settlement.entryId && x.voidedAt == null)
      .reduce((n, x) => n + x.amount, 0);
    if (settled + settlement.amount > maxTotal)
      return { inserted: false, settled, closed: false };
    this.settlements.push({ ...settlement });
    return {
      inserted: true,
      settled: settled + settlement.amount,
      closed: false,
    };
  }
  async listSettlements(entryId?: string): Promise<Settlement[]> {
    const rows = entryId
      ? this.settlements.filter(s => s.entryId === entryId)
      : this.settlements;
    return rows.map(s => ({ ...s }));
  }
  async replaceSettlement(settlement: Settlement): Promise<Settlement | null> {
    const i = this.settlements.findIndex(s => s.id === settlement.id);
    if (i < 0) return null;
    this.settlements[i] = { ...settlement };
    return { ...settlement };
  }
  /**
   * 마감 여부를 **동기로** 읽는다.
   *
   * `await` 가 하나라도 끼면 그 자리에서 다른 호출이 끼어들어, 「마감을 확인한
   * 뒤 마감되고 나서 쓰는」 바로 그 경합이 다시 생긴다.
   */
  private isMonthClosedSync(ym: string): boolean {
    if (this.periods.some(p => p.ym === ym && p.status === "closed"))
      return true;
    const row = this.settings.find(x => x.key === "closed_periods");
    return Array.isArray(row?.value) && (row.value as string[]).includes(ym);
  }

  async voidSettlementIfLive(
    id: string,
    patch: { voidedAt: string; voidedBy: string; voidReason: string }
  ): Promise<{ voided: Settlement | null; closed: boolean }> {
    // 이 블록 안에 `await` 가 없다 — 그래서 원자적이다
    const i = this.settlements.findIndex(x => x.id === id);
    if (i < 0) return { voided: null, closed: false };
    if (this.settlements[i].voidedAt != null)
      return { voided: null, closed: false };
    if (this.isMonthClosedSync(this.settlements[i].settledOn.slice(0, 7)))
      return { voided: null, closed: true };
    this.settlements[i] = { ...this.settlements[i], ...patch };
    return { voided: { ...this.settlements[i] }, closed: false };
  }

  async listApprovals(entryId: string): Promise<Approval[]> {
    return this.approvals.filter(a => a.entryId === entryId);
  }

  async appendAudit(log: AuditLog): Promise<void> {
    this.audits.push(log);
  }

  async listAudit(
    filter: { table?: string; rowId?: string } = {}
  ): Promise<AuditLog[]> {
    return this.audits.filter(
      a =>
        (!filter.table || a.table === filter.table) &&
        (!filter.rowId || a.rowId === filter.rowId)
    );
  }

  async appendJournal(journal: Journal): Promise<void> {
    this.journals.push(journal);
  }

  async listJournals(entryId?: string): Promise<Journal[]> {
    return entryId
      ? this.journals.filter(j => j.entryId === entryId)
      : [...this.journals];
  }

  async listParties(): Promise<Party[]> {
    return this.parties.map(p => ({ ...p }));
  }
  async upsertParty(party: Party): Promise<Party> {
    return upsertBy(this.parties, party, "id");
  }
  async listProjects(): Promise<Project[]> {
    return this.projects.map(p => ({ ...p }));
  }
  async upsertProject(project: Project): Promise<Project> {
    return upsertBy(this.projects, project, "id");
  }
  async listContracts(): Promise<Contract[]> {
    return this.contracts.map(c => ({ ...c }));
  }
  async upsertContract(contract: Contract): Promise<Contract> {
    return upsertBy(this.contracts, contract, "id");
  }
  async listDebts(): Promise<Debt[]> {
    return this.debts.map(d => ({ ...d }));
  }
  async upsertDebt(debt: Debt): Promise<Debt> {
    return upsertBy(this.debts, debt, "id");
  }
  async listDebtSchedules(): Promise<DebtSchedule[]> {
    return this.debtSchedules.map(s => ({ ...s }));
  }
  async upsertDebtSchedule(schedule: DebtSchedule): Promise<DebtSchedule> {
    return upsertBy(this.debtSchedules, schedule, "id");
  }
  async listIntakes(): Promise<Intake[]> {
    return this.intakes.map(i => ({ ...i }));
  }
  async upsertIntake(intake: Intake): Promise<Intake> {
    return upsertBy(this.intakes, intake, "id");
  }
  async listPeriods(): Promise<Period[]> {
    return this.periods.map(p => ({ ...p }));
  }
  async upsertPeriod(period: Period): Promise<Period> {
    return upsertBy(this.periods, period, "ym");
  }

  async listAttachments(entryId?: string): Promise<Attachment[]> {
    const rows = entryId
      ? this.attachments.filter(a => a.entryId === entryId)
      : this.attachments;
    return rows.map(a => ({ ...a }));
  }
  async appendAttachment(attachment: Attachment): Promise<Attachment> {
    this.attachments.push({ ...attachment });
    return { ...attachment };
  }
  async listNotifications(): Promise<Notification[]> {
    return this.notifications.map(n => ({ ...n }));
  }
  async upsertNotification(notification: Notification): Promise<Notification> {
    return upsertBy(this.notifications, notification, "id");
  }

  /**
   * **이 블록에는 `await` 가 하나도 없다.** 자바스크립트는 한 번에 한 흐름만
   * 돌기 때문에, `await` 가 없는 동안에는 다른 호출이 끼어들 수 없다. 한 줄
   * 이라도 넣으면 그 자리에서 갈라져 둘 다 선점에 성공한다.
   */
  async claimNotification(
    notification: Notification,
    opts: { now: string; leaseUntil: string; maxAttempts: number }
  ): Promise<{ claimed: boolean; current: Notification }> {
    const existing = this.notifications.find(n => n.id === notification.id);
    if (!existing) {
      const row: Notification = {
        ...notification,
        sendAttempts: 1,
        lastAttemptAt: opts.now,
        leaseUntil: opts.leaseUntil,
      };
      this.notifications.push(row);
      return { claimed: true, current: { ...row } };
    }
    /*
     * **시각은 문자열로 비교하지 않는다.**
     *
     * `nowIso()` 는 KST 오프셋(`+09:00`)으로 찍고 임대는 UTC(`Z`)로 찍힌다.
     * 문자열로 비교하면 `2026-09-20T16:52Z <= 2026-09-21T01:50+09:00` 이
     * 참이 된다 — 같은 순간인데 임대가 이미 지난 것처럼 보이고, 선점이
     * 통째로 무력해진다. 실제로 이 테스트가 그걸 잡았다.
     */
    const expired =
      existing.leaseUntil == null ||
      Date.parse(existing.leaseUntil) <= Date.parse(opts.now);
    const claimable =
      existing.sentAt == null &&
      existing.sendAttempts < opts.maxAttempts &&
      expired;
    if (!claimable) return { claimed: false, current: { ...existing } };
    existing.sendAttempts += 1;
    existing.lastAttemptAt = opts.now;
    existing.leaseUntil = opts.leaseUntil;
    return { claimed: true, current: { ...existing } };
  }

  async releaseNotification(
    id: string,
    patch: { sentAt: string | null; lastError: string | null }
  ): Promise<Notification> {
    const existing = this.notifications.find(n => n.id === id);
    if (!existing) throw new Error(`알림을 찾을 수 없습니다: ${id}`);
    // 먼저 성공한 쪽이 이긴다
    if (existing.sentAt == null) existing.sentAt = patch.sentAt;
    existing.lastError = existing.sentAt == null ? patch.lastError : null;
    existing.leaseUntil = null;
    return { ...existing };
  }
  async resetLedger() {
    const removed = {
      entries: this.entries.length,
      snapshots: this.snapshots.length,
      journals: this.journals.length,
      intakes: this.intakes.length,
    };
    this.entries = [];
    this.snapshots = [];
    this.journals = [];
    this.intakes = [];
    this.revisions = [];
    this.approvals = [];
    this.settlements = [];
    this.attachments = [];
    // 감사로그 · 계정과목 · 기준값 · 마스터는 남긴다
    return removed;
  }

  async listAppUsers(): Promise<AppUser[]> {
    return this.appUsers.map(u => ({ ...u }));
  }
  async upsertAppUser(user: AppUser): Promise<AppUser> {
    return upsertBy(this.appUsers, user, "id");
  }
}
