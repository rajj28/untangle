import { describe, expect, it } from "vitest";
import { makeTestContext } from "./context.ts";

describe("two-sided confirmation links", () => {
  it("signs a link, confirms one side, and records a rejection on the other", async () => {
    const test = await makeTestContext();
    const obligationId = test.ids.a;

    const linksRes = await test.app.inject({ method: "GET", url: `/api/obligations/${obligationId}/confirm-links` });
    expect(linksRes.statusCode).toBe(200);
    const links = linksRes.json() as { debtorToken: string; creditorToken: string };
    expect(links.debtorToken).toBeTruthy();
    expect(links.creditorToken).toBeTruthy();

    // A signed link resolves to the obligation details.
    const getRes = await test.app.inject({ method: "GET", url: `/api/confirm/${links.debtorToken}` });
    expect(getRes.statusCode).toBe(200);
    const view = getRes.json() as {
      obligationId: string;
      side: string;
      debtor: { name: string };
      creditor: { name: string };
      amountMinor: number;
      currency: string;
      debtorConfirmed: boolean;
      creditorConfirmed: boolean;
      status: string;
    };
    expect(view.obligationId).toBe(obligationId);
    expect(view.side).toBe("debtor");
    expect(view.amountMinor).toBeGreaterThan(0);
    expect(view.debtor.name).toBeTruthy();
    expect(view.creditor.name).toBeTruthy();

    // Reject as the debtor -> the obligation becomes disputed with a stored reason.
    const rejectRes = await test.app.inject({
      method: "POST",
      url: `/api/confirm/${links.debtorToken}`,
      payload: { decision: "reject", reason: "we already paid this" },
    });
    expect(rejectRes.statusCode).toBe(200);
    const rejected = rejectRes.json() as { status: string; disputeReason: string | null };
    expect(rejected.status).toBe("disputed");
    expect(rejected.disputeReason).toContain("already paid");

    // A tampered token is rejected.
    const badRes = await test.app.inject({ method: "GET", url: `/api/confirm/${links.debtorToken}deadbeef` });
    expect(badRes.statusCode).toBe(400);
  });

  it("stamps only the side that confirms", async () => {
    const test = await makeTestContext();
    const obligationId = test.ids.a;
    const linksRes = await test.app.inject({ method: "GET", url: `/api/obligations/${obligationId}/confirm-links` });
    const links = linksRes.json() as { debtorToken: string; creditorToken: string };

    // Clear the debtor's stamp so only the creditor side remains confirmed.
    const requestRes = await test.app.inject({ method: "POST", url: `/api/demo/confirm-request/${obligationId}`, payload: {} });
    expect(requestRes.statusCode).toBe(200);

    const before = await test.app.inject({ method: "GET", url: `/api/confirm/${links.debtorToken}` });
    const beforeView = before.json() as { debtorConfirmed: boolean; creditorConfirmed: boolean };
    expect(beforeView.debtorConfirmed).toBe(false);
    expect(beforeView.creditorConfirmed).toBe(true);

    const confirmRes = await test.app.inject({
      method: "POST",
      url: `/api/confirm/${links.debtorToken}`,
      payload: { decision: "confirm" },
    });
    const after = confirmRes.json() as { debtorConfirmed: boolean; creditorConfirmed: boolean; status: string };
    expect(after.debtorConfirmed).toBe(true);
    expect(after.creditorConfirmed).toBe(true);
    expect(after.status).toBe("invoiced");
  });

  it("withdraws a consenting round whose plan holds a rejected invoice, and re-plans without it", async () => {
    const test = await makeTestContext();
    const planned = await test.app.inject({ method: "POST", url: `/api/networks/${test.ids.network}/rounds` });
    expect(planned.statusCode).toBe(201);
    const first = planned.json() as { id: string };

    const links = (await test.app.inject({ method: "GET", url: `/api/obligations/${test.ids.b}/confirm-links` })).json() as { debtorToken: string };
    const rejectRes = await test.app.inject({ method: "POST", url: `/api/confirm/${links.debtorToken}`, payload: { decision: "reject", reason: "never delivered" } });
    expect(rejectRes.statusCode).toBe(200);

    const old = (await test.app.inject({ method: "GET", url: `/api/rounds/${first.id}` })).json() as { status: string };
    expect(old.status).toBe("failed");

    const summary = (await test.app.inject({ method: "GET", url: `/api/networks/${test.ids.network}` })).json() as { latestRound: { id: string; status: string } | null };
    expect(summary.latestRound?.id).not.toBe(first.id);
    expect(summary.latestRound?.status).toBe("consenting");
    const next = (await test.app.inject({ method: "GET", url: `/api/rounds/${summary.latestRound!.id}` })).json() as {
      replanned: { brokeLoops: { memberIds: string[] }[]; newLoops: unknown[] } | null;
    };
    expect(next.replanned?.brokeLoops.length).toBe(1);
    expect(next.replanned?.brokeLoops[0]!.memberIds).toContain(test.ids.b);
    expect(next.replanned?.newLoops.length).toBe(0);
  });
});
