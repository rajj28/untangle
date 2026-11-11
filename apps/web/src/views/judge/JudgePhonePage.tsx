import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, LoaderCircle, Plus } from "lucide-react";
import { api, ApiError } from "../../api.ts";
import { formatMoney } from "../../money.ts";

export function JudgePhonePage({ token }: { token: string }) {
  const networkQuery = useQuery({ queryKey: ["judge", token], queryFn: () => api.judgeNetwork(token), staleTime: 60_000 });
  const [direction, setDirection] = useState<"owe" | "owed">("owe");
  const [counterpartyId, setCounterpartyId] = useState<string>("");
  const [dollars, setDollars] = useState("");
  const [description, setDescription] = useState("");
  const [added, setAdded] = useState(false);

  const street = useMemo(() => {
    if (!networkQuery.data) return [];
    const you = networkQuery.data.youBusinessId;
    return networkQuery.data.network.businesses.filter((b) => b.id !== you);
  }, [networkQuery.data]);

  const selectedCounterparty = useMemo(() => {
    if (!networkQuery.data || !counterpartyId) return null;
    return networkQuery.data.network.businesses.find((b) => b.id === counterpartyId) ?? null;
  }, [counterpartyId, networkQuery.data]);

  const amountMinor = Math.round((Number(dollars) || 0) * 100);

  const add = useMutation({
    mutationFn: () => api.judgeAddObligation(token, {
      direction,
      counterpartyId,
      amountMinor,
      description: description.trim() || (direction === "owe" ? "Your invoice" : "The street owes you"),
    }),
    onSuccess: () => setAdded(true),
  });

  if (networkQuery.isLoading) {
    return <main className="app-shell flex min-h-[100dvh] items-center justify-center p-6"><span className="flex items-center gap-2 text-sm text-muted"><LoaderCircle size={16} className="animate-spin" />Loading…</span></main>;
  }
  if (networkQuery.error || !networkQuery.data) {
    const err = networkQuery.error as { status?: number; message?: string };
    return <main className="app-shell flex min-h-[100dvh] items-center justify-center p-6 text-center text-sm text-[var(--red)]">{err.message ?? "This judge link is not valid or has expired."}</main>;
  }

  const currency = networkQuery.data.network.network.currency;

  return (
    <main className="app-shell flex min-h-[100dvh] items-center justify-center p-4" style={{ background: "linear-gradient(180deg, var(--surface-soft), var(--surface))" }}>
      <div className="w-full max-w-md rounded-2xl border line bg-[var(--surface)] p-6 shadow-sm">
        {added ? (
          <div className="py-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--brand-tint)] text-[var(--brand)]"><Check size={22} /></div>
            <h1 className="mt-4 text-lg font-semibold">Invoice added</h1>
            <p className="mt-2 text-sm text-muted">The desk view just updated live. Check the loop that now includes you.</p>
            <button className="desk-button mt-6 h-9 px-4 text-xs" onClick={() => { setAdded(false); setDollars(""); setDescription(""); }}><Plus size={14} />Add another</button>
          </div>
        ) : (
          <>
            <h1 className="text-lg font-semibold tracking-tight">Add one invoice</h1>
            <p className="mt-1 text-xs text-muted">You are one business inside this street. The street's debts almost close a loop — your invoice closes it.</p>

            <div className="mt-5 grid grid-cols-2 gap-2 rounded-lg bg-[var(--surface-muted)] p-1">
              <button className={`rounded-md px-3 py-2 text-xs font-medium ${direction === "owe" ? "bg-[var(--surface)] text-[var(--ink)] shadow-sm" : "text-muted"}`} onClick={() => setDirection("owe")}>I owe a business</button>
              <button className={`rounded-md px-3 py-2 text-xs font-medium ${direction === "owed" ? "bg-[var(--surface)] text-[var(--ink)] shadow-sm" : "text-muted"}`} onClick={() => setDirection("owed")}>A business owes me</button>
            </div>

            <label className="mt-5 block text-xs font-medium text-soft">
              Counterparty
              <select className="desk-select mt-1.5 w-full text-sm" value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}>
                <option value="">Choose a business…</option>
                {street.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>

            <label className="mt-4 block text-xs font-medium text-soft">
              Amount ({currency})
              <div className="relative mt-1.5">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
                <input className="desk-input w-full pl-7 text-sm" type="number" min={1} step="0.01" inputMode="decimal" placeholder="0.00" value={dollars} onChange={(e) => setDollars(e.target.value)} />
              </div>
            </label>

            <label className="mt-4 block text-xs font-medium text-soft">
              What for?
              <input className="desk-input mt-1.5 w-full text-sm" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. paying for the catering" />
            </label>

            <button className="desk-button desk-button-primary mt-6 h-11 w-full text-sm" disabled={add.isPending || !counterpartyId || amountMinor <= 0} onClick={() => add.mutate()}>
              {add.isPending ? <LoaderCircle size={16} className="animate-spin" /> : <Plus size={16} />}
              {add.isPending ? "Adding…" : `Add ${direction === "owe" ? "your debt" : "the invoice owed to you"}${selectedCounterparty ? " · " + selectedCounterparty.name : ""}`}
            </button>
            {add.error && <p className="mt-3 rounded-md bg-[var(--red-tint)] px-3 py-2 text-xs text-[var(--red)]">{add.error instanceof ApiError ? add.error.message : "Could not add the invoice."}</p>}
          </>
        )}
      </div>
    </main>
  );
}
