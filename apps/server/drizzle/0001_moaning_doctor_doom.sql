ALTER TABLE "model_configs" ADD COLUMN "last_tested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "model_configs" ADD COLUMN "last_test_status" text;--> statement-breakpoint
ALTER TABLE "model_configs" ADD COLUMN "last_test_error" text;