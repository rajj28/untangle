import { useEffect, useRef, useState } from "react";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import type { NetPositionVerifyResult } from "../types.ts";
import { runVerification } from "../verify.ts";

type VerifyState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: NetPositionVerifyResult };

/**
 * Runs the 10,000-random-network net-position proof in a Web Worker and shows
 * the result: networks checked, time, max deviation, and how many networks moved
 * exactly the minimum cash.
 */
export function NetProofVerifier({ variant = "button" }: { variant?: "button" | "panel" }) {
  const [state, setState] = useState<VerifyState>({ status: "idle" });
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);

  const run = () => {
    setState({ status: "running" });
    const count = 10_000;
    const inline = () => window.setTimeout(() => setState({ status: "done", result: runVerification(count) }), 30);
    try {
      worker.current ??= new Worker(new URL("../verify.worker.ts", import.meta.url), { type: "module" });
      worker.current.onmessage = (event: MessageEvent<NetPositionVerifyResult>) => setState({ status: "done", result: event.data });
      worker.current.onerror = () => {
        worker.current?.terminate();
        worker.current = null;
        inline();
      };
      worker.current.postMessage({ count });
    } catch {
      inline();
    }
  };

  if (variant === "panel") {
    return (
      <div className="rounded-xl border line bg-[var(--surface)] p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted"><ShieldCheck size={14} />Net-position proof</div>
          <button className="desk-button desk-button-primary h-8 text-xs" onClick={run} disabled={state.status === "running"}>
            {state.status === "running" ? <LoaderCircle size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
            {state.status === "running" ? "Verifying…" : "Verify 10,000 networks"}
          </button>
        </div>
        {state.status === "done" && <VerifyResult result={state.result} />}
      </div>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button className="desk-button" onClick={run} disabled={state.status === "running"} title="Runs the net-position proof on 10,000 random networks in a Web Worker">
        {state.status === "running" ? <LoaderCircle size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
        {state.status === "running" ? "Verifying…" : "Verify"}
      </button>
      {state.status === "done" && <VerifyResult result={state.result} compact />}
    </span>
  );
}

function VerifyResult({ result, compact = false }: { result: NetPositionVerifyResult; compact?: boolean }) {
  const maxDev = result.maxAbsDelta;
  const minCash = result.minCashPassed === result.minCashTotal;
  if (compact) {
    return (
      <span className="text-[10px] text-muted">
        {result.networksChecked.toLocaleString()} networks · {result.millis} ms · max Δ {maxDev} · min-cash {result.minCashPassed}/{result.minCashTotal}
      </span>
    );
  }
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
      <div><p className="text-[9px] uppercase tracking-wider text-muted">Networks checked</p><p className="font-semibold tabular-nums">{result.networksChecked.toLocaleString()}</p></div>
      <div><p className="text-[9px] uppercase tracking-wider text-muted">Time taken</p><p className="font-semibold tabular-nums">{result.millis} ms</p></div>
      <div><p className="text-[9px] uppercase tracking-wider text-muted">Max deviation</p><p className="font-semibold tabular-nums">{maxDev}</p></div>
      <div><p className="text-[9px] uppercase tracking-wider text-muted">Minimum cash</p><p className={`font-semibold tabular-nums ${minCash ? "text-[var(--brand)]" : "text-[var(--red)]"}`}>{result.minCashPassed}/{result.minCashTotal}</p></div>
    </div>
  );
}
