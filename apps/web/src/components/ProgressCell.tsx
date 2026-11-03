import { percent } from "../money.ts";

export function ProgressCell({ amountMinor, outstandingMinor }: { amountMinor: number; outstandingMinor: number }) {
  const settled = amountMinor - outstandingMinor;
  const value = percent(settled, amountMinor);
  return (
    <div className="flex w-full items-center gap-2">
      <span className="tabular-nums min-w-[66px] text-right">{value.toFixed(0)}% settled</span>
      <span className="progress-track h-1.5 min-w-8 flex-1 overflow-hidden rounded-full">
        <span className="block h-full rounded-full bg-[var(--brand)] transition-[width]" style={{ width: `${value}%` }} />
      </span>
    </div>
  );
}
