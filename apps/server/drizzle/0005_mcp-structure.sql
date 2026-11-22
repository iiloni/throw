CREATE TABLE "mcp_structure_operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "position" text;--> statement-breakpoint
ALTER TABLE "mcp_structure_operations" ADD CONSTRAINT "mcp_structure_operations_token_id_mcp_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."mcp_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_structure_operations_token_id_index" ON "mcp_structure_operations" USING btree ("token_id");