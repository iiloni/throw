CREATE TABLE "task_relations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_task_id" uuid NOT NULL,
	"target_task_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_relations_not_self" CHECK ("task_relations"."source_task_id" <> "task_relations"."target_task_id"),
	CONSTRAINT "task_relations_kind_check" CHECK ("task_relations"."kind" IN ('blocks', 'duplicates', 'relates_to')),
	CONSTRAINT "task_relations_relates_to_order" CHECK ("task_relations"."kind" <> 'relates_to' OR "task_relations"."source_task_id" < "task_relations"."target_task_id")
);
--> statement-breakpoint
ALTER TABLE "task_relations" ADD CONSTRAINT "task_relations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_relations" ADD CONSTRAINT "task_relations_source_task_id_tasks_id_fk" FOREIGN KEY ("source_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_relations" ADD CONSTRAINT "task_relations_target_task_id_tasks_id_fk" FOREIGN KEY ("target_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_relations_workspace_id_index" ON "task_relations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "task_relations_source_task_id_index" ON "task_relations" USING btree ("source_task_id");--> statement-breakpoint
CREATE INDEX "task_relations_target_task_id_index" ON "task_relations" USING btree ("target_task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_relations_source_task_id_target_task_id_kind_index" ON "task_relations" USING btree ("source_task_id","target_task_id","kind");