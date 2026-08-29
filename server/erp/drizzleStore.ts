/**
 * MySQL(Drizzle) 저장소. DATABASE_URL이 설정된 환경에서 InMemoryLedgerStore를 대체한다.
 * DELETE는 어디에도 없다 (원칙 9) — 취소는 -C 상계 전표로만 한다.
 */
import { ACCOUNTS } from "@shared/erp";
import type {
  Account,
  Approval,
  AuditLog,
  Contract,
  Debt,
  DebtSchedule,
  Intake,
  Party,
  Period,
  Project,
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
  erpContracts,
  erpDebtSchedules,
  erpDebts,
  erpIntakes,
  erpJournalLines,
  erpJournals,
  erpParties,
  erpPeriods,
  erpProjects,
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
    invoiceDate: row.invoiceDate,
    source: row.source,
    sourceRef: row.sourceRef,
    roundNo: row.roundNo,
    linkedRevenueCode: row.linkedRevenueCode,
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

  /* ─── 2차 · 3차 마스터 ─────────────────────────────────────────────────── */

  async listParties(): Promise<Party[]> {
    return (
      await this.db.select().from(erpParties).orderBy(asc(erpParties.name))
    ).map(r => ({ ...r }));
  }

  async upsertParty(party: Party): Promise<Party> {
    await this.db
      .insert(erpParties)
      .values(party)
      .onDuplicateKeyUpdate({ set: { ...party } });
    return party;
  }

  async listProjects(): Promise<Project[]> {
    return (
      await this.db.select().from(erpProjects).orderBy(asc(erpProjects.code))
    ).map(r => ({ ...r }));
  }

  async upsertProject(project: Project): Promise<Project> {
    await this.db
      .insert(erpProjects)
      .values(project)
      .onDuplicateKeyUpdate({ set: { ...project } });
    return project;
  }

  async listContracts(): Promise<Contract[]> {
    const rows = await this.db
      .select()
      .from(erpContracts)
      .orderBy(asc(erpContracts.code));
    return rows.map(r => ({
      ...r,
      installments: (r.installments ?? []) as Contract["installments"],
    }));
  }

  async upsertContract(contract: Contract): Promise<Contract> {
    await this.db
      .insert(erpContracts)
      .values({ ...contract, installments: contract.installments })
      .onDuplicateKeyUpdate({
        set: { ...contract, installments: contract.installments },
      });
    return contract;
  }

  async listDebts(): Promise<Debt[]> {
    return (
      await this.db.select().from(erpDebts).orderBy(asc(erpDebts.code))
    ).map(r => ({ ...r }));
  }

  async upsertDebt(debt: Debt): Promise<Debt> {
    await this.db
      .insert(erpDebts)
      .values(debt)
      .onDuplicateKeyUpdate({ set: { ...debt } });
    return debt;
  }

  async listDebtSchedules(): Promise<DebtSchedule[]> {
    return (
      await this.db
        .select()
        .from(erpDebtSchedules)
        .orderBy(asc(erpDebtSchedules.dueDate))
    ).map(r => ({
      ...r,
    }));
  }

  async upsertDebtSchedule(schedule: DebtSchedule): Promise<DebtSchedule> {
    await this.db
      .insert(erpDebtSchedules)
      .values(schedule)
      .onDuplicateKeyUpdate({ set: { ...schedule } });
    return schedule;
  }

  async listIntakes(): Promise<Intake[]> {
    const rows = await this.db
      .select()
      .from(erpIntakes)
      .orderBy(asc(erpIntakes.receivedAt));
    return rows.map(r => ({
      ...r,
      parsed: (r.parsed ?? null) as Record<string, unknown> | null,
      receivedAt: r.receivedAt.toISOString(),
    }));
  }

  async upsertIntake(intake: Intake): Promise<Intake> {
    const row = { ...intake, receivedAt: new Date(intake.receivedAt) };
    await this.db
      .insert(erpIntakes)
      .values(row)
      .onDuplicateKeyUpdate({ set: row });
    return intake;
  }

  async listPeriods(): Promise<Period[]> {
    const rows = await this.db
      .select()
      .from(erpPeriods)
      .orderBy(asc(erpPeriods.ym));
    return rows.map(r => ({
      ym: r.ym,
      status: r.status,
      closedBy: r.closedBy,
      closedAt: r.closedAt ? r.closedAt.toISOString() : null,
      blockers: (r.blockers ?? []) as string[],
    }));
  }

  async upsertPeriod(period: Period): Promise<Period> {
    const row = {
      ym: period.ym,
      status: period.status,
      closedBy: period.closedBy,
      closedAt: period.closedAt ? new Date(period.closedAt) : null,
      blockers: period.blockers,
    };
    await this.db
      .insert(erpPeriods)
      .values(row)
      .onDuplicateKeyUpdate({ set: row });
    return period;
  }
}
