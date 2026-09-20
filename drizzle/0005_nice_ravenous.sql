ALTER TABLE "erp_notification" ADD COLUMN "sendAttempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "erp_notification" ADD COLUMN "lastError" text;--> statement-breakpoint
ALTER TABLE "erp_notification" ADD COLUMN "lastAttemptAt" timestamp with time zone;