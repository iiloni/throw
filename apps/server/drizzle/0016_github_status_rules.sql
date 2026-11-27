ALTER TABLE "github_connections" ADD COLUMN "pr_draft_opened_status_id" uuid;--> statement-breakpoint
ALTER TABLE "github_connections" ADD COLUMN "pr_ready_for_review_status_id" uuid;--> statement-breakpoint
ALTER TABLE "github_connections" ADD COLUMN "pr_merged_status_id" uuid;--> statement-breakpoint
ALTER TABLE "github_connections" ADD COLUMN "pr_closed_status_id" uuid;--> statement-breakpoint
ALTER TABLE "github_connections" ADD COLUMN "issue_closed_status_id" uuid;--> statement-breakpoint
ALTER TABLE "github_connections" ADD CONSTRAINT "github_connections_pr_draft_opened_status_id_statuses_id_fk" FOREIGN KEY ("pr_draft_opened_status_id") REFERENCES "public"."statuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_connections" ADD CONSTRAINT "github_connections_pr_ready_for_review_status_id_statuses_id_fk" FOREIGN KEY ("pr_ready_for_review_status_id") REFERENCES "public"."statuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_connections" ADD CONSTRAINT "github_connections_pr_merged_status_id_statuses_id_fk" FOREIGN KEY ("pr_merged_status_id") REFERENCES "public"."statuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_connections" ADD CONSTRAINT "github_connections_pr_closed_status_id_statuses_id_fk" FOREIGN KEY ("pr_closed_status_id") REFERENCES "public"."statuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_connections" ADD CONSTRAINT "github_connections_issue_closed_status_id_statuses_id_fk" FOREIGN KEY ("issue_closed_status_id") REFERENCES "public"."statuses"("id") ON DELETE set null ON UPDATE no action;