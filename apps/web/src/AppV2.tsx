import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { api, ApiError } from "./api.ts";
import { useLiveEvents } from "./live.ts";
import type { ToastMessage } from "./components/Toasts.tsx";
import { Toasts } from "./components/Toasts.tsx";
import type { ThemeMode } from "./components/Header.tsx";
import { Dialog } from "./components/Dialog.tsx";
import type { AppRoute } from "./routes.ts";
import { defaultRoute, parseRoute, routeHash } from "./routes.ts";
import { BusinessPicker } from "./views/me/BusinessPicker.tsx";
import { BusinessExperience } from "./views/me/BusinessExperience.tsx";
import { Button } from "./ui/Button.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Skeleton } from "./ui/Skeleton.tsx";

const DeskApp = lazy(() => import("./desk/DeskApp.tsx"));
const LandingPage = lazy(() => import("./landing/LandingPage.tsx"));

function readTheme(): ThemeMode {
  try {
    return localStorage.getItem("untangle-theme") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function readRememberedBusiness(): string | null {
  try {
    return localStorage.getItem("untangle-business");
  } catch {
    return null;
  }
}

function readInitialRoute(): AppRoute {
  const current = parseRoute(window.location.hash);
  return current ?? defaultRoute(window.innerWidth, readRememberedBusiness());
}

function errorToast(error: unknown): Omit<ToastMessage, "id"> {
  if (error instanceof ApiError) {
    let title = error.message;
    if (error.code === "ROUND_IN_PROGRESS") title = "A settlement round is already in progress.";
    if (error.code === "NOTHING_TO_SETTLE") title = "There are no eligible invoices to settle.";
    if (error.code === "NOTHING_TO_PAY") title = "This business has no eligible transfers to pay.";
    return { kind: "error", title, code: error.code, debugId: error.debugId };
  }
  return { kind: "error", title: error instanceof Error ? error.message : "The request could not be completed.", code: null, debugId: null };
}

export default function AppV2() {
  const queryClient = useQueryClient();
  const [route, setRoute] = useState<AppRoute>(readInitialRoute);
  const [theme, setTheme] = useState<ThemeMode>(readTheme);
  const [actingAs, setActingAs] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastSequence = useRef(0);
  const { status: liveStatus, recentEvents } = useLiveEvents();

  const pushToast = useCallback((toast: Omit<ToastMessage, "id">) => {
    const id = ++toastSequence.current;
    setToasts((current) => [...current, { ...toast, id }].slice(-5));
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 6000);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);
  const navigate = useCallback((next: AppRoute) => {
    setRoute(next);
    const hash = routeHash(next);
    if (window.location.hash !== hash) window.location.hash = hash;
  }, []);

  useEffect(() => {
    const currentHash = parseRoute(window.location.hash);
    const canonical = routeHash(route);
    if (currentHash === null || window.location.hash === "") window.location.hash = canonical;
    const onHashChange = () => {
      const parsed = parseRoute(window.location.hash);
      if (parsed !== null) setRoute(parsed);
      else {
        const next = defaultRoute(window.innerWidth, readRememberedBusiness());
        setRoute(next);
        window.location.hash = routeHash(next);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
    // The initial hash is handled once; subsequent route changes use navigate/hashchange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("untangle-theme", theme);
    } catch {
      // Theme persistence is optional in restricted browser contexts.
    }
  }, [theme]);

  useEffect(() => {
    if (route.kind !== "business") return;
    try {
      localStorage.setItem("untangle-business", route.businessId);
    } catch {
      // A remembered business is a convenience and may be unavailable.
    }
  }, [route]);

  const configQuery = useQuery({ queryKey: ["config"], queryFn: api.config, staleTime: Infinity });
  const fallbackNetworks = useQuery({ queryKey: ["networks"], queryFn: api.networks, enabled: configQuery.data?.networkId === null, staleTime: Infinity });
  const networkId = configQuery.data?.networkId ?? fallbackNetworks.data?.[0]?.id ?? null;
  const summaryQuery = useQuery({ queryKey: ["network", networkId], queryFn: () => api.network(networkId ?? ""), enabled: networkId !== null, staleTime: Infinity });
  const obligationsQuery = useQuery({ queryKey: ["obligations", networkId], queryFn: () => api.obligations(networkId ?? ""), enabled: networkId !== null, staleTime: Infinity });
  const eventsQuery = useQuery({ queryKey: ["events"], queryFn: () => api.events(300), staleTime: Infinity });
  const latestRoundId = summaryQuery.data?.latestRound?.id ?? null;
  const latestRoundQuery = useQuery({ queryKey: ["round", latestRoundId], queryFn: () => api.round(latestRoundId ?? ""), enabled: route.kind === "desk" && latestRoundId !== null, staleTime: Infinity });

  const reset = useMutation({
    mutationFn: api.resetDemo,
    onSuccess: (result) => {
      setResetOpen(false);
      void queryClient.invalidateQueries();
      pushToast({ kind: "success", title: `Archived ${result.archived} invoices and created ${result.created} fresh invoices.`, code: null, debugId: null });
    },
    onError: (error) => pushToast(errorToast(error)),
  });

  const initialEvents = eventsQuery.data?.events ?? [];
  const events = useMemo(() => {
    const bySeq = new Map<number, (typeof recentEvents)[number]>();
    for (const event of [...initialEvents, ...recentEvents]) bySeq.set(event.seq, event);
    return [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(-300);
  }, [initialEvents, recentEvents]);
  const dataLoading = configQuery.isLoading
    || (configQuery.data?.networkId === null && fallbackNetworks.isLoading)
    || (networkId !== null && summaryQuery.isLoading);
  const themeToggle = () => setTheme((current) => current === "light" ? "dark" : "light");
  const openDesk = () => navigate({ kind: "desk", view: "settlement" });
  const openBusiness = () => {
    const businessId = actingAs || readRememberedBusiness();
    navigate(businessId ? { kind: "business", businessId, page: "home" } : { kind: "picker" });
  };

  let content: ReactNode;
  // The landing page never waits on the API: live figures fill in when they arrive.
  if (route.kind === "landing") content = <Suspense fallback={<div className="min-h-screen bg-[#0a0f1a]" />}>
    <LandingPage summary={summaryQuery.data} onOpenDesk={openDesk} onOpenBusiness={() => navigate({ kind: "picker" })} />
  </Suspense>;
  else if (dataLoading) content = <main className="app-shell h-full"><Skeleton variant="card" count={3} className="mx-auto max-w-xl p-5" /></main>;
  else if (configQuery.error) content = <ErrorPage title="Could not connect to Untangle" detail={configQuery.error.message} onRetry={() => void configQuery.refetch()} />;
  else if (!configQuery.data) content = <main className="app-shell h-full"><Skeleton variant="card" count={3} /></main>;
  else if (fallbackNetworks.error) content = <ErrorPage title="Networks could not be loaded" detail={fallbackNetworks.error.message} onRetry={() => void fallbackNetworks.refetch()} />;
  else if (summaryQuery.error) content = <ErrorPage title="Network data could not be loaded" detail={summaryQuery.error.message} onRetry={() => void summaryQuery.refetch()} />;
  else if (obligationsQuery.error) content = <ErrorPage title="Invoice data could not be loaded" detail={obligationsQuery.error.message} onRetry={() => void obligationsQuery.refetch()} />;
  else if (networkId === null || summaryQuery.data === undefined) content = <ErrorPage title="No clearing network is configured" detail="Start the server with a network to review and settle invoices." onRetry={() => void configQuery.refetch()} />;
  else {
    const summary = summaryQuery.data;
    const obligations = obligationsQuery.data ?? [];
    const routeBusiness = route.kind === "business" ? summary.businesses.find((item) => item.id === route.businessId) : undefined;
    if (route.kind === "picker") content = <BusinessPicker businesses={summary.businesses} obligations={obligations} currency={summary.network.currency} loading={obligationsQuery.isLoading} error={null} onChoose={(id) => navigate({ kind: "business", businessId: id, page: "home" })} onOpenDesk={openDesk} onRetry={() => void obligationsQuery.refetch()} theme={theme} onThemeToggle={themeToggle} />;
    else if (route.kind === "business" && routeBusiness) content = <BusinessExperience route={route} business={routeBusiness} summary={summary} obligations={obligations} events={events} config={configQuery.data} onNavigate={navigate} onToast={pushToast} onOpenDesk={openDesk} theme={theme} onThemeToggle={themeToggle} />;
    else if (route.kind === "business") content = <ErrorPage title="Business not found" detail="Choose a business from the current network to open its owner view." onRetry={() => navigate({ kind: "picker" })} action="Choose a business" />;
    else content = <Suspense fallback={<main className="app-shell h-full"><Skeleton variant="row" count={8} className="h-full p-5" /></main>}>
      <DeskApp route={route} summary={summary} obligations={obligations} round={latestRoundQuery.data ?? null} config={configQuery.data} actingAs={actingAs} liveStatus={liveStatus} theme={theme} events={events} loading={obligationsQuery.isLoading || eventsQuery.isLoading} activityError={eventsQuery.error} onRetryActivity={() => void eventsQuery.refetch()} onNavigate={navigate} onActingAs={setActingAs} onThemeToggle={themeToggle} onReset={() => setResetOpen(true)} onViewAsBusiness={openBusiness} onToast={pushToast} />
    </Suspense>;
  }

  return <>
    {content}
    <Toasts items={toasts} onDismiss={dismissToast} />
    <Dialog open={resetOpen} title="Archive all invoices and create a fresh Main Street?" onClose={() => setResetOpen(false)}>
      <p className="text-sm leading-6 text-soft">Recorded invoices will be archived in this demo network and a new set will be created for a clean settlement run.</p>
      <div className="mt-5 flex flex-col-reverse justify-end gap-2 sm:flex-row">
        <Button variant="secondary" onClick={() => setResetOpen(false)}>Cancel</Button>
        <Button variant="danger" onClick={() => reset.mutate()} loading={reset.isPending}><RotateCcw size={15} />{reset.isPending ? "Resetting…" : "Archive and reset"}</Button>
      </div>
    </Dialog>
  </>;
}

function ErrorPage({ title, detail, onRetry, action = "Try again" }: { title: string; detail: string; onRetry: () => void; action?: string }) {
  return <main className="app-shell flex min-h-full flex-col items-center justify-center p-6"><EmptyState title={title} detail={detail} action={action} onAction={onRetry} /></main>;
}
