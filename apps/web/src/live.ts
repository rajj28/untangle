import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { BusEvent } from "./types.ts";

export type LiveStatus = "connected" | "reconnecting";

const KNOWN_TYPES = [
  "network.seeded", "demo.reset", "obligation.updated",
  "round.planned", "round.consented", "round.ready", "round.retrying", "round.setoffs_recorded",
  "round.failed", "round.needs_attention", "round.closed",
  "transfer.order_created", "transfer.captured", "transfer.payout_sent", "transfer.committed",
  "transfer.unwound", "transfer.failed", "transfer.unclaimed", "transfer.needs_attention",
  "setoffs.recorded", "chain.committed", "chain.unwound",
  "agent.run_started", "agent.step", "agent.approval_requested", "agent.approval_decided", "agent.run_finished",
  "evidence.extracted", "claim.updated",
] as const;

function parseEvent(raw: string): BusEvent | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const event = parsed as Partial<BusEvent>;
    if (typeof event.seq !== "number" || typeof event.stream !== "string" || typeof event.type !== "string" || typeof event.at !== "string") return null;
    if (typeof event.payload !== "object" || event.payload === null || Array.isArray(event.payload)) return null;
    return event as BusEvent;
  } catch {
    return null;
  }
}

export function useLiveEvents(): { status: LiveStatus; recentEvents: BusEvent[] } {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>("reconnecting");
  const [recentEvents, setRecentEvents] = useState<BusEvent[]>([]);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlers = useMemo(() => new Map<string, EventListener>(), []);

  useEffect(() => {
    const source = new EventSource("/api/stream");
    const receive = (message: MessageEvent<string>) => {
      const event = parseEvent(message.data);
      if (event === null) return;
      setRecentEvents((current) => {
        if (current.some((item) => item.seq === event.seq)) return current;
        return [event, ...current].sort((a, b) => b.seq - a.seq).slice(0, 300);
      });
      queryClient.setQueryData<{ events: BusEvent[] }>(["events"], (current) => {
        if (current === undefined || current.events.some((item) => item.seq === event.seq)) return current;
        return { events: [...current.events, event].sort((a, b) => a.seq - b.seq).slice(-300) };
      });

      if (debounce.current !== null) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ["network"] });
        void queryClient.invalidateQueries({ queryKey: ["events"] });
        const type = event.type;
        if (type.startsWith("obligation.") || type.startsWith("round.") || type.startsWith("transfer.") || type.startsWith("setoffs.") || type.startsWith("chain.") || type === "network.seeded" || type === "demo.reset") {
          void queryClient.invalidateQueries({ queryKey: ["obligations"] });
          void queryClient.invalidateQueries({ queryKey: ["round"] });
          void queryClient.invalidateQueries({ queryKey: ["rounds"] });
        }
        if (type.startsWith("transfer.") || type.startsWith("chain.")) {
          void queryClient.invalidateQueries({ queryKey: ["history"] });
        }
        // Agent events
        if (type.startsWith("agent.")) {
          const payload = event.payload;
          const runId = typeof payload["runId"] === "string" ? payload["runId"] : undefined;
          void queryClient.invalidateQueries({ queryKey: ["agent-runs"] });
          if (runId !== undefined) void queryClient.invalidateQueries({ queryKey: ["agent-run", runId] });
          void queryClient.invalidateQueries({ queryKey: ["approvals"] });
        }
        // Evidence / claim events
        if (type.startsWith("evidence.") || type.startsWith("claim.")) {
          void queryClient.invalidateQueries({ queryKey: ["evidence"] });
          void queryClient.invalidateQueries({ queryKey: ["obligations"] });
          void queryClient.invalidateQueries({ queryKey: ["network"] });
        }
      }, 150);
    };

    source.onopen = () => {
      setStatus("connected");
      // On every successful connection (including reconnects), invalidate all server queries
      // so stale caches refresh. The server replays missed events from Last-Event-ID, but
      // caches may still be stale from events we never received.
      void queryClient.invalidateQueries();
    };
    source.onerror = () => setStatus("reconnecting");
    source.onmessage = receive;
    for (const type of KNOWN_TYPES) {
      const listener: EventListener = (event) => receive(event as MessageEvent<string>);
      handlers.set(type, listener);
      source.addEventListener(type, listener);
    }
    return () => {
      source.close();
      for (const [type, listener] of handlers) source.removeEventListener(type, listener);
      handlers.clear();
      if (debounce.current !== null) clearTimeout(debounce.current);
    };
  }, [handlers, queryClient]);

  return { status, recentEvents };
}
