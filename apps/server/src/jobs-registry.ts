import type { AppContext } from "./context.ts";
import { syncObligation } from "./services/obligations.ts";
import { abandonRound, executeRound } from "./services/rounds.ts";
import { commitTransfer, followPayouts, reconcileCheckout, unwindTransfer } from "./services/transfers.ts";

export function registerJobs(ctx: AppContext): void {
  ctx.jobs.register("round.execute", async (payload) => executeRound(ctx, String(payload.roundId)));
  ctx.jobs.register("transfer.commit", async (payload) => commitTransfer(ctx, String(payload.transferId), String(payload.proofRef), true));
  ctx.jobs.register("transfer.unwind", async (payload) => unwindTransfer(ctx, String(payload.transferId), true));
  ctx.jobs.register("transfer.reconcile", async (payload) => reconcileCheckout(ctx, String(payload.transferId)));
  ctx.jobs.register("round.follow_payouts", async (payload) => followPayouts(ctx, String(payload.roundId), String(payload.since)));
  ctx.jobs.register("obligation.sync", async (payload) => {
    await syncObligation(ctx, String(payload.obligationId));
    return { done: true };
  });
  ctx.jobs.onFailed(async (job) => {
    await ctx.bus.emit("system", "job.failed", { jobId: job.id, kind: job.kind, payload: job.payload, error: job.error });
    // A dead execution job would otherwise leave its round "executing" and block every later round.
    if (job.kind === "round.execute") await abandonRound(ctx, String(job.payload.roundId), job.error);
  });
}
