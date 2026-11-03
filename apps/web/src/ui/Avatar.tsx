import { useMemo } from "react";

const PALETTE = ["#0f766e", "#2563eb", "#7c3aed", "#be123c", "#b45309", "#0e7490", "#4d7c0f", "#9333ea"] as const;

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]?.toLocaleUpperCase() ?? "").join("") || "U";
}

function colorForId(id: string): string {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return PALETTE[(hash >>> 0) % PALETTE.length] ?? PALETTE[0];
}

export function Avatar({ name, id, size = "md" }: { name: string; id: string; size?: "sm" | "md" | "lg" }) {
  const backgroundColor = useMemo(() => colorForId(id), [id]);
  const dimension = size === "sm" ? "h-9 w-9 text-xs" : size === "lg" ? "h-14 w-14 text-base" : "h-11 w-11 text-sm";
  return <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${dimension}`} style={{ backgroundColor }}>
    {initials(name)}
  </span>;
}
