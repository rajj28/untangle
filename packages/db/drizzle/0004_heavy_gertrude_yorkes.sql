ALTER TABLE "approvals" DROP CONSTRAINT "approvals_status_check";--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "blocked_rule" text;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "blocked_excerpt" text;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_status_check" CHECK ("approvals"."status" in ('pending', 'approved', 'rejected', 'executed', 'failed', 'blocked'));