ALTER TABLE "cognition_trace" ADD COLUMN "world_id" uuid;--> statement-breakpoint
ALTER TABLE "cognition_trace" ADD COLUMN "want_id" text;--> statement-breakpoint
ALTER TABLE "token_usage" ADD COLUMN "world_id" uuid;--> statement-breakpoint
ALTER TABLE "world_events" ADD COLUMN "world_id" uuid;--> statement-breakpoint
ALTER TABLE "cognition_trace" ADD CONSTRAINT "cognition_trace_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_events" ADD CONSTRAINT "world_events_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cognition_trace_world_char_idx" ON "cognition_trace" USING btree ("world_id","character_id");--> statement-breakpoint
CREATE INDEX "cognition_trace_want_idx" ON "cognition_trace" USING btree ("want_id");--> statement-breakpoint
CREATE INDEX "world_events_world_idx" ON "world_events" USING btree ("world_id");--> statement-breakpoint
UPDATE "cognition_trace" SET "world_id" = c."world_id" FROM "characters" c WHERE c."id" = "cognition_trace"."character_id";--> statement-breakpoint
UPDATE "world_events" SET "world_id" = c."world_id" FROM "characters" c WHERE c."id"::text = "world_events"."character_id";--> statement-breakpoint
UPDATE "token_usage" SET "world_id" = c."world_id" FROM "characters" c WHERE c."id" = "token_usage"."character_id";
