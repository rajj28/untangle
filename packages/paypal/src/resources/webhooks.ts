import type { HttpCore } from "../http.ts";
import type { Webhook, WebhookEvent } from "../types.ts";

export type { WebhookEvent } from "../types.ts";

const SIGNATURE_HEADERS = [
  "paypal-auth-algo",
  "paypal-cert-url",
  "paypal-transmission-id",
  "paypal-transmission-sig",
  "paypal-transmission-time",
] as const;

function getHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  if (key === undefined) return undefined;
  const value = headers[key];
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined || first.length === 0 ? undefined : first;
}

export function createWebhooksResource(http: HttpCore) {
  return {
    async create(input: { url: string; event_types: { name: string }[] }): Promise<Webhook> {
      return http.request<Webhook>("POST", "/v1/notifications/webhooks", {
        body: input,
        idempotencyKey: `webhook-${input.url}`,
      });
    },

    async list(): Promise<Webhook[]> {
      const result = await http.request<{ webhooks?: Webhook[] }>("GET", "/v1/notifications/webhooks");
      return result.webhooks ?? [];
    },

    async delete(id: string): Promise<void> {
      await http.request<void>("DELETE", `/v1/notifications/webhooks/${encodeURIComponent(id)}`);
    },

    async verify(input: {
      webhookId: string;
      headers: Record<string, string | string[] | undefined>;
      rawBody: string;
    }): Promise<boolean> {
      const signature: Record<string, string> = {};
      for (const name of SIGNATURE_HEADERS) {
        const value = getHeader(input.headers, name);
        if (value === undefined) return false;
        const field = name === "paypal-auth-algo" ? "auth_algo"
          : name === "paypal-cert-url" ? "cert_url"
            : name === "paypal-transmission-id" ? "transmission_id"
              : name === "paypal-transmission-sig" ? "transmission_sig"
                : "transmission_time";
        signature[field] = value;
      }

      let webhookEvent: unknown;
      try {
        webhookEvent = JSON.parse(input.rawBody) as WebhookEvent;
      } catch {
        return false;
      }

      const result = await http.request<{ verification_status?: string }>("POST", "/v1/notifications/verify-webhook-signature", {
        body: { ...signature, webhook_id: input.webhookId, webhook_event: webhookEvent },
        idempotencyKey: `verify-${signature.transmission_id}`,
      });
      return result.verification_status === "SUCCESS";
    },
  };
}
