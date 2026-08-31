CREATE TABLE `erp_contract` (
	`id` varchar(36) NOT NULL,
	`code` varchar(32) NOT NULL,
	`partyId` varchar(36),
	`projectId` varchar(36),
	`amountTotal` bigint,
	`installments` json,
	`paymentTermsDays` int,
	`paymentTermsText` varchar(200),
	`driveUrl` text,
	`isAgency` boolean NOT NULL DEFAULT false,
	CONSTRAINT `erp_contract_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_contract_code_uq` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `erp_debt_schedule` (
	`id` varchar(36) NOT NULL,
	`debtId` varchar(36) NOT NULL,
	`dueDate` date NOT NULL,
	`principal` bigint NOT NULL DEFAULT 0,
	`interest` bigint NOT NULL DEFAULT 0,
	CONSTRAINT `erp_debt_schedule_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `erp_debt` (
	`id` varchar(36) NOT NULL,
	`code` varchar(32) NOT NULL,
	`creditor` varchar(200) NOT NULL,
	`principal` bigint,
	`rate` int,
	`maturityDate` date,
	`repayType` varchar(60),
	`isRelatedParty` boolean NOT NULL DEFAULT false,
	`monthlyInterest` bigint,
	`term` enum('단기','장기') NOT NULL,
	`docUrl` text,
	CONSTRAINT `erp_debt_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_debt_code_uq` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `erp_intake` (
	`id` varchar(36) NOT NULL,
	`source` enum('slack','bank','card','hometax','manual','migration') NOT NULL,
	`sourceRef` varchar(190),
	`raw` text NOT NULL,
	`parsed` json,
	`status` varchar(30) NOT NULL DEFAULT 'waiting',
	`failReason` varchar(300),
	`entryId` varchar(36),
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `erp_intake_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_intake_source_uq` UNIQUE(`source`,`sourceRef`)
);
--> statement-breakpoint
CREATE TABLE `erp_notification_rule` (
	`id` varchar(36) NOT NULL,
	`trigger` varchar(120) NOT NULL,
	`tier` varchar(10) NOT NULL,
	`recipients` json,
	`channel` varchar(40) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`blockedReason` varchar(300),
	CONSTRAINT `erp_notification_rule_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `erp_notification` (
	`id` varchar(36) NOT NULL,
	`ruleId` varchar(36) NOT NULL,
	`title` varchar(300) NOT NULL,
	`body` text NOT NULL,
	`screen` varchar(60),
	`sentAt` timestamp,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `erp_notification_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `erp_party` (
	`id` varchar(36) NOT NULL,
	`name` varchar(200) NOT NULL,
	`bizNo` varchar(20),
	`bankAccount` varchar(64),
	`vatMode` varchar(20),
	`contact` varchar(120),
	`memo` text,
	CONSTRAINT `erp_party_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `erp_period` (
	`ym` varchar(7) NOT NULL,
	`status` enum('open','closing','closed') NOT NULL DEFAULT 'open',
	`closedBy` varchar(64),
	`closedAt` timestamp,
	`blockers` json,
	CONSTRAINT `erp_period_ym` PRIMARY KEY(`ym`)
);
--> statement-breakpoint
CREATE TABLE `erp_project` (
	`id` varchar(36) NOT NULL,
	`code` varchar(32) NOT NULL,
	`name` varchar(200) NOT NULL,
	`buCode` enum('IP','NET','COM','GLV','CMN'),
	`status` varchar(40) NOT NULL DEFAULT '진행',
	`budget` bigint,
	`startDate` date,
	`endDate` date,
	CONSTRAINT `erp_project_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_project_code_uq` UNIQUE(`code`)
);
--> statement-breakpoint
ALTER TABLE `erp_entry` ADD `invoiceDate` date;--> statement-breakpoint
CREATE INDEX `erp_debt_schedule_debt_idx` ON `erp_debt_schedule` (`debtId`);--> statement-breakpoint
CREATE INDEX `erp_notification_rule_idx` ON `erp_notification` (`ruleId`);