CREATE TABLE "asset_issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"ref_slug" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"ref_id" integer,
	"context" jsonb,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "asset_issues_status_idx" ON "asset_issues" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_issues_open_dedupe_uq" ON "asset_issues" USING btree ("dedupe_key") WHERE status = 'open';