import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { networks, obligations, rounds } from "@untangle/db";
import type { AppContext } from "../context.ts";
import { DomainError } from "../errors.ts";
import { seedNetwork } from "../seed/seed.ts";

const ARCHIVABLE = ["invoiced", "partially_settled", "settled"];
const RESETTABLE_ROUNDS = ["consenting", "settling"];

export interface DemoResetResult {
  networkId: string;
  archived: number;
  created: number;
  skipped: number;
}

export async function resetDemo(ctx: AppContext): Promise<DemoResetResult> {
  return ctx.locks.run("demo:reset", async () => {
    if (!ctx.config.demoMode) throw new DomainError(404, "DEMO_DISABLED", "Demo reset is not available");
    const [network] = await ctx.db.select({ id: networks.id }).from(networks).orderBy(asc(networks.createdAt)).limit(1);
    if (network === undefined) throw new DomainError(404, "NETWORK_NOT_FOUND", "Network was not found");
    const executing = await ctx.db.select({ id: rounds.id }).from(rounds)
      .where(and(eq(rounds.networkId, network.id), eq(rounds.status, "executing"))).limit(1);
    if (executing.length > 0) throw new DomainError(409, "ROUND_IN_PROGRESS", "A settlement round is executing");

    const resetRounds = await ctx.db.select({ id: rounds.id }).from(rounds)
      .where(and(eq(rounds.networkId, network.id), inArray(rounds.status, RESETTABLE_ROUNDS)));
    for (const round of resetRounds) {
      const changed = await ctx.db.update(rounds).set({ status: "failed", updatedAt: ctx.now() })
        .where(and(eq(rounds.id, round.id), inArray(rounds.status, RESETTABLE_ROUNDS))).returning({ id: rounds.id });
      if (changed.length > 0) await ctx.bus.emit(`round:${round.id}`, "round.failed", { roundId: round.id, reason: "demo_reset" });
    }

    const candidates = await ctx.db.select({ id: obligations.id }).from(obligations).where(and(
      eq(obligations.networkId, network.id), inArray(obligations.status, ARCHIVABLE), sql`${obligations.paypalInvoiceId} is not null`,
    ));
    let archived = 0;
    for (const candidate of candidates) {
      const changed = await ctx.locks.run(`obligation:${candidate.id}`, async () => {
        const [obligation] = await ctx.db.select().from(obligations).where(eq(obligations.id, candidate.id)).limit(1);
        if (obligation === undefined || !ARCHIVABLE.includes(obligation.status) || obligation.paypalInvoiceId === null) return false;
        try {
          const client = await ctx.paypal.forBusiness(obligation.creditorId);
          await client.invoicing.cancel(obligation.paypalInvoiceId, { send_to_recipient: false });
        } catch {
          // A fully paid invoice may not be cancellable; the archived obligation is still final.
        }
        const updated = await ctx.db.update(obligations).set({
          status: "cancelled",
          version: sql`${obligations.version} + 1`,
          updatedAt: ctx.now(),
        }).where(and(eq(obligations.id, obligation.id), eq(obligations.status, obligation.status))).returning({ id: obligations.id });
        if (updated.length === 0) return false;
        await ctx.bus.emit(`network:${network.id}`, "obligation.updated", { obligationId: obligation.id, outstandingMinor: obligation.outstandingMinor, status: "cancelled" });
        return true;
      });
      if (changed) archived += 1;
    }

    const seeded = await seedNetwork(ctx, network.id, `R${Date.now().toString(36).toUpperCase()}`);
    await ctx.bus.emit(`network:${network.id}`, "demo.reset", { networkId: network.id, archived, created: seeded.created });
    return { networkId: network.id, archived, created: seeded.created, skipped: seeded.skipped };
  });
}
