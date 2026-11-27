CREATE TABLE "github_releases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"repo" text NOT NULL,
	"tag_name" text NOT NULL,
	"name" text,
	"url" text NOT NULL,
	"target_commitish" text,
	"source" text NOT NULL,
	"is_draft" boolean NOT NULL,
	"is_prerelease" boolean NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_github_releases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"matched_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "github_releases" ADD CONSTRAINT "github_releases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_releases" ADD CONSTRAINT "github_releases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_github_releases" ADD CONSTRAINT "task_github_releases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_github_releases" ADD CONSTRAINT "task_github_releases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_github_releases" ADD CONSTRAINT "task_github_releases_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_github_releases" ADD CONSTRAINT "task_github_releases_release_id_github_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."github_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_releases_workspace_id_index" ON "github_releases" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_releases_project_id_repo_tag_name_index" ON "github_releases" USING btree ("project_id","repo","tag_name");--> statement-breakpoint
CREATE INDEX "task_github_releases_workspace_id_index" ON "task_github_releases" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "task_github_releases_release_id_index" ON "task_github_releases" USING btree ("release_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_github_releases_task_id_release_id_index" ON "task_github_releases" USING btree ("task_id","release_id");