import type { FastifyPluginAsync } from "fastify";
import { asc, gt } from "drizzle-orm";
import { events } from "@untangle/db";
import type { AppContext } from "../context.ts";

// Each open stream holds a socket and a timer; a public demo must not let anyone open thousands.
const MAX_STREAMS = 100;
const MAX_REPLAY = 500;

export const streamRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, options) => {
  let open = 0;
  app.get("/api/stream", async (request, reply) => {
    if (open >= MAX_STREAMS) return reply.code(503).send({ error: "TOO_MANY_STREAMS", message: "Too many live connections; try again shortly." });
    open += 1;
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    response.write("retry: 3000\n\n");
    const write = (event: { seq: number; type: string }) => response.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    const unsubscribe = options.ctx.bus.subscribe(write);

    // EventSource sends Last-Event-ID when it reconnects; replay what it missed so no change is lost.
    const lastSeen = Number(request.headers["last-event-id"]);
    if (Number.isSafeInteger(lastSeen) && lastSeen > 0) {
      const missed = await options.ctx.db.select().from(events).where(gt(events.seq, lastSeen)).orderBy(asc(events.seq)).limit(MAX_REPLAY);
      for (const row of missed) {
        write({ seq: row.seq, stream: row.stream, type: row.type, payload: row.payload, at: row.at.toISOString() } as { seq: number; type: string });
      }
    }

    const heartbeat = setInterval(() => response.write(": ping\n\n"), 25_000);
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      open -= 1;
      unsubscribe();
      clearInterval(heartbeat);
    };
    response.on("close", cleanup);
    request.raw.on("close", cleanup);
  });
};
