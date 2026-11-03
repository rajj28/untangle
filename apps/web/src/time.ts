export function shortDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

/** "2m 05s" between two ISO times (or until now while still running). */
export function duration(startedAt: string, finishedAt: string | null): string {
  const ms = Math.max(0, (finishedAt === null ? Date.now() : Date.parse(finishedAt)) - Date.parse(startedAt));
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
