/**
 * MySQL(Drizzle) 저장소. DATABASE_URL이 설정된 환경에서 InMemoryLedgerStore를 대체한다.
 * DELETE는 어디에도 없다 (원칙 9) — 취소는 -C 상계 전표로만 한다.
 */
import { ACCOUNTS } from "@shared/erp";
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
import { and, asc, eq, gte, inArray, lte, like, or } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import {
  erpAccounts,
  erpApprovals,
  erpAuditLogs,
  erpDaySnapshots,
  erpEntries,
  erpEntryRevisions,
  erpJournalLines,
  erpJournals,
  erpSettings,
  type ErpEntryRow,
} from "../../drizzle/erpSchema";
import type { EntryFilter, LedgerStore } from "./store";

type Db = MySql2Database<Record<string, never>>;

function toEntry(row: ErpEntryRow): Entry {
  return {
    id: row.id,
    code: row.code,
    parentCode: row.parentCode,
    direction: row.direction,
    status: row.status,
    title: row.title,
    noteRaw: row.noteRaw,
    note: row.note,
    amount: row.amount,
    amountCandidate: row.amountCandidate,
    amountSupply: row.amountSupply,
    amountVat: row.amountVat,
    currency: row.currency,
    cashDate: row.cashDate,
    accrualDate: row.accrualDate,
    startDate: row.startDate,
    deliverDate: row.deliverDate,
    requestDate: row.requestDate,
    dueDate: row.dueDate,
    paidAt: row.paidAt,
    accountCode: row.accountCode,
    nature: row.nature,
    buCode: row.buCode,
    projectId: row.projectId,
    partyId: row.partyId,
    contractId: row.contractId,
    priority: row.priority,
    priorityOverride: row.priorityOverride,
    priorityReason: row.priorityReason,
    payMethod: row.payMethod,
    bankAccount: row.bankAccount,
    invoiceIssued: row.invoiceIssued,
    invoiceNo: row.invoiceNo,
    source: row.source,
    sourceRef: row.sourceRef,
    undecidedReason: row.undecidedReason,
    hasEvidence: row.hasEvidence,
    isPersonal: row.isPersonal,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };
}

function toRow(entry: Entry) {
  const { createdAt, ...rest } = entry;
  return { ...rest, createdAt: new Date(createdAt) };
}

export class DrizzleLedgerStore implements LedgerStore {
  constructor(private readonly db: Db) {}

  async listEntries(filter: EntryFilter = {}): Promise<Entry[]> {
    const clauses = [];
    if (filter.from) clauses.push(gte(erpEntries.cashDate, filter.from));
    if (filter.to) clauses.push(lte(erpEntries.cashDate, filter.to));
    if (filter.direction)
      clauses.push(eq(erpEntries.direction, filter.direction));
    if (filter.status?.length)
      clauses.push(inArray(erpEntries.status, filter.status));
    if (filter.account)
      clauses.push(eq(erpEntries.accountCode, filter.account));
    if (filter.bu) clauses.push(eq(erpEntries.buCode, filter.bu as never));
    if (filter.project) clauses.push(eq(erpEntries.projectId, filter.project));
    if (filter.nature)
      clauses.push(eq(erpEntries.nature, filter.nature as never));
    if (filter.priority)
      clauses.push(eq(erpEntries.priority, filter.priority as never));
    if (filter.q) {
      const needle = `%${filter.q}%`;
      clauses.push(
        or(
          like(erpEntries.code, needle),
          like(erpEntries.title, needle),
          like(erpEntries.noteRaw, needle)
        )!
      );
    }
    const rows = await (clauses.length
      ? this.db
          .select()
          .from(erpEntries)
          .where(and(...clauses))
          .orderBy(asc(erpEntries.cashDate))
      : this.db.select().from(erpEntries).orderBy(asc(erpEntries.cashDate)));
    return rows.map(toEntry);
  }

  async getEntry(code: string): Promise<Entry | undefined> {
    const rows = await this.db
      .select()
      .from(erpEntries)
      .where(eq(erpEntries.code, code))
      .limit(1);
    return rows[0] ? toEntry(rows[0]) : undefined;
  }

  async insertEntry(entry: Entry): Promise<Entry> {
    await this.db.insert(erpEntries).values(toRow(entry));
    return entry;
  }

  async replaceEntry(
    entry: Entry,
    expectedVersion: number
  ): Promise<Entry | undefined> {
    const { id, code, createdAt, createdBy, ...updatable } = toRow(entry);
    const result = await this.db
      .update(erpEntries)
      .set(updatable)
      .where(
        and(eq(erpEntries.code, code), eq(erpEntries.version, expectedVersion))
      );
    const affected =
      (result as unknown as { rowsAffected?: number }).rowsAffected ?? 0;
    return affected > 0 ? entry : undefined;
  }

  async listSnapshots(): Promise<SeedDaySnapshot[]> {
    const rows = await this.db
      .select()
      .from(erpDaySnapshots)
      .orderBy(asc(erpDaySnapshots.date));
    return rows.map(r => ({
      date: r.date,
      open: r.open,
      inSum: r.inSum,
      outSum: r.outSum,
      close: r.close,
      note: r.note,
      isMigrated: r.isMigrated,
      ...(r.sheetOpen != null ? { sheetOpen: r.sheetOpen } : {}),
      ...(r.sheetClose != null ? { sheetClose: r.sheetClose } : {}),
    }));
  }

  async listAccounts(): Promise<Account[]> {
    const rows = await this.db
      .select()
      .from(erpAccounts)
      .orderBy(asc(erpAccounts.code));
    // 마스터가 아직 적재되지 않은 환경에서는 §8.1 초기 적재분을 그대로 쓴다.
    return rows.length > 0
      ? rows.map(r => ({ ...r }))
      : ACCOUNTS.map(a => ({ ...a }));
  }

  async listSettings(): Promise<Setting[]> {
    const rows = await this.db.select().from(erpSettings);
    return rows.map(r => ({
      key: r.key,
      value: r.value,
      isProvisional: r.isProvisional,
      ownerRole: r.ownerRole,
      updatedBy: r.updatedBy,
      updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
    }));
  }

  async putSetting(setting: Setting): Promise<Setting> {
    await this.db
      .insert(erpSettings)
      .values({
        key: setting.key,
        value: setting.value,
        isProvisional: setting.isProvisional,
        ownerRole: setting.ownerRole,
        updatedBy: setting.updatedBy,
      })
      .onDuplicateKeyUpdate({
        set: {
          value: setting.value,
          isProvisional: setting.isProvisional,
          ownerRole: setting.ownerRole,
          updatedBy: setting.updatedBy,
        },
      });
    return setting;
  }

  async appendRevision(revision: EntryRevision): Promise<void> {
    await this.db.insert(erpEntryRevisions).values({
      id: revision.id,
      entryId: revision.entryId,
      version: revision.version,
      before: revision.before,
      after: revision.after,
      reason: revision.reason,
      actor: revision.actor,
      at: new Date(revision.at),
    });
  }

  async listRevisions(entryId: string): Promise<EntryRevision[]> {
    const rows = await this.db
      .select()
      .from(erpEntryRevisions)
      .where(eq(erpEntryRevisions.entryId, entryId))
      .orderBy(asc(erpEntryRevisions.version));
    return rows.map(r => ({
      id: r.id,
      entryId: r.entryId,
      version: r.version,
      before: r.before as Partial<Entry> | null,
      after: r.after as Partial<Entry> | null,
      reason: r.reason,
      actor: r.actor,
      at: r.at.toISOString(),
    }));
  }

  async appendApproval(approval: Approval): Promise<void> {
    await this.db
      .insert(erpApprovals)
      .values({ ...approval, at: new Date(approval.at) });
  }

  async listApprovals(entryId: string): Promise<Approval[]> {
    const rows = await this.db
      .select()
      .from(erpApprovals)
      .where(eq(erpApprovals.entryId, entryId))
      .orderBy(asc(erpApprovals.at));
    return rows.map(r => ({ ...r, at: r.at.toISOString() }));
  }

  async appendAudit(log: AuditLog): Promise<void> {
    await this.db.insert(erpAuditLogs).values({
      id: log.id,
      tableName: log.table,
      rowId: log.rowId,
      action: log.action,
      before: log.before,
      after: log.after,
      actor: log.actor,
      ip: log.ip,
      at: new Date(log.at),
    });
  }

  async listAudit(
    filter: { table?: string; rowId?: string } = {}
  ): Promise<AuditLog[]> {
    const clauses = [];
    if (filter.table) clauses.push(eq(erpAuditLogs.tableName, filter.table));
    if (filter.rowId) clauses.push(eq(erpAuditLogs.rowId, filter.rowId));
    const rows = await (clauses.length
      ? this.db
          .select()
          .from(erpAuditLogs)
          .where(and(...clauses))
          .orderBy(asc(erpAuditLogs.at))
      : this.db.select().from(erpAuditLogs).orderBy(asc(erpAuditLogs.at)));
    return rows.map(r => ({
      id: r.id,
      table: r.tableName,
      rowId: r.rowId,
      action: r.action,
      before: r.before,
      after: r.after,
      actor: r.actor,
      ip: r.ip,
      at: r.at.toISOString(),
    }));
  }

  async appendJournal(journal: Journal): Promise<void> {
    await this.db.insert(erpJournals).values({
      id: journal.id,
      entryId: journal.entryId,
      journalDate: journal.journalDate,
      memo: journal.memo,
      auto: journal.auto,
      reversedBy: journal.reversedBy,
    });
    if (journal.lines.length > 0) {
      await this.db.insert(erpJournalLines).values(journal.lines);
    }
  }

  async listJournals(entryId?: string): Promise<Journal[]> {
    const heads = await (entryId
      ? this.db
          .select()
          .from(erpJournals)
          .where(eq(erpJournals.entryId, entryId))
      : this.db.select().from(erpJournals));
    if (heads.length === 0) return [];
    const ids = heads.map(h => h.id);
    const lines = await this.db
      .select()
      .from(erpJournalLines)
      .where(inArray(erpJournalLines.journalId, ids));
    return heads.map(h => ({
      ...h,
      lines: lines.filter(l => l.journalId === h.id).map(l => ({ ...l })),
    }));
  }
}
