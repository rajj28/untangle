import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, LoaderCircle, QrCode, Smartphone } from "lucide-react";
import { api } from "../../api.ts";
import type { JudgeNetwork } from "../../types.ts";
import { findLoops, planSettlement } from "@untangle/engine";
import { CollapseGraph } from "../CollapseGraph.tsx";
import { useLiveEvents } from "../../live.ts";
import { formatMoney } from "../../money.ts";

const TOKEN_KEY = "untangle-judge-token";

function readToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function JudgePage() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(readToken);
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const { recentEvents } = useLiveEvents();

  const start = useMutation({
    mutationFn: api.judgeStart,
    onSuccess: (info) => {
      try { localStorage.setItem(TOKEN_KEY, info.token); } catch { /* private mode */ }
      setToken(info.token);
    },
  });

  const networkQuery = useQuery({
    queryKey: ["judge", token],
    queryFn: () => api.judgeNetwork(token ?? ""),
    enabled: token !== null,
    staleTime: 5000,
  });

  useEffect(() => {
    if (networkQuery.error && token !== null) {
      const err = networkQuery.error as { code?: string };
      if (err.code === "JUDGE_TOKEN_NOT_FOUND" || err.code === "JUDGE_EXPIRED") {
        try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
        setToken(null);
      }
    }
  }, [networkQuery.error, token]);

  const data: JudgeNetwork | undefined = networkQuery.data;

  useEffect(() => {
    if (!token || !data) return;
    const netId = data.network.network.id;
    for (const event of recentEvents) {
      if (event.stream === `network:${netId}` && (event.type.startsWith("obligation.") || event.type.startsWith("judge.") || event.type === "network.seeded")) {
        void queryClient.invalidateQueries({ queryKey: ["judge", token] });
        break;
      }
    }
  }, [recentEvents, token, data, queryClient]);

  useEffect(() => {
    setQrSrc(null);
    if (!data || !data.network) return;
    let cancelled = false;
    const payload = buildQrPayload(token ?? "");
    if (!payload) return;
    void import("qrcode").then((mod) => mod.default.toDataURL(payload, { margin: 1, width: 240 })).then((url) => { if (!cancelled) setQrSrc(url); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [data, token]);

  const names = useMemo(() => {
    const map: Record<string, string> = {};
    if (data) for (const b of data.network.businesses) map[b.id] = b.name;
    return map;
  }, [data]);

  const engineObligations = useMemo(() => {
    if (!data) return [];
    return data.obligations.map((o) => ({ id: o.id, debtor: o.debtorId, creditor: o.creditorId, amount: o.outstandingMinor }));
  }, [data]);

  const plan = useMemo(() => {
    if (engineObligations.length === 0) return null;
    try { return planSettlement(engineObligations); } catch { return null; }
  }, [engineObligations]);

  const youLoop = useMemo(() => {
    if (!plan || !data?.youBusinessId) return null;
    const loops = findLoops(engineObligations, plan.setoffs);
    const you = data.youBusinessId;
    const found = loops.find((loop) => loop.memberIds.some((id) => {
      const o = data.obligations.find((item) => item.id === id);
      return o !== undefined && (o.debtorId === you || o.creditorId === you);
    }));
    return found ?? null;
  }, [plan, engineObligations, data]);

  if (token === null) {
    return (
      <main className="app-shell flex min-h-full items-center justify-center p-6">
        <div className="surface w-full max-w-xl rounded-xl border line p-6 text-center shadow-sm md:p-9">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--brand-tint)] text-[var(--brand)]"><ArrowRightLeft size={22} /></div>
          <h1 className="mt-4 text-xl font-semibold tracking-tight">Judge it yourself</h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            Start your own tiny street of six businesses whose debts almost close a loop. Then use the QR code to add one invoice from your phone and watch the engine close the loop around you.
          </p>
          <p className="mt-3 text-[10px] text-muted">Sandbox only · max 20 per hour · auto-deletes after 2 hours.</p>
          <button className="desk-button desk-button-primary mt-6 h-10 px-5" onClick={() => start.mutate()} disabled={start.isPending}>
            {start.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <ArrowRightLeft size={15} />}
            {start.isPending ? "Starting your network…" : "Start your own network"}
          </button>
        </div>
      </main>
    );
  }

  if (networkQuery.isLoading || !data) {
    return <main className="app-shell flex min-h-full items-center justify-center p-6"><span className="flex items-center gap-2 text-sm text-muted"><LoaderCircle size={16} className="animate-spin" />Loading your judge network…</span></main>;
  }

  const summary = data.network;

  return (
    <main className="app-shell h-full overflow-auto">
      <div className="flex min-h-[52px] items-center gap-3 border-b line bg-[var(--surface)] px-4">
        <div><h1 className="text-sm font-semibold tracking-tight">Your judge network</h1>
          <p className="text-[10px] text-muted">{summary.network.name} · {summary.businesses.length} businesses · {summary.totals.obligations} invoices · {formatMoney(summary.totals.outstandingMinor, summary.network.currency)} outstanding</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <a className="desk-button" href={`#/judge/phone/${encodeURIComponent(token)}`}><Smartphone size={14} />Open on your phone</a>
          {qrSrc && <img src={qrSrc} alt="QR code to open the phone page" className="h-14 w-14 rounded border line" />}
          {!qrSrc && <span className="flex h-14 w-14 items-center justify-center rounded border line text-muted"><QrCode size={20} /></span>}
        </div>
      </div>
      {youLoop && (
        <div className="border-b line bg-[var(--brand-tint)] px-4 py-2 text-[11px] text-[var(--brand-strong)]">
          The engine finds a loop that includes <b>You</b>: {youLoop.memberIds.length} invoices, {formatMoney(youLoop.amount, summary.network.currency)} off each, {formatMoney(youLoop.amount * youLoop.memberIds.length, summary.network.currency)} cleared with no money moving.
        </div>
      )}
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_300px] gap-0 p-0">
        <div className="flex min-h-[420px] flex-col border-r line">
          <div className="flex items-center justify-between border-b line bg-[var(--surface)] px-4 py-2">
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted">Before → after collapse</h2>
            {plan && <span className="text-[9px] text-muted">engine plan · leverage {plan.stats.leverage === null ? "—" : plan.stats.leverage.toFixed(1) + "×"}</span>}
          </div>
          {plan
            ? <CollapseGraph nodes={summary.businesses.map((b) => ({ id: b.id, name: b.name }))} obligations={engineObligations} plan={plan} currency={summary.network.currency} names={names} height={420} />
            : <div className="flex flex-1 items-center justify-center text-sm text-muted">No obligations to settle yet.</div>}
        </div>
        <aside className="flex min-h-0 flex-col overflow-y-auto bg-[var(--surface)]">
          <div className="sticky top-0 border-b line bg-[var(--surface)] px-4 py-2"><h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted">Street ledger</h2></div>
          <ul className="divide-y line">
            {summary.businesses.map((b) => {
              const owes = data.obligations.filter((o) => o.debtorId === b.id).reduce((s, o) => s + o.outstandingMinor, 0);
              const owed = data.obligations.filter((o) => o.creditorId === b.id).reduce((s, o) => s + o.outstandingMinor, 0);
              return (
                <li key={b.id} className="px-4 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className={`font-medium ${b.name === "You" ? "text-[var(--brand)]" : ""}`}>{b.name}</span>
                    <span className="tabular-nums text-muted">{formatMoney(owed - owes, summary.network.currency)}</span>
                  </div>
                  <p className="text-[9px] text-muted">owes {formatMoney(owes, summary.network.currency)} · owed {formatMoney(owed, summary.network.currency)}</p>
                </li>
              );
            })}
          </ul>
          <div className="px-4 py-3 text-[10px] leading-4 text-muted">
            Add one invoice from the phone page to pull the street into a loop through <b>You</b>.
          </div>
        </aside>
      </div>
    </main>
  );
}

function buildQrPayload(token: string): string | null {
  const base = window.location.origin + window.location.pathname;
  return `${base}#/judge/phone/${encodeURIComponent(token)}`;
}
