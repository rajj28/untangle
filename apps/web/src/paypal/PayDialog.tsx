import { useEffect, useState } from "react";
import { CheckCircle2, CreditCard, LoaderCircle, ShieldCheck } from "lucide-react";
import { api, ApiError } from "../api.ts";
import { formatMoney } from "../money.ts";
import type { Config, ObligationView, TransferView } from "../types.ts";
import { Button } from "../ui/Button.tsx";
import { Sheet } from "../ui/Sheet.tsx";
import type { ToastMessage } from "../components/Toasts.tsx";
import { getPayPalInstance, type PayPalOneTimePaymentSession } from "./sdk.ts";

type PushToast = (toast: Omit<ToastMessage, "id">) => void;

type CheckoutState = "loading" | "ready" | "ineligible" | "cancelled" | "recording" | "error";

export function PayDialog({
  transfer,
  payeeName,
  config,
  obligations,
  onClose,
  onRefresh,
  onToast,
}: {
  transfer: TransferView | null;
  payeeName: string;
  config: Config;
  obligations: ObligationView[];
  onClose: () => void;
  onRefresh: () => void;
  onToast: PushToast;
}) {
  const [state, setState] = useState<CheckoutState>("loading");
  const [message, setMessage] = useState("");
  const [orderId, setOrderId] = useState("");
  const [session, setSession] = useState<PayPalOneTimePaymentSession | null>(null);
  const [busy, setBusy] = useState(false);
  const transferId = transfer?.id ?? "";

  useEffect(() => {
    if (transfer === null) return;
    if (transfer.status === "committed") {
      setState("recording");
      setMessage("Paid. Recording the payment on PayPal invoices…");
      const timeout = window.setTimeout(onClose, 900);
      return () => window.clearTimeout(timeout);
    }
  }, [onClose, transfer?.id, transfer?.status]);

  useEffect(() => {
    if (transfer === null || config.mode !== "sandbox" || !["ready", "awaiting_payer"].includes(transfer.status)) return;
    let cancelled = false;
    setState("loading");
    setMessage("");
    void (async () => {
      try {
        const order = await api.order(transfer.id);
        if (cancelled) return;
        setOrderId(order.orderId);
        if (config.paypalSdkUrl === null) throw new Error("PayPal checkout is not configured for this network.");
        const paypal = await getPayPalInstance(config.paypalSdkUrl, order.clientId);
        const eligibility = await paypal.findEligibleMethods();
        if (!eligibility.isEligible("paypal")) {
          setState("ineligible");
          setMessage("PayPal checkout is not available in this browser.");
          return;
        }
        const checkout = await paypal.createPayPalOneTimePaymentSession({
          onApprove: async (approval) => {
            setState("recording");
            setMessage(`Paid. Recording the payment on ${transfer.legs.length} PayPal invoices…`);
            try {
              await api.capture(transfer.id, approval.orderId);
              onRefresh();
            } catch (error) {
              reportError(error, onToast);
              setState("error");
            }
          },
          onCancel: () => {
            setState("cancelled");
            setMessage("Payment cancelled.");
          },
          onError: (error) => {
            setState("error");
            setMessage(error.message);
            onToast({ kind: "error", title: error.message, code: "PAYPAL_ERROR", debugId: null });
          },
        });
        if (!cancelled) setSession(checkout);
        if (!cancelled) setState("ready");
      } catch (error) {
        if (cancelled) return;
        setState("error");
        setMessage(error instanceof Error ? error.message : "Could not start PayPal checkout.");
        reportError(error, onToast);
      }
    })();
    return () => { cancelled = true; };
  }, [config.mode, config.paypalSdkUrl, onRefresh, onToast, transferId]);

  if (transfer === null) return null;
  const legs = transfer.legs.map((leg) => ({ leg, obligation: obligations.find((item) => item.id === leg.obligationId) }));
  const startCheckout = () => {
    if (session === null || orderId === "") return;
    try {
      void Promise.resolve(session.start({ presentationMode: "auto" }, Promise.resolve({ orderId }))).catch((error: unknown) => {
        setState("error");
        setMessage(error instanceof Error ? error.message : "PayPal could not start checkout.");
        reportError(error, onToast);
      });
    } catch (error) {
      reportError(error, onToast);
    }
  };
  const simulate = async () => {
    setBusy(true);
    setState("recording");
    setMessage(`Paid. Recording the payment on ${transfer.legs.length} PayPal invoices…`);
    try {
      await api.approveSim(transfer.id);
      onRefresh();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Simulator approval failed.");
      reportError(error, onToast);
    } finally {
      setBusy(false);
    }
  };
  const title = `Pay ${payeeName} ${formatMoney(transfer.amountMinor, transfer.currency)}`;

  return (
    <Sheet open title={title} onClose={onClose} wide fullHeightMobile>
      <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(210px,260px)]">
        <div className="min-w-0">
          <p className="text-sm text-soft">This one PayPal payment settles <b className="tabular-nums text-[var(--ink)]">{transfer.legs.length} {transfer.legs.length === 1 ? "invoice" : "invoices"}</b> along the chain:</p>
          <div className="mt-3 divide-y divide-[var(--line)] rounded-lg border line">
            {legs.map(({ leg, obligation }) => <div key={leg.obligationId} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-xs">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
              <span className="min-w-0 flex-1 truncate">{obligation ? `${obligation.debtorName} → ${obligation.creditorName}` : "Invoice leg"}<span className="ml-1 text-muted">{obligation?.description ? `· ${obligation.description}` : ""}</span></span>
              <span className="ml-auto shrink-0 tabular-nums font-medium">{formatMoney(leg.amountMinor, transfer.currency)}</span>
            </div>)}
          </div>
          {state === "recording" && <div className="mt-4 flex items-center gap-2 rounded-md bg-[var(--brand-tint)] px-3 py-2.5 text-xs text-[var(--brand-strong)]"><LoaderCircle size={14} className="animate-spin" />{message}</div>}
          {state === "cancelled" && <p className="mt-4 text-xs text-muted">{message}</p>}
          {state === "ineligible" && <p className="mt-4 text-xs text-[var(--red)]">{message}</p>}
          {state === "error" && <p className="mt-4 text-xs text-[var(--red)]">{message}</p>}
        </div>
        <aside className="flex min-w-0 flex-col justify-between rounded-lg border line bg-[var(--surface-soft)] p-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold"><ShieldCheck size={15} className="text-[var(--brand)]" />Secure settlement</div>
            <p className="mt-2 text-[10px] leading-4 text-muted">The payer approves one payment to the final creditor. Untangle then records each invoice leg.</p>
          </div>
          {config.mode === "sim" ? <div className="mt-5">
            <p className="simulator-note mb-2 text-[10px] font-medium">Simulator: no real PayPal</p>
            <Button variant="primary" className="w-full" onClick={() => void simulate()} loading={busy} disabled={state === "recording"}><CreditCard size={15} />Simulate PayPal approval</Button>
          </div> : <div className="mt-5">
            {state === "loading" ? <div className="flex items-center justify-center gap-2 py-2 text-[10px] text-muted"><LoaderCircle size={14} className="animate-spin" />Preparing checkout…</div>
              : state === "ready" && session !== null ? <>
                <paypal-button className="paypal-checkout-button block w-full cursor-pointer rounded-md px-3 py-2 text-center text-xs font-semibold text-white" onClick={(event) => { event.preventDefault(); startCheckout(); }}>Continue with PayPal</paypal-button>
                <Button variant="ghost" className="mt-2 w-full" onClick={() => { setState("cancelled"); setMessage("Payment cancelled."); }}>Cancel</Button>
              </> : <button className="desk-button w-full" onClick={onClose}>{state === "ineligible" ? "Close" : "Back to settlement"}</button>}
          </div>}
          {transfer.status === "committed" && <div className="mt-3 flex items-center gap-1.5 text-[10px] text-[var(--brand)]"><CheckCircle2 size={13} />Paid</div>}
        </aside>
      </div>
    </Sheet>
  );
}

function reportError(error: unknown, onToast: PushToast): void {
  if (error instanceof ApiError) {
    onToast({ kind: "error", title: plainMessage(error.code, error.message), code: error.code, debugId: error.debugId });
    return;
  }
  onToast({ kind: "error", title: error instanceof Error ? error.message : "The request could not be completed.", code: null, debugId: null });
}

function plainMessage(code: string, message: string): string {
  if (code === "ROUND_IN_PROGRESS") return "A settlement round is already in progress.";
  if (code === "NOTHING_TO_SETTLE") return "There are no eligible invoices to include in a settlement round.";
  if (code === "TRANSFER_NOT_PAYABLE") return "This transfer is no longer ready for payment.";
  return message;
}
