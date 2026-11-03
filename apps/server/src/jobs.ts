import { sql } from "drizzle-orm";
import type { Db } from "@untangle/db";
import { jobs } from "@untangle/db";

export type JobResult = { done: true } | { retryInMs: number };

export interface FailedJob {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  error: string;
}

interface ClaimedJob {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
}

interface QueryRows<T> {
  rows: T[];
}

export class JobRunner {
  private readonly handlers = new Map<string, (payload: Record<string, unknown>) => Promise<JobResult>>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<number> | undefined;
  private stopped = true;
  private failedListener: ((job: FailedJob) => Promise<void>) | undefined;
  private readonly db: Db;
  private readonly now: () => Date;

  constructor(db: Db, now: () => Date) {
    this.db = db;
    this.now = now;
  }

  register(kind: string, handler: (payload: Record<string, unknown>) => Promise<JobResult>): void {
    this.handlers.set(kind, handler);
  }

  /** Called once for each job that has run out of attempts. */
  onFailed(listener: (job: FailedJob) => Promise<void>): void {
    this.failedListener = listener;
  }

  async schedule(kind: string, payload: Record<string, unknown>, delayMs = 0): Promise<string> {
    const runAt = new Date(this.now().getTime() + Math.max(0, delayMs));
    const [job] = await this.db.insert(jobs).values({ kind, payload, runAt, status: "queued" }).returning({ id: jobs.id });
    if (job === undefined) throw new Error("job insert did not return an id");
    await this.arm();
    return job.id;
  }

  async start(): Promise<void> {
    this.stopped = false;
    // One server instance (Render free tier): a job still marked running at startup belonged to a process
    // that died mid-way, so it resumes at once instead of waiting out its lease.
    await this.db.execute(sql`update jobs set status = 'queued', lease_until = null where status = 'running'`);
    await this.arm();
  }

  async runDue(): Promise<number> {
    if (this.running !== undefined) {
      await this.running.catch(() => undefined);
      return 0;
    }
    const run = this.runDueInner();
    this.running = run;
    try {
      return await run;
    } finally {
      if (this.running === run) this.running = undefined;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async runDueInner(): Promise<number> {
    let count = 0;
    try {
      for (;;) {
        const result = await this.db.execute(sql`
          update jobs
          set status = 'running', lease_until = now() + interval '5 minutes', attempts = attempts + 1
          where id = (
            select id from jobs where status = 'queued' and run_at <= now()
            order by run_at limit 1 for update skip locked
          )
          returning id, kind, payload, attempts
        `);
        const job = (result as unknown as QueryRows<ClaimedJob>).rows[0];
        if (job === undefined) break;
        count += 1;
        const handler = this.handlers.get(job.kind);
        try {
          if (handler === undefined) throw new Error(`unknown job kind: ${job.kind}`);
          const outcome = await handler(job.payload);
          if ("done" in outcome) {
            await this.db.update(jobs).set({ status: "done", leaseUntil: null, lastError: null }).where(sql`${jobs.id} = ${job.id} and ${jobs.status} = 'running'`);
          } else {
            await this.db.update(jobs).set({ status: "queued", leaseUntil: null, runAt: new Date(this.now().getTime() + Math.max(0, outcome.retryInMs)), lastError: null }).where(sql`${jobs.id} = ${job.id} and ${jobs.status} = 'running'`);
          }
        } catch (error) {
          const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
          if (job.attempts >= 8) {
            await this.db.update(jobs).set({ status: "failed", leaseUntil: null, lastError: message }).where(sql`${jobs.id} = ${job.id} and ${jobs.status} = 'running'`);
            if (this.failedListener !== undefined) {
              try {
                await this.failedListener({ id: job.id, kind: job.kind, payload: job.payload, error: message });
              } catch {
                // Reporting a dead job must never stop the runner.
              }
            }
          } else {
            const delay = Math.min(15 * 60_000, 5000 * 2 ** job.attempts);
            await this.db.update(jobs).set({ status: "queued", leaseUntil: null, runAt: new Date(this.now().getTime() + delay), lastError: message }).where(sql`${jobs.id} = ${job.id} and ${jobs.status} = 'running'`);
          }
        }
      }
      return count;
    } finally {
      await this.arm();
    }
  }

  private async arm(): Promise<void> {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.stopped) return;
    let delay: number;
    try {
      const result = await this.db.execute(sql`select min(run_at) as "nextRunAt" from jobs where status = 'queued'`);
      const nextRunAt = (result as unknown as QueryRows<{ nextRunAt: Date | string | null }>).rows[0]?.nextRunAt;
      if (nextRunAt === undefined || nextRunAt === null) return;
      delay = Math.min(2_147_000_000, Math.max(0, new Date(nextRunAt).getTime() - this.now().getTime()));
    } catch {
      // The database is unreachable; look again shortly rather than stall until the next schedule().
      delay = 30_000;
    }
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.runDue().catch(() => this.arm());
    }, delay);
  }
}
