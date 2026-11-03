import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, JSX } from "react";
import { Plus, RotateCcw, Shuffle, Sparkles, X } from "lucide-react";
import type { SettlementPlan } from "@untangle/engine";
import { untangleCity } from "./city.ts";
import type { CityRequest, CityResult } from "./city.ts";
import { arc, bendFor, dollars, layout, nextDebtId, planStreet, PRESET, randomStreet, shopById, SHOPS } from "./street.ts";
import type { Debt, Point } from "./street.ts";

type Phase = "before" | "loops" | "after";

const WIDTH = 440;
const HEIGHT = 400;
const NODE = 26;
const LOOPS_MS = 2000;

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function Playground(): JSX.Element {
  const [mode, setMode] = useState<"street" | "city">("street");
  return (
    <div className="pg bg-white">
      <div className="flex justify-center border-b border-zinc-200 bg-zinc-50 px-4 py-3">
        <div role="tablist" aria-label="Playground mode" className="inline-flex rounded-full bg-zinc-200/70 p-1">
          {([["street", "Your street"], ["city", "A whole city"]] as const).map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => setMode(value)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${mode === value ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {mode === "street" ? <StreetPlayground /> : <CityPlayground />}
    </div>
  );
}

// ── Your street ────────────────────────────────────────────────────────────

function StreetPlayground(): JSX.Element {
  const [debts, setDebts] = useState<Debt[]>(() => [...PRESET]);
  const [phase, setPhase] = useState<Phase>("before");
  const [run, setRun] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const plan = useMemo(() => planStreet(debts), [debts]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const untangle = () => {
    if (debts.length === 0) return;
    window.clearTimeout(timer.current);
    setRun((count) => count + 1);
    if (reducedMotion()) {
      setPhase("after");
      return;
    }
    setPhase("loops");
    timer.current = window.setTimeout(() => setPhase("after"), LOOPS_MS);
  };
  const edit = (next: Debt[]) => {
    window.clearTimeout(timer.current);
    setDebts(next);
    setPhase("before");
  };

  const { totalOwed, clearedByLoops, moneyMoved, leverage } = plan.stats;
  const done = phase === "after";
  const status = phase === "before"
    ? `${debts.length} invoice${debts.length === 1 ? "" : "s"} on this street. Paid one by one, that's ${debts.length} PayPal payment${debts.length === 1 ? "" : "s"} moving ${dollars(totalOwed)}.`
    : phase === "loops"
      ? clearedByLoops > 0 ? `Step 1: loops cancel out. ${dollars(clearedByLoops)} of invoices clear with no money moving.` : "Step 1: no loops on this street, so nothing cancels yet."
      : `Step 2: what's left is settled by ${plan.transfers.length} PayPal payment${plan.transfers.length === 1 ? "" : "s"} totalling ${dollars(moneyMoved)}. Every invoice is paid.`;

  return (
    <div className="grid gap-0 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <div className="border-b border-zinc-200 p-4 sm:p-6 lg:border-b-0 lg:border-r">
        <StreetMap key={run} debts={debts} plan={plan} phase={phase} />
        <p aria-live="polite" className={`mt-3 min-h-12 text-center text-sm leading-6 ${phase === "loops" ? "text-emerald-700" : done ? "text-[#0057b8]" : "text-zinc-600"}`}>
          {status}
        </p>
      </div>

      <div className="flex flex-col gap-5 p-4 sm:p-6">
        <button type="button" onClick={untangle} disabled={debts.length === 0 || phase === "loops"}
          className="pg-untangle inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
          <Sparkles size={18} aria-hidden="true" />
          {phase === "loops" ? "Untangling…" : done ? "Untangle again" : "Untangle"}
        </button>

        <dl className="grid grid-cols-2 gap-3">
          <Stat label="Owed on the street" value={dollars(totalOwed)} note={`${debts.length} invoice${debts.length === 1 ? "" : "s"}`} />
          <Stat label="Cancelled in loops" value={done ? dollars(clearedByLoops) : "—"} note="no money moves" tone="green" />
          <Stat label="Paid through PayPal" value={done ? dollars(moneyMoved) : "—"} note={done ? `${plan.transfers.length} payment${plan.transfers.length === 1 ? "" : "s"}` : "payments"} tone="blue" />
          <Stat label="Settled per $1 moved" value={done && leverage !== null ? `$${leverage.toFixed(1)}` : "—"} note="leverage" />
        </dl>
        {done && moneyMoved < totalOwed && (
          <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
            {debts.length} invoices settled by moving <strong>{Math.round((100 * moneyMoved) / totalOwed)}%</strong> of the money, in {plan.transfers.length} payment{plan.transfers.length === 1 ? "" : "s"} instead of {debts.length}. No business paid more than it owed on balance.
          </p>
        )}

        <DebtEditor debts={debts} onChange={edit} />
      </div>
    </div>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "green" | "blue" }): JSX.Element {
  const color = tone === "green" ? "text-emerald-700" : tone === "blue" ? "text-[#0057b8]" : "text-zinc-900";
  return (
    <div className="rounded-xl border border-zinc-200 px-3.5 py-3">
      <dt className="text-xs font-medium text-zinc-500">{label}</dt>
      <dd className={`mt-1 text-xl font-bold tabular-nums tracking-tight ${color}`}>{value}</dd>
      <dd className="text-xs text-zinc-500">{note}</dd>
    </div>
  );
}

interface Pair { key: string; from: string; to: string; amount: number; cleared: number }

/** Invoices between the same two shops in the same direction share one arrow. */
function pairUp(debts: readonly Debt[], setoffs: Readonly<Record<string, number>>): Pair[] {
  const byKey = new Map<string, Pair>();
  for (const debt of debts) {
    const key = `${debt.from}>${debt.to}`;
    const pair = byKey.get(key) ?? { key, from: debt.from, to: debt.to, amount: 0, cleared: 0 };
    pair.amount += debt.amount;
    pair.cleared += setoffs[debt.id] ?? 0;
    byKey.set(key, pair);
  }
  return [...byKey.values()];
}

function Pill({ at, text, tone, struck = false }: { at: Point; text: string; tone: "ink" | "green" | "blue"; struck?: boolean }): JSX.Element {
  const width = text.length * 7 + 16;
  return (
    <g className={`pg-pill pg-pill-${tone}`} transform={`translate(${at.x.toFixed(1)} ${at.y.toFixed(1)})`}>
      <rect x={-width / 2} y={-11} width={width} height={22} rx={11} />
      <text y={4} textAnchor="middle" textDecoration={struck ? "line-through" : undefined}>{text}</text>
    </g>
  );
}

function StreetMap({ debts, plan, phase }: { debts: readonly Debt[]; plan: SettlementPlan; phase: Phase }): JSX.Element {
  const positions = useMemo(() => layout(WIDTH, HEIGHT, 136), []);
  const center = { x: WIDTH / 2, y: HEIGHT / 2 };
  const at = (id: string): Point => positions.get(id) ?? center;
  const pairs = pairUp(debts, plan.setoffs);
  const net = new Map<string, number>();
  for (const transfer of plan.transfers) {
    net.set(transfer.payer, (net.get(transfer.payer) ?? 0) - transfer.amount);
    net.set(transfer.payee, (net.get(transfer.payee) ?? 0) + transfer.amount);
  }
  const involved = new Set(debts.flatMap((debt) => [debt.from, debt.to]));

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={`pg-map pg-phase-${phase} mx-auto block w-full max-w-[560px]`} role="img"
      aria-label={`Map of ${involved.size} businesses and ${debts.length} invoices between them`}>
      <defs>
        {(["ink", "green", "blue"] as const).map((tone) => (
          <marker key={tone} id={`pg-arrow-${tone}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth={tone === "blue" ? 9 : 7} markerHeight={tone === "blue" ? 9 : 7} markerUnits="userSpaceOnUse" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" className={`pg-arrowhead-${tone}`} />
          </marker>
        ))}
      </defs>

      {pairs.map((pair) => {
        const twoWay = pairs.some((other) => other.from === pair.to && other.to === pair.from);
        const { path, mid } = arc(at(pair.from), at(pair.to), NODE, bendFor(at(pair.from), at(pair.to), center, twoWay));
        const touched = phase !== "before" && pair.cleared > 0;
        const cleared = pair.cleared >= pair.amount;
        const label = !touched ? dollars(pair.amount) : cleared ? dollars(pair.amount) : `${dollars(pair.amount - pair.cleared)} left`;
        return (
          <g key={pair.key} className={`pg-debt${touched ? " is-touched" : ""}${touched && cleared ? " is-cleared" : ""}`}>
            <path d={path} className="pg-debt-line" markerEnd={`url(#pg-arrow-${touched ? "green" : "ink"})`} />
            {touched && <path d={path} pathLength={1} className="pg-sweep" />}
            <Pill at={mid} text={label} tone={touched ? "green" : "ink"} struck={touched && cleared} />
          </g>
        );
      })}

      {phase === "after" && plan.transfers.map((transfer, index) => {
        const { path, mid } = arc(at(transfer.payer), at(transfer.payee), NODE, 0.3);
        return (
          <g key={`${transfer.payer}>${transfer.payee}`} className="pg-transfer" style={{ ["--pg-delay" as string]: `${index * 180}ms` } as CSSProperties}>
            <path d={path} pathLength={1} className="pg-transfer-line" />
            <path d={path} className="pg-transfer-head" markerEnd="url(#pg-arrow-blue)" />
            <path d={path} pathLength={1} className="pg-transfer-flow" />
            <Pill at={mid} text={dollars(transfer.amount)} tone="blue" />
          </g>
        );
      })}

      {SHOPS.map((shop) => {
        const point = at(shop.id);
        const ux = (point.x - center.x) / 136;
        const uy = (point.y - center.y) / 136;
        const side = Math.abs(ux) > 0.3;
        const anchor = !side ? "middle" : ux > 0 ? "start" : "end";
        const labelX = point.x + (side ? ux * (NODE + 10) : 0);
        const labelY = side ? point.y + uy * 16 + 4 : uy < 0 ? point.y - NODE - 10 : point.y + NODE + 18;
        const netY = side ? labelY + 15 : uy < 0 ? labelY - 15 : labelY + 15;
        const position = net.get(shop.id) ?? 0;
        const idle = !involved.has(shop.id);
        return (
          <g key={shop.id} className={`pg-shop${idle ? " is-idle" : ""}`}>
            <circle cx={point.x} cy={point.y} r={NODE} fill="#ffffff" stroke={shop.color} strokeWidth={3} />
            <text x={point.x} y={point.y + 4.5} textAnchor="middle" fontSize={13} fontWeight={700} fill={shop.color}>{shop.initials}</text>
            <text x={labelX} y={labelY} textAnchor={anchor} className="pg-shop-label">{shop.label}</text>
            {phase === "after" && !idle && (
              <text x={labelX} y={netY} textAnchor={anchor} className={`pg-net ${position > 0 ? "is-gets" : position < 0 ? "is-pays" : "is-square"}`}>
                {position > 0 ? `gets ${dollars(position)}` : position < 0 ? `pays ${dollars(-position)}` : "all square"}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function DebtEditor({ debts, onChange }: { debts: readonly Debt[]; onChange: (debts: Debt[]) => void }): JSX.Element {
  const [from, setFrom] = useState(SHOPS[3]!.id);
  const [to, setTo] = useState(SHOPS[0]!.id);
  const [amount, setAmount] = useState("500");
  const cents = Math.round(Number(amount) * 100);
  const valid = from !== to && Number.isFinite(cents) && cents >= 100 && cents <= 100_000_000;

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    onChange([...debts, { id: nextDebtId(), from, to, amount: cents }]);
  };

  return (
    <div className="flex flex-col gap-3 border-t border-zinc-200 pt-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900">Invoices on the street</h3>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => onChange(randomStreet())} className="pg-chip"><Shuffle size={14} aria-hidden="true" />Random</button>
          <button type="button" onClick={() => onChange([...PRESET])} className="pg-chip"><RotateCcw size={14} aria-hidden="true" />Reset</button>
        </div>
      </div>

      <form onSubmit={add} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl bg-zinc-50 p-3">
        <label className="sr-only" htmlFor="pg-from">Who owes</label>
        <select id="pg-from" value={from} onChange={(event) => setFrom(event.target.value)} className="pg-input">
          {SHOPS.map((shop) => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
        </select>
        <span className="text-xs font-medium text-zinc-500">owes</span>
        <label className="sr-only" htmlFor="pg-to">Who is owed</label>
        <select id="pg-to" value={to} onChange={(event) => setTo(event.target.value)} className="pg-input">
          {SHOPS.map((shop) => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
        </select>
        <div className="col-span-3 flex gap-2">
          <label className="relative flex-1">
            <span className="sr-only">Amount in dollars</span>
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">$</span>
            <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" className="pg-input pg-money w-full" />
          </label>
          <button type="submit" disabled={!valid} className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white disabled:opacity-40">
            <Plus size={15} aria-hidden="true" />Add
          </button>
        </div>
        {from === to && <p className="col-span-3 text-xs text-rose-700">A business can't owe itself.</p>}
      </form>

      <ul className="max-h-56 divide-y divide-zinc-100 overflow-y-auto rounded-xl border border-zinc-200">
        {debts.length === 0 && <li className="px-3 py-4 text-center text-sm text-zinc-500">No invoices yet. Add one above.</li>}
        {debts.map((debt) => (
          <li key={debt.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate text-zinc-700">
              <span className="font-medium text-zinc-900">{shopById.get(debt.from)?.name}</span>
              <span className="text-zinc-400"> owes </span>
              <span className="font-medium text-zinc-900">{shopById.get(debt.to)?.name}</span>
            </span>
            <span className="tabular-nums font-semibold text-zinc-900">{dollars(debt.amount)}</span>
            <button type="button" aria-label={`Remove the ${dollars(debt.amount)} invoice`} onClick={() => onChange(debts.filter((item) => item.id !== debt.id))}
              className="grid h-7 w-7 place-items-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
              <X size={14} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── A whole city ───────────────────────────────────────────────────────────

const CITY_SIZES = [1_000, 5_000, 10_000] as const;
const INVOICES_PER_BUSINESS = 6;

const compact = (minor: number) => `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(minor / 100)}`;

type CityState = { status: "idle" } | { status: "running"; businesses: number } | { status: "done"; result: CityResult };

function CityPlayground(): JSX.Element {
  const [businesses, setBusinesses] = useState<number>(5_000);
  const [state, setState] = useState<CityState>({ status: "idle" });
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);

  const run = () => {
    const request: CityRequest = { businesses, invoicesPerBusiness: INVOICES_PER_BUSINESS, seed: Math.floor(Math.random() * 2 ** 31) };
    setState({ status: "running", businesses });
    const inline = () => window.setTimeout(() => setState({ status: "done", result: untangleCity(request) }), 30);
    try {
      worker.current ??= new Worker(new URL("./city.worker.ts", import.meta.url), { type: "module" });
      worker.current.onmessage = (event: MessageEvent<CityResult>) => setState({ status: "done", result: event.data });
      worker.current.onerror = () => {
        worker.current?.terminate();
        worker.current = null;
        inline();
      };
      worker.current.postMessage(request);
    } catch {
      inline();
    }
  };

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-8">
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 text-center">
        <p className="text-sm leading-6 text-zinc-600">
          A street is easy. Pick a city: every business sends {INVOICES_PER_BUSINESS} invoices of $50 to $5,000, mostly to businesses nearby. The same engine that clears the live network runs here, in your browser.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2" role="radiogroup" aria-label="City size">
          {CITY_SIZES.map((size) => (
            <button key={size} type="button" role="radio" aria-checked={businesses === size} onClick={() => setBusinesses(size)}
              className={`rounded-full border px-4 py-1.5 text-sm font-semibold tabular-nums transition-colors ${businesses === size ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 text-zinc-700 hover:border-zinc-500"}`}>
              {size.toLocaleString("en-US")} businesses
            </button>
          ))}
        </div>
        <button type="button" onClick={run} disabled={state.status === "running"}
          className="pg-untangle inline-flex items-center gap-2 rounded-xl px-6 py-3 text-base font-semibold text-white disabled:opacity-60">
          <Sparkles size={18} aria-hidden="true" />
          {state.status === "running" ? `Untangling ${(state.businesses * INVOICES_PER_BUSINESS).toLocaleString("en-US")} invoices…` : "Untangle the city"}
        </button>
      </div>

      <div aria-live="polite">
        {state.status === "done" && <CityResultView result={state.result} />}
      </div>
    </div>
  );
}

function CityResultView({ result }: { result: CityResult }): JSX.Element {
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    setGrown(false);
    const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(() => setGrown(true)));
    return () => window.cancelAnimationFrame(frame);
  }, [result]);
  const moneyShare = result.moneyMoved / result.totalOwed;
  const paymentShare = result.payments / result.invoices;
  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <p className="text-center text-lg font-semibold leading-7 text-zinc-900">
        {result.businesses.toLocaleString("en-US")} businesses owe each other {compact(result.totalOwed)} across {result.invoices.toLocaleString("en-US")} invoices.
        {" "}Untangle settles every one by moving <span className="text-[#0057b8]">{compact(result.moneyMoved)}</span>.
      </p>
      <Bars title="Money that has to move" before={compact(result.totalOwed)} after={compact(result.moneyMoved)} share={moneyShare} grown={grown}
        saving={`${Math.round((1 - moneyShare) * 100)}% less`} />
      <Bars title="PayPal payments" before={result.invoices.toLocaleString("en-US")} after={result.payments.toLocaleString("en-US")} share={paymentShare} grown={grown}
        saving={`${Math.round((1 - paymentShare) * 100)}% fewer`} />
      <p className="text-center text-sm text-zinc-500">
        {compact(result.clearedByLoops)} cancelled in loops with no money at all. Worked out in <strong className="text-zinc-800">{result.millis < 1000 ? `${Math.round(result.millis)} ms` : `${(result.millis / 1000).toFixed(1)} s`}</strong> on this device.
      </p>
    </div>
  );
}

function Bars({ title, before, after, share, grown, saving }: { title: string; before: string; after: string; share: number; grown: boolean; saving: string }): JSX.Element {
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
        <span className="text-sm font-semibold text-emerald-700">{saving}</span>
      </div>
      <div className="grid grid-cols-[6.5rem_1fr_4.5rem] items-center gap-x-3 gap-y-2 text-sm sm:grid-cols-[9rem_1fr_5rem]">
        <span className="text-zinc-500">Invoice by invoice</span>
        <div className="pg-bar"><span className="pg-bar-fill bg-zinc-300" style={{ width: "100%" }} /></div>
        <span className="text-right font-semibold tabular-nums text-zinc-500">{before}</span>
        <span className="font-medium text-zinc-900">With Untangle</span>
        <div className="pg-bar"><span className="pg-bar-fill pg-bar-blue" style={{ width: grown ? `${Math.max(2, share * 100)}%` : "100%" }} /></div>
        <span className="text-right font-bold tabular-nums text-[#0057b8]">{after}</span>
      </div>
    </div>
  );
}
