import { sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  date,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// Table definitions can't take bound parameters, so the allowed values are written in as literals.
function oneOf(column: SQLWrapper, values: readonly string[]) {
  const literals = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
  return sql`${column} in (${sql.raw(literals)})`;
}

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({ dataType: () => "bytea" });

export const userRoles = ["owner", "accountant", "operator"] as const;
export const paypalEnvironments = ["sandbox", "live"] as const;
export const evidenceKinds = ["image", "pdf", "audio", "text", "paypal_invoice"] as const;
export const evidenceStatuses = ["pending", "extracted", "failed"] as const;
export const claimSides = ["creditor", "debtor"] as const;
export const claimStatuses = ["open", "matched", "rejected"] as const;
export const obligationStatuses = [
  "claimed",
  "matched",
  "negotiating",
  "confirmed",
  "invoiced",
  "partially_settled",
  "settled",
  "disputed",
  "cancelled",
] as const;
export const negotiationStatuses = ["open", "agreed", "escalated", "resolved"] as const;
export const roundStatuses = ["planned", "consenting", "executing", "settling", "closed", "failed"] as const;
export const setoffStatuses = ["pending", "recorded", "compensated", "failed"] as const;
export const transferInstruments = ["checkout", "payouts", "invoice"] as const;
export const transferStatuses = [
  "planned",
  "ready",
  "awaiting_payer",
  "pending_paypal",
  "committed",
  "failed",
  "unwound",
] as const;
export const transferLegStatuses = ["pending", "recorded", "compensated"] as const;
export const consentMethods = ["passkey", "policy", "demo"] as const;
export const operationStatuses = ["pending", "in_flight", "succeeded", "failed_retryable", "failed_permanent"] as const;
export const jobStatuses = ["queued", "running", "done", "failed"] as const;

export const networks = pgTable("networks", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const businesses = pgTable("businesses", {
  id: uuid("id").defaultRandom().primaryKey(),
  networkId: uuid("network_id").notNull().references(() => networks.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  paypalPayerId: text("paypal_payer_id"),
  verified: boolean("verified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  networkEmailUnique: unique("businesses_network_id_email_unique").on(table.networkId, table.email),
}));

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  businessId: uuid("business_id").references(() => businesses.id),
  role: text("role").notNull(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  paypalSub: text("paypal_sub"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  roleCheck: check("users_role_check", oneOf(table.role, userRoles)),
  paypalSubUnique: unique("users_paypal_sub_unique").on(table.paypalSub),
}));

export const passkeys = pgTable("passkeys", {
  credentialId: text("credential_id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  publicKey: bytea("public_key").notNull(),
  counter: bigint("counter", { mode: "number" }).notNull().default(0),
  transports: text("transports").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paypalAccounts = pgTable("paypal_accounts", {
  businessId: uuid("business_id").primaryKey().references(() => businesses.id, { onDelete: "cascade" }),
  environment: text("environment").notNull(),
  clientId: text("client_id").notNull(),
  clientSecretEnc: bytea("client_secret_enc").notNull(),
  webhookId: text("webhook_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  environmentCheck: check("paypal_accounts_environment_check", oneOf(table.environment, paypalEnvironments)),
}));

export const evidence = pgTable("evidence", {
  id: uuid("id").defaultRandom().primaryKey(),
  businessId: uuid("business_id").notNull().references(() => businesses.id),
  kind: text("kind").notNull(),
  mime: text("mime").notNull(),
  sha256: text("sha256").notNull(),
  size: integer("size").notNull(),
  bytes: bytea("bytes"),
  status: text("status").notNull().default("pending"),
  extraction: jsonb("extraction"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  kindCheck: check("evidence_kind_check", oneOf(table.kind, evidenceKinds)),
  statusCheck: check("evidence_status_check", oneOf(table.status, evidenceStatuses)),
  businessShaUnique: unique("evidence_business_id_sha256_unique").on(table.businessId, table.sha256),
}));

export const obligations = pgTable("obligations", {
  id: uuid("id").defaultRandom().primaryKey(),
  networkId: uuid("network_id").notNull().references(() => networks.id),
  debtorId: uuid("debtor_id").notNull().references(() => businesses.id),
  creditorId: uuid("creditor_id").notNull().references(() => businesses.id),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  outstandingMinor: bigint("outstanding_minor", { mode: "number" }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  dueOn: date("due_on", { mode: "string" }),
  description: text("description"),
  status: text("status").notNull(),
  paypalInvoiceId: text("paypal_invoice_id"),
  debtorConfirmedAt: timestamp("debtor_confirmed_at", { withTimezone: true }),
  creditorConfirmedAt: timestamp("creditor_confirmed_at", { withTimezone: true }),
  /** When an obligation is disputed via a signed confirmation link, the reason given. */
  disputeReason: text("dispute_reason"),
  protected: boolean("protected").notNull().default(false),
  version: integer("version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  statusCheck: check("obligations_status_check", oneOf(table.status, obligationStatuses)),
  amountPositive: check("obligations_amount_minor_positive", sql`${table.amountMinor} > 0`),
  outstandingRange: check("obligations_outstanding_minor_range", sql`${table.outstandingMinor} between 0 and ${table.amountMinor}`),
  distinctBusinesses: check("obligations_distinct_businesses", sql`${table.debtorId} <> ${table.creditorId}`),
  paypalInvoiceUnique: unique("obligations_paypal_invoice_id_unique").on(table.paypalInvoiceId),
  networkStatusIndex: index("obligations_network_id_status_idx").on(table.networkId, table.status),
}));

export const claims = pgTable("claims", {
  id: uuid("id").defaultRandom().primaryKey(),
  evidenceId: uuid("evidence_id").references(() => evidence.id),
  claimantId: uuid("claimant_id").notNull().references(() => businesses.id),
  side: text("side").notNull(),
  counterpartyName: text("counterparty_name").notNull(),
  counterpartyEmail: text("counterparty_email"),
  counterpartyId: uuid("counterparty_id").references(() => businesses.id),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  issuedOn: date("issued_on", { mode: "string" }),
  dueOn: date("due_on", { mode: "string" }),
  reference: text("reference"),
  description: text("description"),
  /** The words in the evidence that prove the amount (or the spoken words, for audio). */
  quote: text("quote"),
  confidence: real("confidence").notNull(),
  status: text("status").notNull().default("open"),
  obligationId: uuid("obligation_id").references(() => obligations.id),
  approvalId: uuid("approval_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sideCheck: check("claims_side_check", oneOf(table.side, claimSides)),
  statusCheck: check("claims_status_check", oneOf(table.status, claimStatuses)),
  amountPositive: check("claims_amount_minor_positive", sql`${table.amountMinor} > 0`),
}));

export const negotiations = pgTable("negotiations", {
  id: uuid("id").defaultRandom().primaryKey(),
  obligationId: uuid("obligation_id").notNull().references(() => obligations.id),
  status: text("status").notNull(),
  agreedMinor: bigint("agreed_minor", { mode: "number" }),
  transcript: jsonb("transcript").notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  statusCheck: check("negotiations_status_check", oneOf(table.status, negotiationStatuses)),
}));

export const policies = pgTable("policies", {
  businessId: uuid("business_id").notNull().references(() => businesses.id),
  version: integer("version").notNull(),
  rules: jsonb("rules").notNull(),
  signature: text("signature"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ name: "policies_business_id_version_pk", columns: [table.businessId, table.version] }),
}));

export const rounds = pgTable("rounds", {
  id: uuid("id").defaultRandom().primaryKey(),
  networkId: uuid("network_id").notNull().references(() => networks.id),
  status: text("status").notNull(),
  plan: jsonb("plan"),
  planHash: text("plan_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  statusCheck: check("rounds_status_check", oneOf(table.status, roundStatuses)),
}));

export const setoffs = pgTable("setoffs", {
  id: uuid("id").defaultRandom().primaryKey(),
  roundId: uuid("round_id").notNull().references(() => rounds.id),
  obligationId: uuid("obligation_id").notNull().references(() => obligations.id),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  status: text("status").notNull().default("pending"),
  paypalPaymentId: text("paypal_payment_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  statusCheck: check("setoffs_status_check", oneOf(table.status, setoffStatuses)),
  amountPositive: check("setoffs_amount_minor_positive", sql`${table.amountMinor} > 0`),
  roundObligationUnique: unique("setoffs_round_id_obligation_id_unique").on(table.roundId, table.obligationId),
}));

export const transfers = pgTable("transfers", {
  id: uuid("id").defaultRandom().primaryKey(),
  roundId: uuid("round_id").notNull().references(() => rounds.id),
  payerId: uuid("payer_id").notNull().references(() => businesses.id),
  payeeId: uuid("payee_id").notNull().references(() => businesses.id),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  instrument: text("instrument"),
  status: text("status").notNull().default("planned"),
  paypalOrderId: text("paypal_order_id"),
  paypalCaptureId: text("paypal_capture_id"),
  payoutBatchId: text("payout_batch_id"),
  payoutItemId: text("payout_item_id"),
  settlementInvoiceId: text("settlement_invoice_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  instrumentCheck: check("transfers_instrument_check", sql`${table.instrument} is null or ${oneOf(table.instrument, transferInstruments)}`),
  statusCheck: check("transfers_status_check", oneOf(table.status, transferStatuses)),
  amountPositive: check("transfers_amount_minor_positive", sql`${table.amountMinor} > 0`),
  distinctBusinesses: check("transfers_distinct_businesses", sql`${table.payerId} <> ${table.payeeId}`),
}));

export const transferLegs = pgTable("transfer_legs", {
  transferId: uuid("transfer_id").notNull().references(() => transfers.id, { onDelete: "cascade" }),
  obligationId: uuid("obligation_id").notNull().references(() => obligations.id),
  position: integer("position").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  status: text("status").notNull().default("pending"),
  paypalPaymentId: text("paypal_payment_id"),
}, (table) => ({
  pk: primaryKey({ name: "transfer_legs_transfer_id_obligation_id_pk", columns: [table.transferId, table.obligationId] }),
  statusCheck: check("transfer_legs_status_check", oneOf(table.status, transferLegStatuses)),
  amountPositive: check("transfer_legs_amount_minor_positive", sql`${table.amountMinor} > 0`),
}));

export const statements = pgTable("statements", {
  roundId: uuid("round_id").notNull().references(() => rounds.id),
  businessId: uuid("business_id").notNull().references(() => businesses.id),
  statementHash: text("statement_hash").notNull(),
  body: jsonb("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ name: "statements_round_id_business_id_pk", columns: [table.roundId, table.businessId] }),
}));

export const consents = pgTable("consents", {
  id: uuid("id").defaultRandom().primaryKey(),
  roundId: uuid("round_id").notNull().references(() => rounds.id),
  businessId: uuid("business_id").notNull().references(() => businesses.id),
  statementHash: text("statement_hash").notNull(),
  method: text("method").notNull(),
  signature: text("signature").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  methodCheck: check("consents_method_check", oneOf(table.method, consentMethods)),
  roundBusinessUnique: unique("consents_round_id_business_id_unique").on(table.roundId, table.businessId),
}));

export const operations = pgTable("operations", {
  idemKey: text("idem_key").primaryKey(),
  kind: text("kind").notNull(),
  refId: text("ref_id").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  paypalRef: text("paypal_ref"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  statusCheck: check("operations_status_check", oneOf(table.status, operationStatuses)),
  statusIndex: index("operations_status_idx").on(table.status),
}));

export const judgeSessions = pgTable("judge_sessions", {
  token: text("token").primaryKey(),
  networkId: uuid("network_id").notNull().references(() => networks.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const events = pgTable("events", {
  seq: bigserial("seq", { mode: "number" }).primaryKey(),
  id: uuid("id").notNull().defaultRandom(),
  stream: text("stream").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  actor: text("actor").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
}, (table) => ({
  idUnique: unique("events_id_unique").on(table.id),
  hashUnique: unique("events_hash_unique").on(table.hash),
  streamSeqIndex: index("events_stream_seq_idx").on(table.stream, table.seq),
}));

export const webhookInbox = pgTable("webhook_inbox", {
  paypalEventId: text("paypal_event_id").primaryKey(),
  businessId: uuid("business_id").references(() => businesses.id),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  verified: boolean("verified").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
});

export const jobs = pgTable("jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull(),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  statusCheck: check("jobs_status_check", oneOf(table.status, jobStatuses)),
  statusRunAtIndex: index("jobs_status_run_at_idx").on(table.status, table.runAt),
}));

export const agentRunStatuses = ["running", "waiting", "completed", "failed"] as const;
export const approvalStatuses = ["pending", "approved", "rejected", "executed", "failed", "blocked"] as const;

/** One orchestrated piece of agent work; its steps live in the event log under stream `agent:<id>`. */
export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  networkId: uuid("network_id").notNull().references(() => networks.id),
  kind: text("kind").notNull(),
  goal: text("goal").notNull(),
  status: text("status").notNull().default("running"),
  summary: text("summary"),
  stats: jsonb("stats").notNull().default(sql`'{}'::jsonb`),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => ({
  statusCheck: check("agent_runs_status_check", oneOf(table.status, agentRunStatuses)),
  networkStartedIndex: index("agent_runs_network_id_started_at_idx").on(table.networkId, table.startedAt),
}));

/** An action an agent wants to take that a business owner must approve first. */
export const approvals = pgTable("approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id").references(() => agentRuns.id),
  networkId: uuid("network_id").notNull().references(() => networks.id),
  businessId: uuid("business_id").notNull().references(() => businesses.id),
  agent: text("agent").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("pending"),
  result: jsonb("result"),
  /** When the deterministic guard blocks a proposal: the name of the rule that fired. */
  blockedRule: text("blocked_rule"),
  /** The offending excerpt from the evidence that tripped the rule. */
  blockedExcerpt: text("blocked_excerpt"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
}, (table) => ({
  statusCheck: check("approvals_status_check", oneOf(table.status, approvalStatuses)),
  networkStatusIndex: index("approvals_network_id_status_idx").on(table.networkId, table.status),
}));

export const aiCache = pgTable("ai_cache", {
  inputSha256: text("input_sha256").notNull(),
  model: text("model").notNull(),
  schemaVersion: integer("schema_version").notNull(),
  output: jsonb("output").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ name: "ai_cache_input_sha256_model_schema_version_pk", columns: [table.inputSha256, table.model, table.schemaVersion] }),
}));
