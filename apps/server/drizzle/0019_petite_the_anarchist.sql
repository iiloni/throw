CREATE TABLE "github_tag_pushes" (
	"project_id" uuid NOT NULL,
	"repo" text NOT NULL,
	"tag_name" text NOT NULL,
	"pushed_at" timestamp with time zone,
	CONSTRAINT "github_tag_pushes_project_id_repo_tag_name_pk" PRIMARY KEY("project_id","repo","tag_name")
);
--> statement-breakpoint
ALTER TABLE "github_tag_pushes" ADD CONSTRAINT "github_tag_pushes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;