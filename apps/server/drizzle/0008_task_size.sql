ALTER TABLE "tasks" ADD COLUMN "size" smallint;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_size_check" CHECK ("tasks"."size" IS NULL OR "tasks"."size" BETWEEN 1 AND 5);