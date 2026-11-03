export function Skeleton({ lines = 4, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`animate-pulse space-y-3 p-5 ${className}`} aria-label="Loading">
      {Array.from({ length: lines }, (_, index) => <div key={index} className={`skeleton-block h-9 rounded ${index === 0 ? "w-2/5" : "w-full"}`} />)}
    </div>
  );
}
