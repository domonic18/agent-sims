CREATE TABLE "character_impressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"about_id" uuid NOT NULL,
	"content" text NOT NULL,
	"game_minutes" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_impressions_pair_key" UNIQUE("character_id","about_id")
);
--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "source_ids" jsonb;--> statement-breakpoint
ALTER TABLE "character_impressions" ADD CONSTRAINT "character_impressions_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_impressions" ADD CONSTRAINT "character_impressions_about_id_characters_id_fk" FOREIGN KEY ("about_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;