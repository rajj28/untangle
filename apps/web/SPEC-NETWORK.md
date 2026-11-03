# Untangle web: the Network view

**Goal:** one picture that makes the idea obvious. Nine businesses, arrows for who owes whom, loops that light up and dissolve, and chains settled by one PayPal payment.

It appears as the desk's "Network" tab and must also look good inside a 375 px-wide phone screen.

## Scope

- **Write only** `src/views/network/` (any files) and `test/network-graph.test.ts`. Another worker is rewriting the rest of `src/` in parallel; don't touch it.
- **Typecheck errors elsewhere** in `src/` may be someone else's work in progress. Make sure **your** files have none.
- **Packages:** `d3-force` and `@types/d3-force` are installed; also React 19, Tailwind 4 and `lucide-react`. Install nothing.
- **Code style:** strict TypeScript (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), `.ts`/`.tsx` import extensions, `import type` for types. Mirror the existing code style in `src/`.
- **Colors:** use the existing CSS variables from `src/index.css`, such as `--brand`, `--ink` and `--surface-muted`. Read the file. Make it work in light and dark.

## Interface (keep exactly)

`src/views/network/NetworkView.tsx` must keep this default export and props. A placeholder exists; replace it.

```ts
export interface NetworkViewProps {
  obligations: ObligationView[];   // all obligations of the network (types in src/types.ts)
  businesses: BusinessSummary[];
  round: RoundView | null;         // latest round, or null
  actingAs: string | null;         // highlight this business when set
  currency: string;
}
export default function NetworkView(props: NetworkViewProps): JSX.Element
```

## Model (`src/views/network/graph.ts`, pure, unit-tested)

```ts
interface GraphNode { id: string; name: string; initials: string; owesMinor: number; owedMinor: number; netMinor: number }
interface GraphEdge {
  id: string;                    // obligation id
  source: string; target: string; // debtor → creditor
  amountMinor: number; outstandingMinor: number; description: string | null;
  kind: "loop" | "chain" | "open" | "settled";
  roundStatus: string | null;    // the set-off or leg status when the round touches it
}
buildGraph(obligations, businesses, round): { nodes: GraphNode[]; edges: GraphEdge[] }
```

**Edges:** skip `cancelled` obligations. Classify each edge:
- `loop` if the round has a set-off for it;
- `chain` if it is a leg of any transfer;
- otherwise `settled` if outstanding is 0, or `open`.

An obligation can be both: loop first, then chain is shown as a secondary marker. Expose `alsoChain: boolean`.

**Nodes:** owes/owed/net come from outstanding amounts.

**`layout(nodes, edges, width, height)`:**
- Run d3-force synchronously for a fixed 300 ticks with a seeded start: deterministic positions from the sorted node ids on a circle, so the picture never jumps between renders.
- Forces: link distance ~140 scaled to the box, charge −400, collide by node radius.
- Return positions clamped inside the box.
- Memoize by node ids and size.

## Rendering (`NetworkView.tsx`, SVG)

**Container:** responsive. Measure it with ResizeObserver, height = min(70vh, width × 0.75), minimum 320.

**Nodes:**
- a circle (radius 22–30 by total volume) filled with the avatar color (same hash as initials);
- initials inside;
- the name label below (truncate at 16 characters, full name in a `<title>`);
- an outer ring colored by net: amber for owes, teal for owed, muted for zero.

**Edges:**
- curved paths, with a slight curve so A→B and B→A don't overlap, and an arrowhead marker at the creditor;
- stroke width 1.5–8 by outstanding, or by amount when settled;
- colors:

| Kind | Color |
|---|---|
| `loop` | teal `--brand`, dashed while pending, solid when recorded |
| `chain` | PayPal blue `#0070E0` |
| `open` | slate |
| `settled` | muted, 40% opacity |

**Motion:** when an edge's `roundStatus` changes (the set-off recorded or the leg recorded), animate stroke width and opacity over 600 ms. Respect `prefers-reduced-motion`.

**Interaction:**
- Hover or tap a node: dim everything else, highlight its edges, and show a small card with "Owes $… · Owed $… · Net …".
- Hover or tap an edge: a card with debtor → creditor, description, amount, outstanding and kind ("Cleared in a loop — no money moved", "Settled by a PayPal chain payment").
- Tap empty space to clear.
- Keyboard: nodes are focusable (`tabIndex=0`, `role="button"`, `aria-label` with name and net). Enter selects.

**Highlighting and legend:**
- When `actingAs` is set, emphasize that node and its edges on first render.
- Legend row: "Loop (cleared, no money)" teal, "Chain (one PayPal payment)" blue, "Open" slate, "Settled" muted.
- A one-line caption: "Loops are debts that run in a circle; Untangle cancels them on the PayPal invoices."

**Empty state:** no obligations → a friendly message.

**Performance:** fine for up to ~60 nodes and 300 edges. Memoize everything derived from props.

## Tests (`test/network-graph.test.ts`)

Use a fixture with 3 businesses in a loop (a: bakery→mill 3000, b: mill→trucker 2400, c: trucker→bakery 2800) plus a round with set-offs a, b, c of 2400 and a transfer whose legs are c and a.

- Edge kinds: all `loop`; a and c have `alsoChain`.
- Net positions match.
- Cancelled obligations are skipped.
- `layout` is deterministic: the same input gives the same positions.
- Positions are inside the box.

## Done means

- Your files typecheck (`pnpm typecheck`; ignore errors outside your scope, but list them in your report).
- **Report:** the files written, deviations, and anything unsure.
