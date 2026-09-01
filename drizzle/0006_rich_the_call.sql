ALTER TABLE `erp_approval` MODIFY COLUMN `approverRole` enum('대표','부대표','재무','사업부리더','담당자','외부세무','외부열람') NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_attachment` MODIFY COLUMN `storage` enum('file','link','none') NOT NULL DEFAULT 'link';--> statement-breakpoint
ALTER TABLE `erp_role_permission` MODIFY COLUMN `role` enum('대표','부대표','재무','사업부리더','담당자','외부세무','외부열람') NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_setting` MODIFY COLUMN `ownerRole` enum('대표','부대표','재무','사업부리더','담당자','외부세무','외부열람');--> statement-breakpoint
ALTER TABLE `erp_user` MODIFY COLUMN `role` enum('대표','부대표','재무','사업부리더','담당자','외부세무','외부열람') NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_attachment` ADD `reason` text;--> statement-breakpoint
ALTER TABLE `erp_entry` ADD `incomeType` varchar(20);--> statement-breakpoint
ALTER TABLE `erp_entry` ADD `withheldAmount` bigint;--> statement-breakpoint
ALTER TABLE `erp_entry` ADD `principalAmount` bigint;--> statement-breakpoint
ALTER TABLE `erp_entry` ADD `employeeInsurance` bigint;--> statement-breakpoint
ALTER TABLE `erp_entry` ADD `employerInsurance` bigint;--> statement-breakpoint
ALTER TABLE `erp_entry` ADD `amountForeign` bigint;--> statement-breakpoint
ALTER TABLE `erp_entry` ADD `fxRateScaled` bigint;--> statement-breakpoint
ALTER TABLE `erp_entry` ADD `deferralMonths` int;--> statement-breakpoint
ALTER TABLE `erp_journal` ADD `journalNo` varchar(16);--> statement-breakpoint
ALTER TABLE `erp_party` ADD `incomeType` varchar(20);