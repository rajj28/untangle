import type { ReactNode } from "react";

export function StatTile({ label, value, detail, tone = "default" }: { label: string; value: ReactNode; detail?: ReactNode; tone?: "default" | "brand" | "amber" }) {
  return <div className={`ui-stat-tile ui-stat-tile-${tone}`}>
    <p className="ui-stat-label">{label}</p>
    <div className="ui-stat-value">{value}</div>
    {detail !== undefined && <p className="ui-stat-detail">{detail}</p>}
  </div>;
}
