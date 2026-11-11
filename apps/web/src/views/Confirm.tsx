import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, Check, FileCheck2, LoaderCircle, ShieldCheck } from "lucide-react";
import { api, ApiError } from "../api.ts";
import type { ConfirmView } from "../types.ts";
import { formatMoney } from "../money.ts";
import { Button } from "../ui/Button.tsx";

export function Confirm({ token }: { token: string }) {
  const [reason, setReason] = useState("");
  const [decided, setDecided] = useState<ConfirmView | null>(null);
  const query = useQuery({ queryKey: ["confirm", token], queryFn: () => api.confirm(token), staleTime: Infinity });
  const decide = useMutation({
    mutationFn: (decision: "confirm" | "reject") =>
      api.confirmDecide(token, decision === "reject" ? { decision, reason } : { decision }),
    onSuccess: (view) => {
      setDecided(view);
    },
  });

  if (query.isLoading) return <ConfirmShell><LoaderCircle className="animate-spin text-muted" /></ConfirmShell>;

  if (query.error || !query.data) {
    const error = query.error;
    const message = error instanceof ApiError ? error.message : "This confirmation link is not valid.";
    return (
      <ConfirmShell>
        <div className="text-center">
          <AlertTriangle className="mx-auto text-[var(--red)]" size={28} />
          <h1 className="mt-3 text-lg font-semibold">Link not valid</h1>
          <p className="mt-1 text-sm text-muted">{message}</p>
        </div>
      </ConfirmShell>
    );
  }

  const view = decided ?? query.data;
  const bothSides = view.debtorConfirmed && view.creditorConfirmed;
  const disputed = view.status === "disputed";

  return (
    <ConfirmShell>
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border line bg-[var(--surface)] p-5">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.12em] text-[var(--brand)]">
            <FileCheck2 size={14} />Debt confirmation
          </div>
          <h1 className="mt-2 text-xl font-semibold tracking-tight">{view.creditor.name} is owed {formatMoney(view.amountMinor, view.currency)} by {view.debtor.name}</h1>
          {view.description && <p className="mt-1 text-sm text-muted">{view.description}</p>}
          {view.evidenceSummary && <p className="mt-3 rounded-md bg-[var(--surface-soft)] px-3 py-2 text-xs text-soft">Evidence: {view.evidenceSummary}</p>}
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted">Debtor</p>
              <p className="font-medium">{view.debtor.name}</p>
              <p className="text-[10px] text-muted">{view.debtorConfirmed ? <span className="flex items-center gap-1 text-[var(--brand)]"><Check size={12} />confirmed</span> : "not confirmed"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted">Creditor</p>
              <p className="font-medium">{view.creditor.name}</p>
              <p className="text-[10px] text-muted">{view.creditorConfirmed ? <span className="flex items-center gap-1 text-[var(--brand)]"><Check size={12} />confirmed</span> : "not confirmed"}</p>
            </div>
          </div>
        </div>

        {disputed ? (
          <div className="rounded-xl border border-[var(--red)]/30 bg-[var(--red-tint)] px-4 py-3 text-sm text-[var(--red)]">
            This invoice is <strong>disputed</strong>.{view.disputeReason ? ` Reason: ${view.disputeReason}` : ""}
          </div>
        ) : decided ? (
          <div className="rounded-xl border line bg-[var(--brand-tint)] px-4 py-3 text-sm text-[var(--brand-strong)]">
            <span className="flex items-center gap-2 font-semibold"><ShieldCheck size={16} />{decided.side === "debtor" ? "Debtor" : "Creditor"} side recorded</span>
            {bothSides ? <p className="mt-1">Both sides have confirmed this invoice. It can now enter a settlement round.</p> : <p className="mt-1">The other side still needs to confirm.</p>}
          </div>
        ) : (decide.isPending ? (
          <div className="flex items-center justify-center gap-2 text-sm text-muted"><LoaderCircle className="animate-spin" size={16} />Recording…</div>
        ) : (
          <div className="flex flex-col gap-3">
            <Button variant="primary" className="w-full" onClick={() => decide.mutate("confirm")} disabled={decide.isPending}>
              <Check size={15} />Confirm this invoice
            </Button>
            <div className="rounded-xl border line p-3">
              <label className="text-xs font-medium text-soft">
                If this debt is wrong, reject it and tell us why (optional)
                <textarea
                  className="desk-input mt-1.5 h-20 w-full resize-none text-sm"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="e.g. we already paid this invoice last month…"
                  maxLength={500}
                />
              </label>
              <Button variant="danger" className="mt-2 w-full" onClick={() => decide.mutate("reject")} disabled={decide.isPending}>
                <AlertTriangle size={15} />Reject and dispute
              </Button>
            </div>
          </div>
        ))}
      </div>
    </ConfirmShell>
  );
}

function ConfirmShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[var(--surface-muted)] p-4">
      <div className="w-full max-w-md">{children}</div>
      <p className="mt-6 text-center text-[10px] text-muted">Confirmation is recorded on the clearing network ledger.</p>
    </main>
  );
}
