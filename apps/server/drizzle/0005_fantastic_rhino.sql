CREATE TABLE "asset_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"level" integer NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "asset_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"file_path" text NOT NULL,
	"source" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"grid_w" integer DEFAULT 1 NOT NULL,
	"grid_h" integer DEFAULT 1 NOT NULL,
	"anchor" text DEFAULT 'bottom-center' NOT NULL,
	"anim_config" jsonb,
	"tier" integer DEFAULT 1 NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"checksum" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_parent_id_asset_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."asset_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_category_id_asset_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."asset_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_category_idx" ON "assets" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "assets_status_idx" ON "assets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "assets_checksum_idx" ON "assets" USING btree ("checksum");