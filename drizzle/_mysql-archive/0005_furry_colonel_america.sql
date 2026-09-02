ALTER TABLE `erp_attachment` ADD `fileName` varchar(300);--> statement-breakpoint
ALTER TABLE `erp_attachment` ADD `storage` enum('file','link') DEFAULT 'link' NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_attachment` ADD `sizeBytes` bigint;--> statement-breakpoint
ALTER TABLE `erp_attachment` ADD `contentType` varchar(120);