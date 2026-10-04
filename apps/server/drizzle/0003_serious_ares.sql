CREATE TABLE "worlds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "world_id" uuid;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "gender" text DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;