CREATE TABLE "sys_configs" (
	"id" integer PRIMARY KEY NOT NULL,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
