CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"icon" text,
	"color" text
);
--> statement-breakpoint
CREATE TABLE "task_tags" (
	"task_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	CONSTRAINT "task_tags_task_id_tag_id_pk" PRIMARY KEY("task_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "primary_tag_id" uuid;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_parent_id_tags_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tags_workspace_id_index" ON "tags" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "tags_project_id_parent_id_index" ON "tags" USING btree ("project_id","parent_id");--> statement-breakpoint
CREATE INDEX "tags_parent_id_index" ON "tags" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_project_id_color_index" ON "tags" USING btree ("project_id","color") WHERE "tags"."color" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "task_tags_workspace_id_index" ON "task_tags" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "task_tags_project_id_index" ON "task_tags" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "task_tags_tag_id_index" ON "task_tags" USING btree ("tag_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_primary_tag_id_tags_id_fk" FOREIGN KEY ("primary_tag_id") REFERENCES "public"."tags"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_primary_tag_id_index" ON "tasks" USING btree ("primary_tag_id");