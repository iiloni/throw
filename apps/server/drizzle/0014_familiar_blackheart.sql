CREATE TABLE "task_github_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"repo" text NOT NULL,
	"kind" text NOT NULL,
	"number" integer NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"review_decision" text,
	"checks_summary" jsonb,
	"branch" text,
	"merge_commit_sha" text,
	"merged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"head_sha" text,
	"source_updated_at" timestamp with time zone,
	"runs" jsonb,
	"reviews" jsonb
);
--> statement-breakpoint
ALTER TABLE "task_github_links" ADD CONSTRAINT "task_github_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_github_links" ADD CONSTRAINT "task_github_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_github_links" ADD CONSTRAINT "task_github_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_github_links_workspace_id_index" ON "task_github_links" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "task_github_links_project_id_repo_kind_number_index" ON "task_github_links" USING btree ("project_id","repo","kind","number");--> statement-breakpoint
CREATE UNIQUE INDEX "task_github_links_item" ON "task_github_links" USING btree ("task_id","repo","kind","number");