import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { businesses, networks, obligations, operations, rounds, transferLegs, transfers } from "../src/schema.ts";
import { makeTestDb } from "./helpers.ts";

describe("database schema", () => {
  let testDb: Awaited<ReturnType<typeof makeTestDb>>;

  beforeEach(async () => {
    testDb = await makeTestDb();
  });

  afterEach(async () => {
    await testDb.close();
  });

  async function makeBusinesses() {
    const [network] = await testDb.db.insert(networks).values({ name: "Network", currency: "USD" }).returning();
    if (network === undefined) throw new Error("network insert did not return a row");
    const [debtor] = await testDb.db.insert(businesses).values({
      networkId: network.id,
      name: "Debtor",
      email: "debtor@example.com",
    }).returning();
    const [creditor] = await testDb.db.insert(businesses).values({
      networkId: network.id,
      name: "Creditor",
      email: "creditor@example.com",
    }).returning();
    if (debtor === undefined || creditor === undefined) throw new Error("business insert did not return rows");
    return { network, debtor, creditor };
  }

  async function insertObligation(input: {
    networkId: string;
    debtorId: string;
    creditorId: string;
    amountMinor?: number;
    outstandingMinor?: number;
    status?: string;
    paypalInvoiceId?: string | null;
  }) {
    const [row] = await testDb.db.insert(obligations).values({
      networkId: input.networkId,
      debtorId: input.debtorId,
      creditorId: input.creditorId,
      amountMinor: input.amountMinor ?? 100,
      outstandingMinor: input.outstandingMinor ?? input.amountMinor ?? 100,
      currency: "USD",
      status: input.status ?? "claimed",
      paypalInvoiceId: input.paypalInvoiceId ?? null,
    }).returning();
    if (row === undefined) throw new Error("obligation insert did not return a row");
    return row;
  }

  it("creates all 21 application tables", async () => {
    const result = await testDb.db.execute(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    `);
    const rows = (result as unknown as { rows: Array<{ table_name: string }> }).rows;
    expect(rows.map((row) => row.table_name).sort()).toEqual([
      "ai_cache",
      "businesses",
      "claims",
      "consents",
      "events",
      "evidence",
      "jobs",
      "negotiations",
      "obligations",
      "operations",
      "passkeys",
      "paypal_accounts",
      "policies",
      "rounds",
      "setoffs",
      "statements",
      "transfer_legs",
      "transfers",
      "users",
      "webhook_inbox",
      "networks",
    ].sort());
  });

  it("rejects an obligation with zero amount", async () => {
    const { network, debtor, creditor } = await makeBusinesses();
    await expect(insertObligation({ networkId: network.id, debtorId: debtor.id, creditorId: creditor.id, amountMinor: 0, outstandingMinor: 0 }))
      .rejects.toThrow();
  });

  it("rejects an outstanding amount greater than the obligation amount", async () => {
    const { network, debtor, creditor } = await makeBusinesses();
    await expect(insertObligation({ networkId: network.id, debtorId: debtor.id, creditorId: creditor.id, amountMinor: 100, outstandingMinor: 101 }))
      .rejects.toThrow();
  });

  it("rejects an obligation with the same debtor and creditor", async () => {
    const { network, debtor } = await makeBusinesses();
    await expect(insertObligation({ networkId: network.id, debtorId: debtor.id, creditorId: debtor.id }))
      .rejects.toThrow();
  });

  it("rejects a duplicate PayPal invoice id", async () => {
    const { network, debtor, creditor } = await makeBusinesses();
    const values = { networkId: network.id, debtorId: debtor.id, creditorId: creditor.id, paypalInvoiceId: "invoice-1" };
    await insertObligation(values);
    await expect(insertObligation(values)).rejects.toThrow();
  });

  it("rejects an obligation status outside the allowed list", async () => {
    const { network, debtor, creditor } = await makeBusinesses();
    await expect(insertObligation({ networkId: network.id, debtorId: debtor.id, creditorId: creditor.id, status: "unknown" }))
      .rejects.toThrow();
  });

  it("inserts and reads an obligation amount as a JavaScript number", async () => {
    const { network, debtor, creditor } = await makeBusinesses();
    const inserted = await insertObligation({ networkId: network.id, debtorId: debtor.id, creditorId: creditor.id, amountMinor: 12345 });
    const [read] = await testDb.db.select().from(obligations).where(sql`${obligations.id} = ${inserted.id}`);

    expect(read?.amountMinor).toBe(12345);
    expect(typeof read?.amountMinor).toBe("number");
  });

  it("rejects duplicate transfer-leg primary keys", async () => {
    const { network, debtor, creditor } = await makeBusinesses();
    const obligation = await insertObligation({ networkId: network.id, debtorId: debtor.id, creditorId: creditor.id });
    const [round] = await testDb.db.insert(rounds).values({ networkId: network.id, status: "planned" }).returning();
    if (round === undefined) throw new Error("round insert did not return a row");
    const [transfer] = await testDb.db.insert(transfers).values({
      roundId: round.id,
      payerId: debtor.id,
      payeeId: creditor.id,
      amountMinor: 100,
      currency: "USD",
    }).returning();
    if (transfer === undefined) throw new Error("transfer insert did not return a row");
    const leg = { transferId: transfer.id, obligationId: obligation.id, position: 0, amountMinor: 100 };
    await testDb.db.insert(transferLegs).values(leg);

    await expect(testDb.db.insert(transferLegs).values(leg)).rejects.toThrow();
  });

  it("cascades transfer deletion to its legs", async () => {
    const { network, debtor, creditor } = await makeBusinesses();
    const obligation = await insertObligation({ networkId: network.id, debtorId: debtor.id, creditorId: creditor.id });
    const [round] = await testDb.db.insert(rounds).values({ networkId: network.id, status: "planned" }).returning();
    if (round === undefined) throw new Error("round insert did not return a row");
    const [transfer] = await testDb.db.insert(transfers).values({
      roundId: round.id,
      payerId: debtor.id,
      payeeId: creditor.id,
      amountMinor: 100,
      currency: "USD",
    }).returning();
    if (transfer === undefined) throw new Error("transfer insert did not return a row");
    await testDb.db.insert(transferLegs).values({ transferId: transfer.id, obligationId: obligation.id, position: 0, amountMinor: 100 });

    await testDb.db.delete(transfers).where(sql`${transfers.id} = ${transfer.id}`);

    await expect(testDb.db.select().from(transferLegs)).resolves.toHaveLength(0);
  });

  it("rejects a duplicate operations idempotency key", async () => {
    const operation = { idemKey: "operation-1", kind: "capture", refId: "transfer-1" };
    await testDb.db.insert(operations).values(operation);
    await expect(testDb.db.insert(operations).values(operation)).rejects.toThrow();
  });
});
