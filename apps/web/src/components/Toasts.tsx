import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

export interface ToastMessage {
  id: number;
  kind: "success" | "error" | "info";
  title: string;
  code: string | null;
  debugId: string | null;
}

export function Toasts({ items, onDismiss }: { items: ToastMessage[]; onDismiss: (id: number) => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-[70] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2" aria-live="polite">
      {items.map((toast) => {
        const Icon = toast.kind === "success" ? CheckCircle2 : toast.kind === "error" ? AlertCircle : Info;
        const color = toast.kind === "success" ? "text-[var(--brand)]" : toast.kind === "error" ? "text-[var(--red)]" : "text-[var(--blue)]";
        return (
          <div key={toast.id} className="toast-enter surface rounded-lg border line p-3 shadow-[var(--shadow)]">
            <div className="flex gap-2.5">
              <Icon className={`mt-0.5 shrink-0 ${color}`} size={17} />
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-5">{toast.title}</p>
                {toast.code !== null && <p className="mt-1 font-mono text-[10px] text-muted">{toast.code}</p>}
                {toast.debugId !== null && <p className="mt-1 font-mono text-[10px] text-muted">PayPal debug id: {toast.debugId}</p>}
              </div>
              <button className="text-muted hover:text-[var(--ink)]" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification"><X size={15} /></button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
