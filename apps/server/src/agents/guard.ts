import { eq } from "drizzle-orm";
import { businesses, claims, evidence } from "@untangle/db";
import type { AppContext } from "../context.ts";

/**
 * The deterministic guard: "the AI proposes, fixed rules decide."
 *
 * Every AI proposal is run through this module before it can be approved. The
 * rules never trust the model or the document text; they only check hard facts
 * against the network and the evidence. A proposal that trips any rule is
 * stored as a blocked approval so a person must review it.
 */

export const GUARD_RULES = {
  payeeNetwork: "payee_must_be_network_business",
  foreignPayee: "no_payee_account_from_evidence",
  amountMatch: "amount_must_match_evidence",
  actionOnly: "action_propose_obligation_only",
  injection: "injection_suspected",
} as const;

export interface ProposalGuardInput {
  /** The verbatim text of the evidence document (or the closest proxy we have). */
  evidenceText: string;
  /** Emails of every business currently in the network. */
  networkEmails: readonly string[];
  /** Names of every business currently in the network. */
  networkNames: readonly string[];
  /** The email of the business that would receive the payment/settlement. */
  payeeEmail: string | null;
  /** Whether the payee is an existing network business. */
  payeeInNetwork: boolean;
  /** The proposed amount, in minor units. */
  amountMinor: number;
}

export interface ProposalGuardResult {
  ok: boolean;
  /** The name of the first rule that fired, when blocked. */
  rule: string | null;
  /** The offending excerpt from the evidence, when blocked. */
  excerpt: string | null;
  /** Every rule that fired, with its excerpt. */
  reasons: { rule: string; excerpt: string }[];
}

const INSTRUCTION_PATTERNS: { rule: string; re: RegExp }[] = [
  { rule: GUARD_RULES.injection, re: /\bignore\s+(all\s+)?(previous|prior|earlier)\s+(rules|instructions)\b/i },
  { rule: GUARD_RULES.injection, re: /\bsystem\s+(note|prompt|instruction)\b/i },
  { rule: GUARD_RULES.injection, re: /\b(you\s+are|as\s+an)\s+an?\s+ai\b/i },
  { rule: GUARD_RULES.injection, re: /\bapprove\s+(every|all)\s+settlement/i },
  { rule: GUARD_RULES.injection, re: /\b(send|pay|wire|transfer)\s+the\s+(balance|amount|rest)\b/i },
  { rule: GUARD_RULES.actionOnly, re: /\bapprove\s+(this|every|all)\s+(settlement|transaction|invoice|payment)\b/i },
  { rule: GUARD_RULES.actionOnly, re: /\bpay\s+(this|the)\s+invoice\s+without\b/i },
  { rule: GUARD_RULES.actionOnly, re: /\bdo\s+not\s+(ask|require)\s+(for\s+)?approval\b/i },
  { rule: GUARD_RULES.actionOnly, re: /\bskip\s+(the\s+)?(review|approval|verification)\b/i },
];

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const ACCOUNT_RE = /\b(?:account|payout|payouts?|iban|routing|swift|wallet)\s*[:#-]?\s*[A-Z0-9._%+-]+/gi;

/** Turn every "$1,234.56" / "USD 1234.56" style amount in text into minor units. */
function amountsInText(text: string): number[] {
  const out = new Set<number>();
  const money = /(?:\$|\bUSD\b)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)|(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g;
  let match: RegExpExecArray | null;
  while ((match = money.exec(text)) !== null) {
    const raw = (match[1] ?? match[2] ?? "").replace(/,/g, "");
    const parts = raw.split(".");
    const major = Number(parts[0]);
    if (Number.isFinite(major)) {
      const cents = Number((parts[1] ?? "").padEnd(2, "0"));
      const minor = major * 100 + (Number.isFinite(cents) ? cents : 0);
      if (Number.isSafeInteger(minor) && minor > 0) out.add(minor);
    }
  }
  return [...out];
}

function excerptAround(text: string, re: RegExp): string {
  const match = re.exec(text);
  if (match === null) return text.slice(0, 160);
  const start = Math.max(0, match.index - 40);
  const end = Math.min(text.length, match.index + match[0].length + 40);
  return text.slice(start, end);
}

/**
 * Run the deterministic rules. Returns every violation; a proposal is only
 * `ok` when no rule fires.
 */
export function guardProposal(input: ProposalGuardInput): ProposalGuardResult {
  const reasons: { rule: string; excerpt: string }[] = [];
  const text = input.evidenceText;

  // Rule: payee must be an existing network business.
  if (!input.payeeInNetwork) {
    reasons.push({ rule: GUARD_RULES.payeeNetwork, excerpt: `payee ${input.payeeEmail ?? "the payee"} is not a network business` });
  }

  // Rule: no payee email/account taken from the document text. Any account-like
  // destination named in the evidence that is not one of the network's own
  // businesses is a hijack attempt.
  for (const email of text.match(EMAIL_RE) ?? []) {
    if (!input.networkEmails.includes(email.toLowerCase())) {
      reasons.push({ rule: GUARD_RULES.foreignPayee, excerpt: excerptAround(text, new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")) });
    }
  }
  const accountMatch = text.match(ACCOUNT_RE);
  if (accountMatch !== null) {
    for (const account of accountMatch) {
      if (!input.networkEmails.some((email) => email.toLowerCase().includes(account.toLowerCase()))) {
        reasons.push({ rule: GUARD_RULES.foreignPayee, excerpt: excerptAround(text, new RegExp(account.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")) });
      }
    }
  }

  // Rule: the amount must match an amount found in the evidence.
  const evidenceAmounts = amountsInText(text);
  if (evidenceAmounts.length > 0 && !evidenceAmounts.includes(input.amountMinor)) {
    reasons.push({ rule: GUARD_RULES.amountMatch, excerpt: `proposed ${input.amountMinor} not found in evidence (${evidenceAmounts.join(", ")})` });
  }

  // Rule: instruction-like text.
  for (const { rule, re } of INSTRUCTION_PATTERNS) {
    if (re.test(text)) reasons.push({ rule, excerpt: excerptAround(text, re) });
  }

  const first = reasons[0] ?? null;
  return {
    ok: reasons.length === 0,
    rule: first?.rule ?? null,
    excerpt: first?.excerpt ?? null,
    reasons,
  };
}

/**
 * Resolve the evidence attached to an approval (through its claim) and run the
 * guard on it. Approvals with no evidence attached can't be judged on document
 * text, so they pass the text rules and are only constrained by the structural
 * rules (payee must be a network business, amount sanity).
 */
export async function guardApproval(ctx: AppContext, approval: { kind: string; businessId: string; payload: Record<string, unknown> }): Promise<ProposalGuardResult> {
  const payload = approval.payload;
  const [claim] = await ctx.db.select({ id: claims.id, evidenceId: claims.evidenceId }).from(claims)
    .where(eq(claims.id, String(payload.claimId ?? ""))).limit(1);

  let evidenceText = "";
  if (claim !== undefined && claim.evidenceId !== null) {
    const [evidenceRow] = await ctx.db.select({ extraction: evidence.extraction }).from(evidence)
      .where(eq(evidence.id, claim.evidenceId)).limit(1);
    const extraction = (evidenceRow?.extraction ?? {}) as { transcript?: string; summary?: string };
    evidenceText = `${extraction.transcript ?? ""}\n${extraction.summary ?? ""}`;
  }

  const networkRows = await ctx.db.select({ id: businesses.id, email: businesses.email }).from(businesses);
  const networkEmails = networkRows.map((row) => row.email.toLowerCase());
  const payeeId = typeof payload.creditorId === "string" ? payload.creditorId : approval.businessId;
  const payeeRow = networkRows.find((row) => row.id === payeeId);
  const payeeEmail = payeeRow?.email ?? null;
  const payeeInNetwork = payeeRow !== undefined;

  return guardProposal({
    evidenceText,
    networkEmails,
    networkNames: [],
    payeeEmail,
    payeeInNetwork,
    amountMinor: typeof payload.amountMinor === "number" ? payload.amountMinor : 0,
  });
}
