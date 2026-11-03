import { appendEvents } from "@untangle/db";
import type { Db } from "@untangle/db";

export interface BusEvent {
  seq: number;
  stream: string;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

export class Bus {
  private readonly listeners = new Set<(event: BusEvent) => void>();
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async emit(stream: string, type: string, payload: Record<string, unknown>, actor = "system"): Promise<BusEvent> {
    const [event] = await appendEvents(this.db, [{ stream, type, payload, actor }]);
    if (event === undefined) throw new Error("event append did not return an event");
    const publicEvent: BusEvent = { seq: event.seq, stream: event.stream, type: event.type, payload: event.payload, at: event.at };
    for (const listener of this.listeners) {
      try {
        listener(publicEvent);
      } catch {
        this.listeners.delete(listener);
      }
    }
    return publicEvent;
  }

  subscribe(listener: (event: BusEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
