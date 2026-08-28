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
  SEED_DAY_SNAPSHOTS,
  SEED_ENTRIES,
  SEED_SETTINGS,
} from "@shared/erp";
import type {
  Account,
  Approval,
  AuditLog,
  Entry,
  EntryRevision,
  Journal,
  Setting,
} from "@shared/erp";
import type { SeedDaySnapshot } from "@shared/erp/seed";

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
  listAccounts(): Promise<Account[]>;
  listSettings(): Promise<Setting[]>;
  putSetting(setting: Setting): Promise<Setting>;
  appendRevision(revision: EntryRevision): Promise<void>;
  listRevisions(entryId: string): Promise<EntryRevision[]>;
  appendApproval(approval: Approval): Promise<void>;
  listApprovals(entryId: string): Promise<Approval[]>;
  appendAudit(log: AuditLog): Promise<void>;
  listAudit(filter?: { table?: string; rowId?: string }): Promise<AuditLog[]>;
  appendJournal(journal: Journal): Promise<void>;
  listJournals(entryId?: string): Promise<Journal[]>;
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
export class InMemoryLedgerStore implements LedgerStore {
  private entries: Entry[];
  private snapshots: SeedDaySnapshot[];
  private settings: Setting[];
  private revisions: EntryRevision[] = [];
  private approvals: Approval[] = [];
  private audits: AuditLog[] = [];
  private journals: Journal[] = [];

  constructor(seed?: {
    entries?: Entry[];
    snapshots?: SeedDaySnapshot[];
    settings?: Setting[];
  }) {
    this.entries = (seed?.entries ?? SEED_ENTRIES).map(e => ({ ...e }));
    this.snapshots = (seed?.snapshots ?? SEED_DAY_SNAPSHOTS).map(s => ({
      ...s,
    }));
    this.settings = (seed?.settings ?? SEED_SETTINGS).map(s => ({ ...s }));
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

  async listAccounts(): Promise<Account[]> {
    return ACCOUNTS.map(a => ({ ...a }));
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
}
