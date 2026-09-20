CREATE TABLE "erp_settlement" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"entryId" varchar(36) NOT NULL,
	"settledOn" date NOT NULL,
	"amount" bigint NOT NULL,
	"bankAccount" varchar(64),
	"bankRef" varchar(128),
	"note" text,
	"actor" varchar(64) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"voidedAt" timestamp with time zone,
	"voidedBy" varchar(64),
	"voidReason" text
);
--> statement-breakpoint
CREATE INDEX "erp_settlement_entry_idx" ON "erp_settlement" USING btree ("entryId");--> statement-breakpoint
CREATE INDEX "erp_settlement_on_idx" ON "erp_settlement" USING btree ("settledOn");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_settlement_bankref_uq" ON "erp_settlement" USING btree ("bankRef") WHERE "bankRef" is not null and "voidedAt" is null;