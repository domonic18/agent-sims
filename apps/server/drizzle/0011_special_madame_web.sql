ALTER TABLE "memories" ALTER COLUMN "embedding" SET DATA TYPE vector(2048);--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "game_minutes" integer;