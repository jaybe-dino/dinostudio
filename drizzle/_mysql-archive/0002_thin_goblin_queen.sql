CREATE TABLE `erp_account` (
	`code` varchar(8) NOT NULL,
	`name` varchar(120) NOT NULL,
	`type` varchar(40) NOT NULL,
	`parentCode` varchar(8),
	`cfSection` enum('영업','투자','재무','현금유출없음','판정불가') NOT NULL,
	`isOpex` boolean NOT NULL DEFAULT false,
	`defaultPriority` enum('P0','P1','P2','P3'),
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `erp_account_code` PRIMARY KEY(`code`)
);
--> statement-breakpoint
CREATE TABLE `erp_approval` (
	`id` varchar(36) NOT NULL,
	`entryId` varchar(36) NOT NULL,
	`step` int NOT NULL DEFAULT 1,
	`approverRole` enum('대표','부대표','재무','사업부리더','담당자','외부세무') NOT NULL,
	`actor` varchar(64) NOT NULL,
	`decision` enum('approve','reject','hold') NOT NULL,
	`reason` text,
	`at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `erp_approval_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `erp_attachment` (
	`id` varchar(36) NOT NULL,
	`entryId` varchar(36) NOT NULL,
	`kind` varchar(40) NOT NULL,
	`url` text NOT NULL,
	`uploadedBy` varchar(64) NOT NULL,
	`at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `erp_attachment_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `erp_audit_log` (
	`id` varchar(36) NOT NULL,
	`tableName` varchar(64) NOT NULL,
	`rowId` varchar(64) NOT NULL,
	`action` varchar(40) NOT NULL,
	`before` json,
	`after` json,
	`actor` varchar(64) NOT NULL,
	`ip` varchar(64),
	`at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `erp_audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `erp_day_snapshot` (
	`date` date NOT NULL,
	`open` bigint,
	`inSum` bigint NOT NULL DEFAULT 0,
	`outSum` bigint NOT NULL DEFAULT 0,
	`close` bigint,
	`sheetOpen` bigint,
	`sheetClose` bigint,
	`note` text,
	`isMigrated` boolean NOT NULL DEFAULT true,
	CONSTRAINT `erp_day_snapshot_date` PRIMARY KEY(`date`)
);
--> statement-breakpoint
CREATE TABLE `erp_entry` (
	`id` varchar(36) NOT NULL,
	`code` varchar(32) NOT NULL,
	`parentCode` varchar(32),
	`direction` enum('out','in') NOT NULL,
	`status` enum('undecided','pending','confirmed','rejected','held','superseded','cancelled') NOT NULL,
	`title` varchar(300) NOT NULL DEFAULT '',
	`noteRaw` text,
	`note` text,
	`amount` bigint,
	`amountCandidate` bigint,
	`amountSupply` bigint,
	`amountVat` bigint,
	`currency` varchar(3) NOT NULL DEFAULT 'KRW',
	`cashDate` date,
	`accrualDate` date,
	`startDate` date,
	`deliverDate` date,
	`requestDate` date,
	`dueDate` date,
	`paidAt` date,
	`accountCode` varchar(8),
	`nature` enum('통과원가','직접원가','공통배부','해당없음','손익아님','미지정'),
	`buCode` enum('IP','NET','COM','GLV','CMN'),
	`projectId` varchar(36),
	`partyId` varchar(36),
	`contractId` varchar(36),
	`priority` enum('P0','P1','P2','P3'),
	`priorityOverride` enum('P0','P1','P2','P3'),
	`priorityReason` text,
	`payMethod` enum('계좌','법인카드','개인카드선결제','현금'),
	`bankAccount` varchar(64),
	`invoiceIssued` boolean,
	`invoiceNo` varchar(64),
	`source` enum('slack','bank','card','hometax','manual','migration') NOT NULL,
	`sourceRef` varchar(190),
	`undecidedReason` varchar(300),
	`hasEvidence` boolean NOT NULL DEFAULT false,
	`isPersonal` boolean NOT NULL DEFAULT false,
	`version` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`createdBy` varchar(64) NOT NULL,
	CONSTRAINT `erp_entry_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_entry_code_uq` UNIQUE(`code`),
	CONSTRAINT `erp_entry_source_ref_uq` UNIQUE(`source`,`sourceRef`)
);
--> statement-breakpoint
CREATE TABLE `erp_entry_revision` (
	`id` varchar(36) NOT NULL,
	`entryId` varchar(36) NOT NULL,
	`version` int NOT NULL,
	`before` json,
	`after` json,
	`reason` text,
	`actor` varchar(64) NOT NULL,
	`at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `erp_entry_revision_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `erp_journal_line` (
	`id` varchar(36) NOT NULL,
	`journalId` varchar(36) NOT NULL,
	`accountCode` varchar(8) NOT NULL,
	`debit` bigint NOT NULL DEFAULT 0,
	`credit` bigint NOT NULL DEFAULT 0,
	`buCode` enum('IP','NET','COM','GLV','CMN'),
	`projectId` varchar(36),
	CONSTRAINT `erp_journal_line_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `erp_journal` (
	`id` varchar(36) NOT NULL,
	`entryId` varchar(36) NOT NULL,
	`journalDate` date NOT NULL,
	`memo` text,
	`auto` boolean NOT NULL DEFAULT true,
	`reversedBy` varchar(36),
	CONSTRAINT `erp_journal_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `erp_role_permission` (
	`id` varchar(36) NOT NULL,
	`role` enum('대표','부대표','재무','사업부리더','담당자','외부세무') NOT NULL,
	`resource` varchar(80) NOT NULL,
	`canRead` boolean NOT NULL DEFAULT false,
	`canWrite` boolean NOT NULL DEFAULT false,
	`canApprove` boolean NOT NULL DEFAULT false,
	CONSTRAINT `erp_role_permission_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_role_permission_uq` UNIQUE(`role`,`resource`)
);
--> statement-breakpoint
CREATE TABLE `erp_setting` (
	`key` varchar(80) NOT NULL,
	`value` json,
	`isProvisional` boolean NOT NULL DEFAULT true,
	`ownerRole` enum('대표','부대표','재무','사업부리더','담당자','외부세무'),
	`updatedBy` varchar(64),
	`updatedAt` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_setting_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `erp_user` (
	`id` varchar(36) NOT NULL,
	`email` varchar(320) NOT NULL,
	`name` varchar(120) NOT NULL,
	`role` enum('대표','부대표','재무','사업부리더','담당자','외부세무') NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `erp_user_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_user_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE INDEX `erp_approval_entry_idx` ON `erp_approval` (`entryId`);--> statement-breakpoint
CREATE INDEX `erp_attachment_entry_idx` ON `erp_attachment` (`entryId`);--> statement-breakpoint
CREATE INDEX `erp_audit_log_row_idx` ON `erp_audit_log` (`tableName`,`rowId`);--> statement-breakpoint
CREATE INDEX `erp_entry_cash_date_idx` ON `erp_entry` (`cashDate`);--> statement-breakpoint
CREATE INDEX `erp_entry_status_idx` ON `erp_entry` (`status`);--> statement-breakpoint
CREATE INDEX `erp_entry_revision_entry_idx` ON `erp_entry_revision` (`entryId`);--> statement-breakpoint
CREATE INDEX `erp_journal_line_journal_idx` ON `erp_journal_line` (`journalId`);--> statement-breakpoint
CREATE INDEX `erp_journal_entry_idx` ON `erp_journal` (`entryId`);