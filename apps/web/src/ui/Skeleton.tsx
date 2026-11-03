export function Skeleton({ variant = "text", count = 3, className = "" }: { variant?: "text" | "card" | "row"; count?: number; className?: string }) {
  return <div className={`ui-skeleton-list ${className}`} role="status" aria-label="Loading">
    {Array.from({ length: count }, (_, index) => <div key={index} className={`ui-skeleton ui-skeleton-${variant}`} />)}
  </div>;
}
