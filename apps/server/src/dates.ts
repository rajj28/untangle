const pacificFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" });

export function pacificDate(date: Date): string {
  return pacificFormatter.format(date);
}

export function addDays(date: Date, days: number): string {
  const [year, month, day] = pacificDate(date).split("-").map(Number);
  const result = new Date(Date.UTC(year!, month! - 1, day! + days));
  return `${result.getUTCFullYear().toString().padStart(4, "0")}-${(result.getUTCMonth() + 1).toString().padStart(2, "0")}-${result.getUTCDate().toString().padStart(2, "0")}`;
}
