import { asc, desc, gt } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { events } from "@untangle/db";
import type { AppContext } from "../context.ts";
import type { BusEvent } from "../bus.ts";

const eventQuery = z.object({
  after: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const eventRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, options) => {
  app.get<{ Querystring: Record<string, unknown> }>("/api/events", async (request) => {
    const query = eventQuery.parse(request.query);
    let rows: { seq: number; stream: string; type: string; payload: unknown; at: Date }[];
    if (query.after !== undefined) {
      rows = await options.ctx.db.select({ seq: events.seq, stream: events.stream, type: events.type, payload: events.payload, at: events.at })
        .from(events).where(gt(events.seq, query.after)).orderBy(asc(events.seq)).limit(query.limit);
    } else {
      rows = await options.ctx.db.select({ seq: events.seq, stream: events.stream, type: events.type, payload: events.payload, at: events.at })
        .from(events).orderBy(desc(events.seq)).limit(query.limit);
      rows.reverse();
    }
    const busEvents: BusEvent[] = rows.map((row) => ({ ...row, payload: row.payload as Record<string, unknown>, at: row.at.toISOString() }));
    return { events: busEvents };
  });
};
