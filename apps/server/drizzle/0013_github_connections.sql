CREATE TABLE "github_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"repository" text NOT NULL,
	"auth_mode" text DEFAULT 'webhook' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"webhook_token" text NOT NULL,
	"encrypted_webhook_secret" text NOT NULL,
	"encrypted_token" text,
	"created_by" text,
	"last_delivery_at" timestamp with time zone,
	"last_delivery_id" text,
	"last_delivery_event" text,
	"last_delivery_status" text,
	"last_delivery_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_connections_projectId_unique" UNIQUE("project_id"),
	CONSTRAINT "github_connections_webhookToken_unique" UNIQUE("webhook_token"),
	CONSTRAINT "github_connections_auth_mode" CHECK ("github_connections"."auth_mode" IN ('webhook', 'token')),
	CONSTRAINT "github_connections_token_mode" CHECK (("github_connections"."auth_mode" = 'token') = ("github_connections"."encrypted_token" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "github_deliveries" (
	"connection_id" uuid NOT NULL,
	"delivery_id" text NOT NULL,
	"event" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_deliveries_connection_id_delivery_id_pk" PRIMARY KEY("connection_id","delivery_id")
);
--> statement-breakpoint
ALTER TABLE "github_connections" ADD CONSTRAINT "github_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_connections" ADD CONSTRAINT "github_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_connections" ADD CONSTRAINT "github_connections_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_deliveries" ADD CONSTRAINT "github_deliveries_connection_id_github_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."github_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_connections_workspace_id_index" ON "github_connections" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "github_deliveries_received_at_index" ON "github_deliveries" USING btree ("received_at");