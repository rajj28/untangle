import { loadFont } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

export const { fontFamily } = loadFont("normal", { weights: ["400", "500", "600", "700", "800", "900"], subsets: ["latin"] });
export const { fontFamily: monoFamily } = loadMono("normal", { weights: ["500", "700"], subsets: ["latin"] });

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const C = {
  bg: "#060a13",
  bgSoft: "#0b1220",
  ink: "#f8fafc",
  soft: "#94a3b8",
  muted: "#64748b",
  line: "rgba(148,163,184,0.28)",
  owed: "#fb7185",
  waiting: "#f59e0b",
  teal: "#2dd4bf",
  tealDeep: "#0f766e",
  paypal: "#0070e0",
  paypalBright: "#3b9bff",
  green: "#34d399",
  card: "#ffffff",
};

/** Business colours, bright enough for a dark background. */
export const SHOP_COLORS: Record<string, string> = {
  b1: "#fb7185", // Rosa's Bakery
  b2: "#fbbf24", // Rossi Mill
  b3: "#2dd4bf", // Ortega Trucking
  b4: "#a78bfa", // Corner Cafe
  b5: "#4ade80", // Green Valley Dairy
  b6: "#f97316", // Bean & Leaf Roasters
  b7: "#38bdf8", // Main St Print Shop
  b8: "#60a5fa", // Sparkle Cleaning Co
  b9: "#e879f9", // Lee & Patel Accounting
};

export const usd = (minor: number) => `$${(minor / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export function initials(name: string): string {
  const words = name.replace(/[^A-Za-z& ]/g, "").split(/\s+/).filter((word) => word.length > 0 && word !== "&");
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase();
}
