import { and, eq } from "drizzle-orm";
import { createPayPalClient } from "@untangle/paypal";
import type { PayPalClient } from "@untangle/paypal";
import type { Db } from "@untangle/db";
import { paypalAccounts } from "@untangle/db";
import { decryptSecret } from "./crypto.ts";
import { DomainError } from "./errors.ts";

export interface PayPalRegistryOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class PayPalRegistry {
  private readonly db: Db;
  private readonly masterKey: Buffer;
  private readonly options: PayPalRegistryOptions;
  private readonly clients = new Map<string, Promise<PayPalClient>>();

  constructor(db: Db, masterKey: Buffer, options: PayPalRegistryOptions = {}) {
    this.db = db;
    this.masterKey = masterKey;
    this.options = options;
  }

  forBusiness(businessId: string): Promise<PayPalClient> {
    const cached = this.clients.get(businessId);
    if (cached !== undefined) return cached;
    const client = this.loadClient(businessId);
    this.clients.set(businessId, client);
    void client.catch(() => {
      if (this.clients.get(businessId) === client) this.clients.delete(businessId);
    });
    return client;
  }

  async clientIdFor(businessId: string): Promise<string> {
    const account = await this.account(businessId);
    return account.clientId;
  }

  async webhookIdFor(businessId: string): Promise<string | null> {
    return (await this.account(businessId)).webhookId;
  }

  /** The business's own app credentials, for the PayPal Agent Toolkit. Never leaves the server. */
  async credentialsFor(businessId: string): Promise<{ clientId: string; clientSecret: string }> {
    const account = await this.account(businessId);
    return { clientId: account.clientId, clientSecret: decryptSecret(account.clientSecretEnc, this.masterKey) };
  }

  invalidate(businessId?: string): void {
    if (businessId === undefined) this.clients.clear();
    else this.clients.delete(businessId);
  }

  private async loadClient(businessId: string): Promise<PayPalClient> {
    const account = await this.account(businessId);
    const clientSecret = decryptSecret(account.clientSecretEnc, this.masterKey);
    return createPayPalClient({
      clientId: account.clientId,
      clientSecret,
      environment: "sandbox",
      ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
      ...(this.options.sleep === undefined ? {} : { sleep: this.options.sleep }),
    });
  }

  private async account(businessId: string) {
    const [account] = await this.db.select().from(paypalAccounts).where(eq(paypalAccounts.businessId, businessId)).limit(1);
    if (account === undefined) throw new DomainError(422, "PAYPAL_ACCOUNT_MISSING", `PayPal account is missing for business ${businessId}`);
    return account;
  }
}
