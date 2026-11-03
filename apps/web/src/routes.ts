export type DeskView = "ledger" | "settlement" | "network" | "matrix" | "activity" | "agents";
export type BusinessPage = "home" | "invoices" | "assistant" | "activity";

export type AppRoute =
  | { kind: "landing" }
  | { kind: "picker" }
  | { kind: "business"; businessId: string; page: BusinessPage }
  | { kind: "desk"; view: DeskView };

const DESK_VIEWS: readonly DeskView[] = ["ledger", "settlement", "network", "matrix", "activity", "agents"];
const BUSINESS_PAGES: readonly BusinessPage[] = ["home", "invoices", "assistant", "activity"];

export function parseRoute(hash: string): AppRoute | null {
  const path = hash.startsWith("#") ? hash.slice(1) : hash;
  if (path === "" || path === "/") return { kind: "landing" };
  if (path === "/me" || path === "/me/") return { kind: "picker" };
  const deskMatch = /^\/desk\/([^/]+)\/?$/.exec(path);
  const deskView = deskMatch?.[1];
  if (deskView !== undefined && DESK_VIEWS.includes(deskView as DeskView)) {
    return { kind: "desk", view: deskView as DeskView };
  }
  const businessMatch = /^\/me\/([^/]+)(?:\/([^/]+))?\/?$/.exec(path);
  const rawBusinessId = businessMatch?.[1];
  const rawPage = businessMatch?.[2];
  if (rawBusinessId === undefined) return null;
  let businessId: string;
  try {
    businessId = decodeURIComponent(rawBusinessId);
  } catch {
    return null;
  }
  if (businessId.length === 0) return null;
  const page = rawPage ?? "home";
  if (!BUSINESS_PAGES.includes(page as BusinessPage)) return null;
  return { kind: "business", businessId, page: page as BusinessPage };
}

export function defaultRoute(width: number, rememberedBusinessId: string | null): AppRoute {
  if (width < 768) {
    return rememberedBusinessId === null
      ? { kind: "picker" }
      : { kind: "business", businessId: rememberedBusinessId, page: "home" };
  }
  return { kind: "desk", view: "settlement" };
}

export function routeHash(route: AppRoute): string {
  if (route.kind === "landing") return "#/";
  if (route.kind === "picker") return "#/me";
  if (route.kind === "desk") return `#/desk/${route.view}`;
  return route.page === "home"
    ? `#/me/${encodeURIComponent(route.businessId)}`
    : `#/me/${encodeURIComponent(route.businessId)}/${route.page}`;
}
