CREATE INDEX "invites_created_by_index" ON "invites" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "invites_used_by_index" ON "invites" USING btree ("used_by");