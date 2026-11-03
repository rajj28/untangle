import { planSettlement } from "@untangle/engine";
import type { SettlementPlan } from "@untangle/engine";

export interface Shop {
  id: string;
  name: string;
  /** Shown on the map, where space is tight. */
  label: string;
  initials: string;
  color: string;
}

/** One invoice: `from` owes `to` `amount` cents. */
export interface Debt {
  id: string;
  from: string;
  to: string;
  amount: number;
}

// Ordered around the circle so the story's loop (bakery, mill, trucking) forms a triangle and every
// other preset invoice runs between neighbours: the street draws with no crossings.
export const SHOPS: readonly Shop[] = [
  { id: "rosa", name: "Rosa's Bakery", label: "Bakery", initials: "RB", color: "#e11d48" },
  { id: "mill", name: "Rossi Mill", label: "Mill", initials: "RM", color: "#d97706" },
  { id: "ortega", name: "Ortega Trucking", label: "Trucking", initials: "OT", color: "#0f766e" },
  { id: "dairy", name: "Green Valley Dairy", label: "Dairy", initials: "GV", color: "#16a34a" },
  { id: "cafe", name: "Corner Cafe", label: "Cafe", initials: "CC", color: "#7c3aed" },
  { id: "sparkle", name: "Sparkle Cleaning", label: "Cleaning", initials: "SC", color: "#0284c7" },
];

/** The street from the story: Rosa, the mill and Ortega owe each other in a circle, and their neighbours join in. */
export const PRESET: readonly Debt[] = [
  { id: "p1", from: "rosa", to: "mill", amount: 300_000 },
  { id: "p2", from: "mill", to: "ortega", amount: 240_000 },
  { id: "p3", from: "ortega", to: "rosa", amount: 280_000 },
  { id: "p4", from: "cafe", to: "rosa", amount: 120_000 },
  { id: "p5", from: "cafe", to: "dairy", amount: 90_000 },
  { id: "p6", from: "dairy", to: "ortega", amount: 70_000 },
  { id: "p7", from: "rosa", to: "sparkle", amount: 40_000 },
  { id: "p8", from: "sparkle", to: "cafe", amount: 30_000 },
  { id: "p9", from: "ortega", to: "cafe", amount: 45_000 },
];

export const shopById = new Map(SHOPS.map((shop) => [shop.id, shop]));

export function dollars(minor: number): string {
  return `$${(minor / 100).toLocaleString("en-US", { maximumFractionDigits: minor % 100 === 0 ? 0 : 2, minimumFractionDigits: minor % 100 === 0 ? 0 : 2 })}`;
}

export function planStreet(debts: readonly Debt[]): SettlementPlan {
  return planSettlement(debts.map((debt) => ({ id: debt.id, debtor: debt.from, creditor: debt.to, amount: debt.amount })));
}

let sequence = 0;
export function nextDebtId(): string {
  sequence += 1;
  return `d${Date.now().toString(36)}${sequence}`;
}

/** A believable street: one or two loops of similar amounts, plus a few one-way invoices. */
export function randomStreet(random: () => number = Math.random): Debt[] {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const amount = (base: number) => Math.max(5_000, Math.round((base * (0.6 + random() * 0.8)) / 1_000) * 1_000);
  const debts: Debt[] = [];
  const ids = SHOPS.map((shop) => shop.id);
  for (let loop = 0; loop < 1 + Math.floor(random() * 2); loop++) {
    const members = [...ids].sort(() => random() - 0.5).slice(0, 3 + Math.floor(random() * 2));
    const base = 50_000 + Math.floor(random() * 250_000);
    members.forEach((from, index) => debts.push({ id: nextDebtId(), from, to: members[(index + 1) % members.length]!, amount: amount(base) }));
  }
  const extra = 2 + Math.floor(random() * 3);
  for (let i = 0; i < extra; i++) {
    const from = pick(ids);
    const to = pick(ids.filter((id) => id !== from));
    debts.push({ id: nextDebtId(), from, to, amount: amount(80_000) });
  }
  return debts;
}

export interface Point { x: number; y: number }

/** Shops sit on a circle, starting at the top. */
export function layout(width: number, height: number, radius: number): Map<string, Point> {
  const positions = new Map<string, Point>();
  SHOPS.forEach((shop, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / SHOPS.length;
    positions.set(shop.id, { x: width / 2 + radius * Math.cos(angle), y: height / 2 + radius * Math.sin(angle) });
  });
  return positions;
}

/**
 * Which way an arrow bows, as a signed share of its length: toward the middle of the street so amounts
 * stay clear of the shops, gently for long chords so their labels don't pile up in the centre. Two-way
 * pairs bow to the right of travel, which pulls them apart.
 */
export function bendFor(from: Point, to: Point, center: Point, twoWay: boolean): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const toCenter = { x: center.x - (from.x + to.x) / 2, y: center.y - (from.y + to.y) / 2 };
  if (twoWay || Math.hypot(toCenter.x, toCenter.y) < 1) return 0.2;
  const sign = Math.sign(-dy * toCenter.x + dx * toCenter.y) || 1;
  return sign * (Math.hypot(dx, dy) > 180 ? 0.12 : 0.2);
}

/** A curved arrow from one shop to another that stops at both circles; positive bends bow right of travel. */
export function arc(from: Point, to: Point, nodeRadius: number, bend = 0.2): { path: string; mid: Point } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const control = { x: (from.x + to.x) / 2 - (dy / length) * length * bend, y: (from.y + to.y) / 2 + (dx / length) * length * bend };
  const trim = (point: Point, toward: Point, by: number): Point => {
    const tx = toward.x - point.x;
    const ty = toward.y - point.y;
    const distance = Math.hypot(tx, ty) || 1;
    return { x: point.x + (tx / distance) * by, y: point.y + (ty / distance) * by };
  };
  const start = trim(from, control, nodeRadius + 3);
  const end = trim(to, control, nodeRadius + 7);
  const mid = { x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x, y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y };
  return { path: `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${control.x.toFixed(1)} ${control.y.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`, mid };
}
