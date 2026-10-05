CREATE TABLE "admin_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"status_code" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tech_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"level" text NOT NULL,
	"source" text NOT NULL,
	"message" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"character_id" text,
	"tick" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "admin_audit_username_idx" ON "admin_audit_logs" USING btree ("username");--> statement-breakpoint
CREATE INDEX "admin_audit_created_idx" ON "admin_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "tech_logs_level_idx" ON "tech_logs" USING btree ("level");--> statement-breakpoint
CREATE INDEX "tech_logs_created_idx" ON "tech_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "world_events_type_idx" ON "world_events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "world_events_character_idx" ON "world_events" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "world_events_created_idx" ON "world_events" USING btree ("created_at");