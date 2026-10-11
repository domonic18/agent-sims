CREATE TABLE "map_agent_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"map_id" uuid,
	"title" text DEFAULT '新对话' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "map_agent_threads" ADD CONSTRAINT "map_agent_threads_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "map_agent_threads_map_idx" ON "map_agent_threads" USING btree ("map_id","updated_at");