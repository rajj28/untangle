import { zodSchema } from "ai";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { fromMoney } from "@untangle/paypal";
import type { PayPalClient } from "@untangle/paypal";
import type { AgentTool } from "./agent.ts";

/** Toolkit configuration flags, e.g. { invoices: { list: true, get: true } }. */
export type ToolkitActions = Partial<Record<"invoices" | "orders" | "disputes" | "transactions" | "payments" | "insights", Record<string, boolean>>>;

/** Builds one agent's PayPal tools on one business's own PayPal app, enabling only the given actions. */
export type PaypalToolFactory = (businessId: string, actions: ToolkitActions, options?: { prefix?: string; businessName?: string }) => Promise<AgentTool[]>;

function asJson(result: unknown): unknown {
  if (typeof result !== "string") return result;
  try {
    return JSON.parse(result);
  } catch {
    return result;
  }
}

function money(value: unknown): string {
  const amount = value as { value?: string; currency_code?: string } | undefined;
  return amount?.value === undefined ? "" : `$${Number(amount.value).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

/** Short, human lines for the agent console. */
export function summarizeToolResult(name: string, raw: unknown): string {
  // Some toolkit tools answer with plain text or multipart bodies (the QR code is an image); say what happened instead.
  if (name === "generate_invoice_qr_code") return "QR code generated";
  if (name === "send_invoice") return "Invoice sent to the customer";
  if (name === "send_invoice_reminder") return "Reminder sent";
  const result = asJson(raw) as Record<string, unknown> | string | null;
  if (typeof result === "string") return `${name}: ${result.replace(/\s+/g, " ").slice(0, 120)}`;
  if (result === null) return `${name} returned nothing`;
  const items = (result.items ?? result.transaction_details ?? result.disputes) as unknown[] | undefined;
  switch (name) {
    case "list_invoices":
    case "search_invoicing":
      return `Found ${items?.length ?? 0} invoice(s)`;
    case "get_invoice": {
      const detail = result.detail as { invoice_number?: string } | undefined;
      return `${detail?.invoice_number ?? result.id ?? "Invoice"} is ${String(result.status ?? "unknown")}${result.due_amount ? `, ${money(result.due_amount)} due` : ""}`;
    }
    case "create_invoice": {
      const id = String(result.id ?? (typeof result.href === "string" ? result.href.split("/").pop() : "") ?? "");
      return id ? `Created draft invoice ${id}` : "Created a draft invoice";
    }
    case "send_invoice":
      return "Invoice sent to the customer";
    case "send_invoice_reminder":
      return "Reminder sent";
    case "generate_invoice_qr_code":
      return "QR code generated";
    case "list_transactions":
      return `Found ${items?.length ?? 0} recent transaction(s)`;
    case "list_disputes":
      return `${items?.length ?? 0} open dispute(s)`;
    case "get_order":
      return `Order ${String(result.id ?? "")} is ${String(result.status ?? "unknown")}`;
    default:
      return `${name} answered`;
  }
}

/** Gemini accepts most JSON Schema, but not empty `not` branches or null defaults that zod emits. */
export function sanitizeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeSchema);
  if (schema === null || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === "$schema" || (key === "default" && value === null)) continue;
    if (key === "anyOf" && Array.isArray(value)) {
      const kept = value.filter((branch) => !(branch !== null && typeof branch === "object" && "not" in branch)).map(sanitizeSchema);
      if (kept.length === 1) Object.assign(out, kept[0] as Record<string, unknown>);
      else out.anyOf = kept;
      continue;
    }
    out[key] = sanitizeSchema(value);
  }
  return out;
}

/** The real thing: the PayPal Agent Toolkit, signed in as the business's own sandbox app. */
export function toolkitFactory(credentialsFor: (businessId: string) => Promise<{ clientId: string; clientSecret: string }>): PaypalToolFactory {
  return async (businessId, actions, options = {}) => {
    const { clientId, clientSecret } = await credentialsFor(businessId);
    const toolkit = new PayPalAgentToolkit({ clientId, clientSecret, configuration: { actions, context: { sandbox: true } } });
    const tools = toolkit.getTools() as Record<string, { description?: string; parameters: unknown; execute?: (args: unknown, options: unknown) => Promise<unknown> }>;
    return Object.entries(tools).map(([name, tool]) => {
      const schema = sanitizeSchema(zodSchema(tool.parameters as never).jsonSchema) as Record<string, unknown>;
      const execute = tool.execute;
      return {
        name: options.prefix === undefined ? name : `${options.prefix}__${name}`,
        label: `paypal.${name}`,
        description: options.businessName === undefined ? (tool.description ?? name) : `[${options.businessName}'s PayPal account] ${tool.description ?? name}`,
        parameters: schema,
        businessId,
        run: async (args) => {
          if (execute === undefined) throw new Error(`Toolkit tool ${name} cannot run`);
          return asJson(await execute(args, { toolCallId: name, messages: [] }));
        },
        summarize: (result) => summarizeToolResult(name, result),
      } satisfies AgentTool;
    });
  };
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });

/**
 * Offline stand-in with the toolkit's tool names, backed by our own PayPal client (which the
 * simulator answers). Used by the simulator mode and the tests; never in sandbox mode.
 */
export function simulatedFactory(clientFor: (businessId: string) => Promise<PayPalClient>): PaypalToolFactory {
  return async (businessId, actions, options = {}) => {
    const client = await clientFor(businessId);
    const all: Record<string, { flag: [string, string]; description: string; parameters: Record<string, unknown>; run: (args: Record<string, unknown>) => Promise<unknown> }> = {
      list_invoices: {
        flag: ["invoices", "list"], description: "List invoices this business has sent",
        parameters: objectSchema({ page: { type: "number" }, page_size: { type: "number" } }),
        run: async () => client.invoicing.search({}, 1, 100),
      },
      get_invoice: {
        flag: ["invoices", "get"], description: "Get one invoice by id",
        parameters: objectSchema({ invoice_id: { type: "string" } }, ["invoice_id"]),
        run: async (args) => client.invoicing.get(String(args.invoice_id)),
      },
      create_invoice: {
        flag: ["invoices", "create"], description: "Create a draft invoice",
        parameters: objectSchema({ currency_code: { type: "string" }, invoice_date: { type: "string" }, note: { type: "string" }, invoicer_business_name: { type: "string" }, primary_recipients: { type: "array", items: { type: "object" } }, items: { type: "array", items: { type: "object" } }, allow_partial_payment: { type: "boolean" } }, ["currency_code", "primary_recipients", "items"]),
        // The toolkit takes flat fields; PayPal's API (and our client) take the nested invoice, so map like the toolkit does.
        run: async (args) => client.invoicing.createDraft({
          detail: {
            currency_code: String(args.currency_code ?? "USD"),
            ...(typeof args.invoice_date === "string" ? { invoice_date: args.invoice_date } : {}),
            ...(typeof args.note === "string" ? { note: args.note } : {}),
          },
          primary_recipients: (args.primary_recipients ?? []) as never,
          items: (args.items ?? []) as never,
          ...(args.allow_partial_payment === true ? { configuration: { partial_payment: { allow_partial_payment: true } } } : {}),
        }, { idempotencyKey: `agent-${globalThis.crypto.randomUUID()}` }),
      },
      send_invoice: {
        flag: ["invoices", "send"], description: "Send a draft invoice to its recipient",
        parameters: objectSchema({ invoice_id: { type: "string" }, note: { type: "string" } }, ["invoice_id"]),
        run: async (args) => { await client.invoicing.send(String(args.invoice_id), { send_to_recipient: true }); return { sent: true }; },
      },
      cancel_sent_invoice: {
        flag: ["invoices", "cancel"], description: "Cancel a sent invoice",
        parameters: objectSchema({ invoice_id: { type: "string" }, note: { type: "string" }, send_to_recipient: { type: "boolean" } }, ["invoice_id"]),
        run: async (args) => { await client.invoicing.cancel(String(args.invoice_id), { note: String(args.note ?? "") }); return { cancelled: true }; },
      },
      send_invoice_reminder: {
        flag: ["invoices", "sendReminder"], description: "Send a reminder for an unpaid invoice",
        parameters: objectSchema({ invoice_id: { type: "string" }, note: { type: "string" }, subject: { type: "string" } }, ["invoice_id"]),
        run: async (args) => { await client.invoicing.remind(String(args.invoice_id), { note: String(args.note ?? "") }); return { reminded: true }; },
      },
      generate_invoice_qr_code: {
        flag: ["invoices", "generateQRC"], description: "Generate a QR code a customer can scan to pay an invoice",
        parameters: objectSchema({ invoice_id: { type: "string" } }, ["invoice_id"]),
        run: async (args) => ({ invoice_id: args.invoice_id, qr: "simulated" }),
      },
      list_transactions: {
        flag: ["transactions", "list"], description: "List recent PayPal transactions",
        parameters: objectSchema({ start_date: { type: "string" }, end_date: { type: "string" } }),
        run: async () => ({ transaction_details: [] }),
      },
      list_disputes: {
        flag: ["disputes", "list"], description: "List open disputes",
        parameters: objectSchema({}),
        run: async () => ({ items: [] }),
      },
      get_order: {
        flag: ["orders", "get"], description: "Get a PayPal order",
        parameters: objectSchema({ id: { type: "string" } }, ["id"]),
        run: async (args) => client.orders.get(String(args.id)),
      },
    };
    return Object.entries(all)
      .filter(([, tool]) => actions[tool.flag[0] as keyof ToolkitActions]?.[tool.flag[1]] === true)
      .map(([name, tool]) => ({
        name: options.prefix === undefined ? name : `${options.prefix}__${name}`,
        label: `paypal.${name}`,
        description: options.businessName === undefined ? tool.description : `[${options.businessName}'s PayPal account] ${tool.description}`,
        parameters: tool.parameters,
        businessId,
        run: tool.run,
        summarize: (result: unknown) => summarizeToolResult(name, result),
      }));
  };
}

/** Pulls the invoice id out of whatever a create-invoice call returned (object, link or text). */
export function findInvoiceId(value: unknown): string | null {
  // Sandbox ids look like INV2-ABCD-EFGH-IJKL-MNOP; the simulator's like INV2-12.
  const match = JSON.stringify(value ?? "").match(/INV2(?:-[A-Z0-9]+)+/);
  return match?.[0] ?? null;
}

export function invoiceDueMinor(invoice: unknown): number | null {
  const due = (asJson(invoice) as { due_amount?: { value: string; currency_code: string } } | null)?.due_amount;
  return due === undefined ? null : fromMoney(due);
}
