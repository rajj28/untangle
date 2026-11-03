import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CircleAlert, Fingerprint, ShieldCheck } from "lucide-react";
import { api, ApiError } from "../api.ts";
import type { AuditResult, BusEvent, ObligationView } from "../types.ts";
import { describeEvent } from "../events.ts";
import { shortDateTime } from "../time.ts";
import type { ToastMessage } from "../components/Toasts.tsx";
import { Button } from "../ui/Button.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Skeleton } from "../ui/Skeleton.tsx";
import { useBusinessEvents } from "./me/useBusinessEvents.ts";

type PushToast = (toast: Omit<ToastMessage, "id">) => void;

interface DayGroup { key: string; events: BusEvent[] }
interface RoundGroup { key: string; label: string; days: DayGroup[] }

function dayKey(event: BusEvent): string {
  const date = new Date(event.at);
  if (Number.isNaN(date.getTime())) return "unknown";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dayLabel(key: string): string {
  if (key === "unknown") return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date(`${key}T12:00:00`));
}

function groupsFor(events: readonly BusEvent[]): RoundGroup[] {
  const rounds = new Map<string, BusEvent[]>();
  for (const event of events) {
    const raw = event.payload.roundId;
    const key = typeof raw === "string" ? raw : "network";
    rounds.set(key, [...(rounds.get(key) ?? []), event]);
  }
  return [...rounds.entries()].map(([key, roundEvents]) => {
    const days = new Map<string, BusEvent[]>();
    for (const event of roundEvents) {
      const date = dayKey(event);
      days.set(date, [...(days.get(date) ?? []), event]);
    }
    return {
      key,
      label: key === "network" ? "Network activity" : `Round ${short(key)}`,
      days: [...days.entries()].map(([date, dayEvents]) => ({ key: date, events: dayEvents.sort((a, b) => b.seq - a.seq) })),
    };
  }).sort((a, b) => (b.days[0]?.events[0]?.seq ?? 0) - (a.days[0]?.events[0]?.seq ?? 0));
}

function family(type: string): { label: string; color: string } {
  const key = type.split(".")[0] ?? "network";
  const label = key === "setoffs" ? "set-off" : key;
  const allowed = ["round", "transfer", "setoffs", "chain", "network", "demo", "obligation"];
  return { label, color: allowed.includes(key) ? `event-${key}` : "event-network" };
}

export function Activity({ initialEvents, liveEvents, names, obligations, actingAs, onToast, loading, error, onRetry }: {
  initialEvents: BusEvent[];
  liveEvents: BusEvent[];
  names: Readonly<Record<string, string>>;
  obligations: ObligationView[];
  actingAs: string;
  onToast: PushToast;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const allEvents = useMemo(() => {
    const bySeq = new Map<number, BusEvent>();
    for (const event of [...initialEvents, ...liveEvents]) bySeq.set(event.seq, event);
    return [...bySeq.values()].sort((a, b) => b.seq - a.seq);
  }, [initialEvents, liveEvents]);
  const businessFeed = useBusinessEvents(allEvents, obligations, actingAs || "__operator__", undefined);
  const visibleEvents = actingAs ? businessFeed.events : allEvents;
  const groups = useMemo(() => groupsFor(visibleEvents), [visibleEvents]);
  const verify = useMutation({
    mutationFn: api.verifyAudit,
    onSuccess: (result) => setAudit(result),
    onError: (failure) => onToast(failure instanceof ApiError
      ? { kind: "error", title: failure.message, code: failure.code, debugId: failure.debugId }
      : { kind: "error", title: failure instanceof Error ? failure.message : "Audit verification failed.", code: null, debugId: null }),
  });
  const auditLabel = audit === null ? null : audit.ok ? `${audit.count} events · tamper-evident hash chain intact` : `Broken at seq ${audit.brokenSeq ?? "?"}: ${audit.reason ?? "verification failed"}`;
  const eventError = error ?? (actingAs ? businessFeed.error : null);
  return <section className="desk-view-section">
    <header className="desk-view-header">
      <div><h1>Activity & audit</h1><p>Recent events grouped by round, with the latest first.</p></div>
      <div className="desk-view-header-actions">
        {auditLabel && <p role="status" className={`audit-result ${audit?.ok ? "is-valid" : "is-broken"}`}>{audit?.ok ? <ShieldCheck size={16} /> : <CircleAlert size={16} />}{auditLabel}</p>}
        <Button variant="secondary" onClick={() => verify.mutate()} loading={verify.isPending}><Fingerprint size={15} />Verify audit chain</Button>
      </div>
    </header>
    <div className="activity-scroll">
      {loading || (actingAs !== "" && businessFeed.loading) ? <Skeleton variant="row" count={8} className="mx-auto max-w-4xl p-5" /> : eventError !== null ? <div className="mx-auto max-w-3xl p-6"><EmptyState title="Activity could not be loaded" detail={eventError instanceof Error ? eventError.message : "The event feed is temporarily unavailable."} action="Retry" onAction={onRetry} /></div> : groups.length === 0 ? <div className="mx-auto max-w-3xl p-6"><EmptyState title="No activity yet" detail="When invoices change or a settlement round moves forward, the event record will appear here." action="Verify audit chain" onAction={() => verify.mutate()} /></div> : <div className="activity-rounds">
        {groups.map((group) => <section key={group.key} className="activity-round-group">
          <h2 className="activity-round-heading">{group.label}</h2>
          {group.days.map((day) => <section key={`${group.key}-${day.key}`} className="activity-day-group">
            <h3 className="activity-day-heading">{dayLabel(day.key)}</h3>
            <ol className="activity-event-list">
              {day.events.map((event) => {
                const tag = family(event.type);
                return <li key={event.seq} className="activity-event-row">
                  <time dateTime={event.at}>{shortDateTime(event.at)}</time>
                  <span className={`activity-type ${tag.color}`}>{tag.label}</span>
                  <div className="activity-event-content">
                    <p>{describeEvent(event, names)}</p>
                    <details>
                      <summary>Event {event.seq} <code>{event.type}</code></summary>
                      <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                    </details>
                  </div>
                </li>;
              })}
            </ol>
          </section>)}
        </section>)}
      </div>}
    </div>
  </section>;
}

function short(value: string): string { return value.length > 12 ? `${value.slice(0, 5)}…${value.slice(-4)}` : value; }
