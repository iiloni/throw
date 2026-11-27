ALTER TABLE "github_deliveries" ADD COLUMN "signal_key" text;--> statement-breakpoint
ALTER TABLE "github_deliveries" ADD COLUMN "signal" jsonb;--> statement-breakpoint
CREATE INDEX "github_deliveries_connection_id_signal_key_index" ON "github_deliveries" USING btree ("connection_id","signal_key") WHERE "github_deliveries"."signal_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "task_github_links_head" ON "task_github_links" USING btree ("project_id","repo","kind","head_sha","branch");