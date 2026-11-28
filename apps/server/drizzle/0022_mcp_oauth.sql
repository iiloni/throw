CREATE TABLE "oauth_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"redirects" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_requests" (
	"browser_digest" text NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_name" text NOT NULL,
	"redirect" text NOT NULL,
	"resource" text NOT NULL,
	"challenge" text NOT NULL,
	"state" text,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_tickets" (
	"digest" text PRIMARY KEY NOT NULL,
	"grant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"redirect" text,
	"challenge" text,
	"used" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_tokens" ALTER COLUMN "digest" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD COLUMN "client_name" text;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD COLUMN "resource" text;--> statement-breakpoint
ALTER TABLE "oauth_tickets" ADD CONSTRAINT "oauth_tickets_grant_id_mcp_tokens_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_tickets_grant_id_index" ON "oauth_tickets" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "oauth_tickets_expires_at_index" ON "oauth_tickets" USING btree ("expires_at");