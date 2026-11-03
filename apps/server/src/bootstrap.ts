import { and, eq } from "drizzle-orm";
import { businesses, networks, paypalAccounts } from "@untangle/db";
import { decryptSecret, encryptSecret } from "./crypto.ts";
import type { AppContext } from "./context.ts";

function sameSecret(blob: Uint8Array, secret: string, key: Buffer): boolean {
  try {
    return decryptSecret(blob, key) === secret;
  } catch {
    return false; // stored under an older MASTER_KEY; re-encrypt it
  }
}

export async function ensureNetwork(ctx: AppContext): Promise<string> {
  const networkId = await ctx.db.transaction(async (tx) => {
    let [network] = await tx.select().from(networks).where(eq(networks.name, ctx.config.networkName)).limit(1);
    if (network === undefined) {
      [network] = await tx.insert(networks).values({ name: ctx.config.networkName, currency: ctx.config.currency }).returning();
    }
    if (network === undefined) throw new Error("network insert did not return a row");

    for (const businessConfig of ctx.config.businesses) {
      const [business] = await tx.insert(businesses).values({
        networkId: network.id,
        name: businessConfig.name,
        email: businessConfig.email,
      }).onConflictDoUpdate({
        target: [businesses.networkId, businesses.email],
        set: { name: businessConfig.name },
      }).returning();
      if (business === undefined) throw new Error("business upsert did not return a row");

      const [account] = await tx.select().from(paypalAccounts).where(eq(paypalAccounts.businessId, business.id)).limit(1);
      const secretChanged = account === undefined || !sameSecret(account.clientSecretEnc, businessConfig.clientSecret, ctx.config.masterKey);
      const secretEnc = secretChanged ? encryptSecret(businessConfig.clientSecret, ctx.config.masterKey) : account.clientSecretEnc;
      await tx.insert(paypalAccounts).values({
        businessId: business.id,
        environment: "sandbox",
        clientId: businessConfig.clientId,
        clientSecretEnc: secretEnc,
      }).onConflictDoUpdate({
        target: paypalAccounts.businessId,
        set: { environment: "sandbox", clientId: businessConfig.clientId, clientSecretEnc: secretEnc },
      });
    }
    return network.id;
  });
  ctx.paypal.invalidate();
  return networkId;
}
