ALTER TABLE "webhook_deliveries" ADD COLUMN "coalesce_key" text;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "fold" jsonb;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "quiet_window_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_waiting" ON "webhook_deliveries" USING btree ("webhook_id","coalesce_key") WHERE "webhook_deliveries"."status" IN ('pending', 'held') AND "webhook_deliveries"."attempts" = 0;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_quiet_window_range" CHECK ("webhooks"."quiet_window_seconds" BETWEEN 0 AND 600);