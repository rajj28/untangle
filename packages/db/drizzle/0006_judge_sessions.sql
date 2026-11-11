CREATE TABLE IF NOT EXISTS "judge_sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"network_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "judge_sessions" ADD CONSTRAINT "judge_sessions_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "networks"("id") ON DELETE no action ON UPDATE no action;
