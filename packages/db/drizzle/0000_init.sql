CREATE TABLE "ai_cache" (
	"input_sha256" text NOT NULL,
	"model" text NOT NULL,
	"schema_version" integer NOT NULL,
	"output" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_cache_input_sha256_model_schema_version_pk" PRIMARY KEY("input_sha256","model","schema_version")
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"paypal_payer_id" text,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "businesses_network_id_email_unique" UNIQUE("network_id","email")
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_id" uuid,
	"claimant_id" uuid NOT NULL,
	"side" text NOT NULL,
	"counterparty_name" text NOT NULL,
	"counterparty_email" text,
	"counterparty_id" uuid,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"issued_on" date,
	"due_on" date,
	"reference" text,
	"confidence" real NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"obligation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claims_side_check" CHECK ("claims"."side" in ('creditor', 'debtor')),
	CONSTRAINT "claims_status_check" CHECK ("claims"."status" in ('open', 'matched', 'rejected')),
	CONSTRAINT "claims_amount_minor_positive" CHECK ("claims"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"statement_hash" text NOT NULL,
	"method" text NOT NULL,
	"signature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consents_round_id_business_id_unique" UNIQUE("round_id","business_id"),
	CONSTRAINT "consents_method_check" CHECK ("consents"."method" in ('passkey', 'policy', 'demo'))
);
--> statement-breakpoint
CREATE TABLE "events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"stream" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"actor" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "events_id_unique" UNIQUE("id"),
	CONSTRAINT "events_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"bytes" "bytea",
	"status" text DEFAULT 'pending' NOT NULL,
	"extraction" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_business_id_sha256_unique" UNIQUE("business_id","sha256"),
	CONSTRAINT "evidence_kind_check" CHECK ("evidence"."kind" in ('image', 'pdf', 'audio', 'text', 'paypal_invoice')),
	CONSTRAINT "evidence_status_check" CHECK ("evidence"."status" in ('pending', 'extracted', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('queued', 'running', 'done', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "negotiations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"obligation_id" uuid NOT NULL,
	"status" text NOT NULL,
	"agreed_minor" bigint,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "negotiations_status_check" CHECK ("negotiations"."status" in ('open', 'agreed', 'escalated', 'resolved'))
);
--> statement-breakpoint
CREATE TABLE "networks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid NOT NULL,
	"debtor_id" uuid NOT NULL,
	"creditor_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"outstanding_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"due_on" date,
	"status" text NOT NULL,
	"paypal_invoice_id" text,
	"debtor_confirmed_at" timestamp with time zone,
	"creditor_confirmed_at" timestamp with time zone,
	"protected" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "obligations_paypal_invoice_id_unique" UNIQUE("paypal_invoice_id"),
	CONSTRAINT "obligations_status_check" CHECK ("obligations"."status" in ('claimed', 'matched', 'negotiating', 'confirmed', 'invoiced', 'partially_settled', 'settled', 'disputed', 'cancelled')),
	CONSTRAINT "obligations_amount_minor_positive" CHECK ("obligations"."amount_minor" > 0),
	CONSTRAINT "obligations_outstanding_minor_range" CHECK ("obligations"."outstanding_minor" between 0 and "obligations"."amount_minor"),
	CONSTRAINT "obligations_distinct_businesses" CHECK ("obligations"."debtor_id" <> "obligations"."creditor_id")
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"idem_key" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"paypal_ref" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operations_status_check" CHECK ("operations"."status" in ('pending', 'in_flight', 'succeeded', 'failed_retryable', 'failed_permanent'))
);
--> statement-breakpoint
CREATE TABLE "passkeys" (
	"credential_id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"public_key" "bytea" NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paypal_accounts" (
	"business_id" uuid PRIMARY KEY NOT NULL,
	"environment" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_enc" "bytea" NOT NULL,
	"webhook_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paypal_accounts_environment_check" CHECK ("paypal_accounts"."environment" in ('sandbox', 'live'))
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"business_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"rules" jsonb NOT NULL,
	"signature" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policies_business_id_version_pk" PRIMARY KEY("business_id","version")
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid NOT NULL,
	"status" text NOT NULL,
	"plan" jsonb,
	"plan_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rounds_status_check" CHECK ("rounds"."status" in ('planned', 'consenting', 'executing', 'settling', 'closed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "setoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"obligation_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paypal_payment_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setoffs_round_id_obligation_id_unique" UNIQUE("round_id","obligation_id"),
	CONSTRAINT "setoffs_status_check" CHECK ("setoffs"."status" in ('pending', 'recorded', 'compensated', 'failed')),
	CONSTRAINT "setoffs_amount_minor_positive" CHECK ("setoffs"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "statements" (
	"round_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"statement_hash" text NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statements_round_id_business_id_pk" PRIMARY KEY("round_id","business_id")
);
--> statement-breakpoint
CREATE TABLE "transfer_legs" (
	"transfer_id" uuid NOT NULL,
	"obligation_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"amount_minor" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paypal_payment_id" text,
	CONSTRAINT "transfer_legs_transfer_id_obligation_id_pk" PRIMARY KEY("transfer_id","obligation_id"),
	CONSTRAINT "transfer_legs_status_check" CHECK ("transfer_legs"."status" in ('pending', 'recorded', 'compensated')),
	CONSTRAINT "transfer_legs_amount_minor_positive" CHECK ("transfer_legs"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"payer_id" uuid NOT NULL,
	"payee_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"instrument" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"paypal_order_id" text,
	"paypal_capture_id" text,
	"payout_batch_id" text,
	"payout_item_id" text,
	"settlement_invoice_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfers_instrument_check" CHECK ("transfers"."instrument" is null or "transfers"."instrument" in ('checkout', 'payouts', 'invoice')),
	CONSTRAINT "transfers_status_check" CHECK ("transfers"."status" in ('planned', 'ready', 'awaiting_payer', 'pending_paypal', 'committed', 'failed', 'unwound')),
	CONSTRAINT "transfers_amount_minor_positive" CHECK ("transfers"."amount_minor" > 0),
	CONSTRAINT "transfers_distinct_businesses" CHECK ("transfers"."payer_id" <> "transfers"."payee_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid,
	"role" text NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"paypal_sub" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_paypal_sub_unique" UNIQUE("paypal_sub"),
	CONSTRAINT "users_role_check" CHECK ("users"."role" in ('owner', 'accountant', 'operator'))
);
--> statement-breakpoint
CREATE TABLE "webhook_inbox" (
	"paypal_event_id" text PRIMARY KEY NOT NULL,
	"business_id" uuid,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"verified" boolean NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_claimant_id_businesses_id_fk" FOREIGN KEY ("claimant_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_counterparty_id_businesses_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_obligation_id_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."obligations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiations" ADD CONSTRAINT "negotiations_obligation_id_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."obligations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_debtor_id_businesses_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_creditor_id_businesses_id_fk" FOREIGN KEY ("creditor_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paypal_accounts" ADD CONSTRAINT "paypal_accounts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoffs" ADD CONSTRAINT "setoffs_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setoffs" ADD CONSTRAINT "setoffs_obligation_id_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."obligations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_legs" ADD CONSTRAINT "transfer_legs_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_legs" ADD CONSTRAINT "transfer_legs_obligation_id_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."obligations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_payer_id_businesses_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_payee_id_businesses_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_inbox" ADD CONSTRAINT "webhook_inbox_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_stream_seq_idx" ON "events" USING btree ("stream","seq");--> statement-breakpoint
CREATE INDEX "jobs_status_run_at_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "obligations_network_id_status_idx" ON "obligations" USING btree ("network_id","status");--> statement-breakpoint
CREATE INDEX "operations_status_idx" ON "operations" USING btree ("status");