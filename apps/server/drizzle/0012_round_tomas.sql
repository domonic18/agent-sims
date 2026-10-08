CREATE TABLE "cognition_trace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"game_minutes" integer NOT NULL,
	"trigger_type" text NOT NULL,
	"perception" jsonb,
	"retrieval" jsonb,
	"decision" jsonb NOT NULL,
	"calls" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cognition_trace" ADD CONSTRAINT "cognition_trace_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;