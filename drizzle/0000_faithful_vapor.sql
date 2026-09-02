CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."erp_bu" AS ENUM('IP', 'NET', 'COM', 'GLV', 'CMN');--> statement-breakpoint
CREATE TYPE "public"."erp_cf_section" AS ENUM('영업', '투자', '재무', '현금유출없음', '판정불가');--> statement-breakpoint
CREATE TYPE "public"."erp_debt_term" AS ENUM('단기', '장기');--> statement-breakpoint
CREATE TYPE "public"."erp_decision" AS ENUM('approve', 'reject', 'hold');--> statement-breakpoint
CREATE TYPE "public"."erp_direction" AS ENUM('out', 'in');--> statement-breakpoint
CREATE TYPE "public"."erp_entry_status" AS ENUM('undecided', 'pending', 'confirmed', 'rejected', 'held', 'superseded', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."erp_nature" AS ENUM('통과원가', '직접원가', '공통배부', '해당없음', '손익아님', '미지정');--> statement-breakpoint
CREATE TYPE "public"."erp_pay_method" AS ENUM('계좌', '법인카드', '개인카드선결제', '현금');--> statement-breakpoint
CREATE TYPE "public"."erp_period_status" AS ENUM('open', 'closing', 'closed');--> statement-breakpoint
CREATE TYPE "public"."erp_priority" AS ENUM('P0', 'P1', 'P2', 'P3');--> statement-breakpoint
CREATE TYPE "public"."erp_role" AS ENUM('대표', '부대표', '재무', '사업부리더', '담당자', '외부세무', '외부열람');--> statement-breakpoint
CREATE TYPE "public"."erp_source" AS ENUM('slack', 'bank', 'card', 'hometax', 'manual', 'migration');--> statement-breakpoint
CREATE TYPE "public"."erp_storage" AS ENUM('file', 'link', 'none');--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"company" varchar(200) NOT NULL,
	"solution" varchar(100),
	"message" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
CREATE TABLE "erp_account" (
	"code" varchar(8) PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"type" varchar(40) NOT NULL,
	"parentCode" varchar(8),
	"cfSection" "erp_cf_section" NOT NULL,
	"isOpex" boolean DEFAULT false NOT NULL,
	"defaultPriority" "erp_priority",
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_approval" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"entryId" varchar(36) NOT NULL,
	"step" integer DEFAULT 1 NOT NULL,
	"approverRole" "erp_role" NOT NULL,
	"actor" varchar(64) NOT NULL,
	"decision" "erp_decision" NOT NULL,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_attachment" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"entryId" varchar(36) NOT NULL,
	"kind" varchar(40) NOT NULL,
	"fileName" varchar(300),
	"url" text NOT NULL,
	"storage" "erp_storage" DEFAULT 'link' NOT NULL,
	"reason" text,
	"sizeBytes" bigint,
	"contentType" varchar(120),
	"uploadedBy" varchar(64) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_audit_log" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"tableName" varchar(64) NOT NULL,
	"rowId" varchar(64) NOT NULL,
	"action" varchar(40) NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"actor" varchar(64) NOT NULL,
	"ip" varchar(64),
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_contract" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"code" varchar(32) NOT NULL,
	"partyId" varchar(36),
	"projectId" varchar(36),
	"amountTotal" bigint,
	"installments" jsonb,
	"paymentTermsDays" integer,
	"paymentTermsText" varchar(200),
	"driveUrl" text,
	"isAgency" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_day_snapshot" (
	"date" date PRIMARY KEY NOT NULL,
	"open" bigint,
	"inSum" bigint DEFAULT 0 NOT NULL,
	"outSum" bigint DEFAULT 0 NOT NULL,
	"close" bigint,
	"sheetOpen" bigint,
	"sheetClose" bigint,
	"note" text,
	"isMigrated" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_debt_schedule" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"debtId" varchar(36) NOT NULL,
	"dueDate" date NOT NULL,
	"principal" bigint DEFAULT 0 NOT NULL,
	"interest" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_debt" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"code" varchar(32) NOT NULL,
	"creditor" varchar(200) NOT NULL,
	"principal" bigint,
	"rate" integer,
	"maturityDate" date,
	"repayType" varchar(60),
	"isRelatedParty" boolean DEFAULT false NOT NULL,
	"monthlyInterest" bigint,
	"term" "erp_debt_term" NOT NULL,
	"docUrl" text
);
--> statement-breakpoint
CREATE TABLE "erp_entry" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"code" varchar(32) NOT NULL,
	"parentCode" varchar(32),
	"direction" "erp_direction" NOT NULL,
	"status" "erp_entry_status" NOT NULL,
	"title" varchar(300) DEFAULT '' NOT NULL,
	"noteRaw" text,
	"note" text,
	"amount" bigint,
	"amountCandidate" bigint,
	"amountSupply" bigint,
	"amountVat" bigint,
	"currency" varchar(3) DEFAULT 'KRW' NOT NULL,
	"cashDate" date,
	"accrualDate" date,
	"startDate" date,
	"deliverDate" date,
	"requestDate" date,
	"dueDate" date,
	"paidAt" date,
	"accountCode" varchar(8),
	"nature" "erp_nature",
	"buCode" "erp_bu",
	"projectId" varchar(36),
	"partyId" varchar(36),
	"contractId" varchar(36),
	"priority" "erp_priority",
	"priorityOverride" "erp_priority",
	"priorityReason" text,
	"payMethod" "erp_pay_method",
	"bankAccount" varchar(64),
	"invoiceIssued" boolean,
	"invoiceNo" varchar(64),
	"invoiceDate" date,
	"source" "erp_source" NOT NULL,
	"sourceRef" varchar(190),
	"roundNo" integer,
	"linkedRevenueCode" varchar(32),
	"undecidedReason" varchar(300),
	"hasEvidence" boolean DEFAULT false NOT NULL,
	"isPersonal" boolean DEFAULT false NOT NULL,
	"incomeType" varchar(20),
	"withheldAmount" bigint,
	"principalAmount" bigint,
	"employeeInsurance" bigint,
	"employerInsurance" bigint,
	"amountForeign" bigint,
	"fxRateScaled" bigint,
	"deferralMonths" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"createdBy" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_entry_revision" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"entryId" varchar(36) NOT NULL,
	"version" integer NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"actor" varchar(64) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_intake" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"source" "erp_source" NOT NULL,
	"sourceRef" varchar(190),
	"roundNo" integer,
	"linkedRevenueCode" varchar(32),
	"raw" text NOT NULL,
	"parsed" jsonb,
	"status" varchar(30) DEFAULT 'waiting' NOT NULL,
	"failReason" varchar(300),
	"entryId" varchar(36),
	"receivedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_journal_line" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"journalId" varchar(36) NOT NULL,
	"accountCode" varchar(8) NOT NULL,
	"debit" bigint DEFAULT 0 NOT NULL,
	"credit" bigint DEFAULT 0 NOT NULL,
	"buCode" "erp_bu",
	"projectId" varchar(36)
);
--> statement-breakpoint
CREATE TABLE "erp_journal" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"entryId" varchar(36) NOT NULL,
	"journalNo" varchar(16),
	"journalDate" date NOT NULL,
	"memo" text,
	"auto" boolean DEFAULT true NOT NULL,
	"reversedBy" varchar(36)
);
--> statement-breakpoint
CREATE TABLE "erp_notification_rule" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"trigger" varchar(120) NOT NULL,
	"tier" varchar(10) NOT NULL,
	"recipients" jsonb,
	"channel" varchar(40) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"blockedReason" varchar(300)
);
--> statement-breakpoint
CREATE TABLE "erp_notification" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"ruleId" varchar(36) NOT NULL,
	"title" varchar(300) NOT NULL,
	"body" text NOT NULL,
	"screen" varchar(60),
	"sentAt" timestamp with time zone,
	"readAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_party" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"bizNo" varchar(20),
	"bankAccount" varchar(64),
	"vatMode" varchar(20),
	"incomeType" varchar(20),
	"contact" varchar(120),
	"memo" text
);
--> statement-breakpoint
CREATE TABLE "erp_period" (
	"ym" varchar(7) PRIMARY KEY NOT NULL,
	"status" "erp_period_status" DEFAULT 'open' NOT NULL,
	"closedBy" varchar(64),
	"closedAt" timestamp with time zone,
	"blockers" jsonb
);
--> statement-breakpoint
CREATE TABLE "erp_project" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" varchar(200) NOT NULL,
	"buCode" "erp_bu",
	"status" varchar(40) DEFAULT '진행' NOT NULL,
	"budget" bigint,
	"contractAmount" bigint,
	"costBudget" bigint,
	"startDate" date,
	"endDate" date
);
--> statement-breakpoint
CREATE TABLE "erp_role_permission" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"role" "erp_role" NOT NULL,
	"resource" varchar(80) NOT NULL,
	"canRead" boolean DEFAULT false NOT NULL,
	"canWrite" boolean DEFAULT false NOT NULL,
	"canApprove" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_setting" (
	"key" varchar(80) PRIMARY KEY NOT NULL,
	"value" jsonb,
	"isProvisional" boolean DEFAULT true NOT NULL,
	"ownerRole" "erp_role",
	"updatedBy" varchar(64),
	"updatedAt" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "erp_user" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"name" varchar(120) NOT NULL,
	"role" "erp_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "erp_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "erp_approval_entry_idx" ON "erp_approval" USING btree ("entryId");--> statement-breakpoint
CREATE INDEX "erp_attachment_entry_idx" ON "erp_attachment" USING btree ("entryId");--> statement-breakpoint
CREATE INDEX "erp_audit_log_row_idx" ON "erp_audit_log" USING btree ("tableName","rowId");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_contract_code_uq" ON "erp_contract" USING btree ("code");--> statement-breakpoint
CREATE INDEX "erp_debt_schedule_debt_idx" ON "erp_debt_schedule" USING btree ("debtId");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_debt_code_uq" ON "erp_debt" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_entry_code_uq" ON "erp_entry" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_entry_source_ref_uq" ON "erp_entry" USING btree ("source","sourceRef");--> statement-breakpoint
CREATE INDEX "erp_entry_cash_date_idx" ON "erp_entry" USING btree ("cashDate");--> statement-breakpoint
CREATE INDEX "erp_entry_status_idx" ON "erp_entry" USING btree ("status");--> statement-breakpoint
CREATE INDEX "erp_entry_revision_entry_idx" ON "erp_entry_revision" USING btree ("entryId");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_intake_source_uq" ON "erp_intake" USING btree ("source","sourceRef");--> statement-breakpoint
CREATE INDEX "erp_journal_line_journal_idx" ON "erp_journal_line" USING btree ("journalId");--> statement-breakpoint
CREATE INDEX "erp_journal_entry_idx" ON "erp_journal" USING btree ("entryId");--> statement-breakpoint
CREATE INDEX "erp_notification_rule_idx" ON "erp_notification" USING btree ("ruleId");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_project_code_uq" ON "erp_project" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_role_permission_uq" ON "erp_role_permission" USING btree ("role","resource");