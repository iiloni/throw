CREATE TABLE "statuses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"position" text NOT NULL,
	"is_default" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_activity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" text,
	"kind" text NOT NULL,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"description" jsonb,
	"description_version" uuid,
	"status_id" uuid NOT NULL,
	"priority" smallint NOT NULL,
	"position" text NOT NULL,
	"parent_id" uuid,
	"closed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "key" text;--> statement-breakpoint
-- Projects made before keys existed get P1, P2... in workspace order; a key can be changed.
UPDATE "projects" SET "key" = numbered."key" FROM (
	SELECT "id", 'P' || row_number() OVER (PARTITION BY "workspace_id" ORDER BY "position" COLLATE "C", "id") AS "key"
	FROM "projects"
) AS numbered WHERE "projects"."id" = numbered."id";--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "task_counter" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "priority_names" jsonb DEFAULT '["","","","",""]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "statuses" ADD CONSTRAINT "statuses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statuses" ADD CONSTRAINT "statuses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_id_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."statuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_id_tasks_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "statuses_workspace_id_index" ON "statuses" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "statuses_project_id_index" ON "statuses" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "statuses_project_id_category_index" ON "statuses" USING btree ("project_id","category") WHERE "statuses"."is_default";--> statement-breakpoint
CREATE INDEX "task_activity_workspace_id_index" ON "task_activity" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "task_activity_task_id_index" ON "task_activity" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "tasks_workspace_id_index" ON "tasks" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_project_id_number_index" ON "tasks" USING btree ("project_id","number");--> statement-breakpoint
CREATE INDEX "tasks_status_id_index" ON "tasks" USING btree ("status_id");--> statement-breakpoint
CREATE INDEX "tasks_parent_id_index" ON "tasks" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_workspace_id_key_index" ON "projects" USING btree ("workspace_id","key");--> statement-breakpoint
-- Every project keeps a status in each category, so existing projects get the starter set.
INSERT INTO "statuses" ("id", "workspace_id", "project_id", "name", "category", "position", "is_default")
SELECT gen_random_uuid(), "projects"."workspace_id", "projects"."id", starter."name", starter."category", 'a0', true
FROM "projects" CROSS JOIN (VALUES
	('Backlog', 'backlog'), ('In progress', 'active'), ('Done', 'done'), ('Cancelled', 'cancelled')
) AS starter("name", "category");
