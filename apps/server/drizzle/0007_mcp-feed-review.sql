DROP INDEX "comment_activity_workspace_id_txid_id_index";--> statement-breakpoint
DROP INDEX "structure_activity_workspace_id_txid_id_index";--> statement-breakpoint
DROP INDEX "task_activity_workspace_id_txid_id_index";--> statement-breakpoint
ALTER TABLE "comment_activity" ADD COLUMN "feed_order" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "structure_activity" ADD COLUMN "feed_order" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "task_activity" ADD COLUMN "feed_order" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "task_activity" ADD COLUMN "feed_position" jsonb;--> statement-breakpoint
CREATE INDEX "comment_activity_workspace_id_txid_feed_order_id_index" ON "comment_activity" USING btree ("workspace_id","txid","feed_order","id");--> statement-breakpoint
CREATE INDEX "structure_activity_workspace_id_txid_feed_order_id_index" ON "structure_activity" USING btree ("workspace_id","txid","feed_order","id");--> statement-breakpoint
CREATE INDEX "task_activity_workspace_id_txid_feed_order_id_index" ON "task_activity" USING btree ("workspace_id","txid","feed_order","id");
--> statement-breakpoint
-- Imported rows from before the feed share the first migration's transaction ID.
-- Their server timestamps are the only available arrival order.
WITH ordered AS (
  SELECT id, source,
         row_number() OVER (PARTITION BY txid ORDER BY created_at, id, source COLLATE "C") AS ordinal
  FROM (
    SELECT id, txid, created_at, 'task'::text AS source FROM task_activity
    UNION ALL
    SELECT id, txid, created_at, 'comment' FROM comment_activity
    UNION ALL
    SELECT id, txid, created_at, 'structure' FROM structure_activity
  ) AS events
), tasks_ordered AS (
  UPDATE task_activity AS a SET feed_order = ordered.ordinal
  FROM ordered WHERE ordered.source = 'task' AND a.id = ordered.id
), comments_ordered AS (
  UPDATE comment_activity AS a SET feed_order = ordered.ordinal
  FROM ordered WHERE ordered.source = 'comment' AND a.id = ordered.id
)
UPDATE structure_activity AS a SET feed_order = ordered.ordinal
FROM ordered WHERE ordered.source = 'structure' AND a.id = ordered.id;
