CREATE TABLE "change_feed_generation" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"generation" uuid DEFAULT gen_random_uuid() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment_activity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"before_body" jsonb,
	"after_body" jsonb,
	"user_id" text,
	"via_token_name" text,
	"via_token_id" uuid,
	"txid" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "structure_activity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"project_key" text,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"changes" jsonb NOT NULL,
	"user_id" text,
	"via_token_name" text,
	"via_token_id" uuid,
	"txid" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
DROP INDEX "comments_workspace_id_index";--> statement-breakpoint
DROP INDEX "task_activity_workspace_id_index";--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "via_token_id" uuid;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "txid" "xid8" DEFAULT pg_current_xact_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "task_activity" ADD COLUMN "via_token_id" uuid;--> statement-breakpoint
ALTER TABLE "task_activity" ADD COLUMN "txid" "xid8" DEFAULT pg_current_xact_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "comment_activity" ADD CONSTRAINT "comment_activity_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_activity" ADD CONSTRAINT "comment_activity_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_activity" ADD CONSTRAINT "comment_activity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_activity" ADD CONSTRAINT "structure_activity_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_activity" ADD CONSTRAINT "structure_activity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_activity_workspace_id_txid_id_index" ON "comment_activity" USING btree ("workspace_id","txid","id");--> statement-breakpoint
CREATE INDEX "comment_activity_task_id_index" ON "comment_activity" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "structure_activity_workspace_id_txid_id_index" ON "structure_activity" USING btree ("workspace_id","txid","id");--> statement-breakpoint
CREATE INDEX "comments_workspace_id_txid_id_index" ON "comments" USING btree ("workspace_id","txid","id");--> statement-breakpoint
CREATE INDEX "task_activity_workspace_id_txid_id_index" ON "task_activity" USING btree ("workspace_id","txid","id");
--> statement-breakpoint
INSERT INTO "change_feed_generation" DEFAULT VALUES;
--> statement-breakpoint
-- Existing comments have no edit history. Take their current bodies as the initial version.
INSERT INTO "comment_activity"
  ("id", "workspace_id", "project_id", "task_id", "comment_id", "kind",
   "after_body", "user_id", "via_token_name", "txid", "created_at")
SELECT id, workspace_id, project_id, task_id, id, 'created',
       body, user_id, via_token_name, txid, created_at
FROM "comments";
