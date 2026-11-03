import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, RotateCw } from "lucide-react";
import { describeEvent } from "../../events.ts";
import { shortDateTime } from "../../time.ts";
import type { BusinessSummary, BusEvent, ObligationView } from "../../types.ts";
import { useBusinessEvents } from "./useBusinessEvents.ts";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
import { Button } from "../../ui/Button.tsx";

function dayKey(event: BusEvent): string {
  const date = new Date(event.at);
  if (Number.isNaN(date.getTime())) return "unknown";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dayLabel(key: string): string {
  if (key === "unknown") return "Date unavailable";
  const date = new Date(`${key}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(date);
}

export function BusinessActivity({ business, obligations, events, names }: {
  business: BusinessSummary;
  obligations: ObligationView[];
  events: BusEvent[];
  names: Readonly<Record<string, string>>;
}) {
  const feed = useBusinessEvents(events, obligations, business.id, undefined);
  const queryClient = useQueryClient();
  const groups = useMemo(() => {
    const result = new Map<string, BusEvent[]>();
    for (const event of feed.events) {
      const key = dayKey(event);
      result.set(key, [...(result.get(key) ?? []), event]);
    }
    return [...result.entries()];
  }, [feed.events]);
  const retry = () => { void queryClient.invalidateQueries({ queryKey: ["history"] }); };
  return <section className="business-page-section">
    <div className="business-page-title"><span className="me-eyebrow"><CalendarDays size={14} />Your activity</span><h1>Activity</h1><p>Recent changes that involve {business.name}.</p></div>
    {feed.loading ? <Skeleton variant="row" count={4} className="mt-5" /> : feed.error !== null ? <EmptyState title="Activity could not be loaded" detail={feed.error instanceof Error ? feed.error.message : "Your invoice history is temporarily unavailable."} action="Retry" onAction={retry} /> : groups.length === 0 ? <EmptyState title="No activity yet" detail="When invoices are settled or a business signs a statement, you'll see it here." icon={<RotateCw size={24} />} /> : <div className="business-activity-list">
      {groups.map(([key, items]) => <section key={key} className="business-day-group">
        <h2 className="business-day-heading">{dayLabel(key)}</h2>
        <ol>
          {items.map((event) => <li key={event.seq} className="business-activity-row">
            <span className="business-activity-dot" aria-hidden="true" />
            <div className="min-w-0 flex-1"><p>{describeEvent(event, names)}</p><time dateTime={event.at}>{shortDateTime(event.at)}</time></div>
          </li>)}
        </ol>
      </section>)}
    </div>}
    {feed.error !== null && <Button variant="secondary" className="mt-4" onClick={retry}><RotateCw size={15} />Reload activity</Button>}
  </section>;
}
