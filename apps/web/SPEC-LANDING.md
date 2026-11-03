# Untangle landing page

A product landing page that sells Untangle as a real product in 30 seconds and sends people into the live demo.

It is also the backdrop for the demo video, so it must look exceptional: bold, calm and premium, not template-y.

## Scope

- **Write only inside `src/landing/`.** Other workers are editing the rest of `src/` at the same time. Don't touch `AppV2.tsx`, `routes.ts` or anything outside `src/landing/`; I wire the route myself.
- **Stack:** React 19, Tailwind 4 utility classes, `lucide-react` icons, and a scoped CSS file `src/landing/landing.css` for keyframes. Don't use AG Grid or TanStack Query; everything comes in through props. Install nothing.
- **TypeScript is strict:** `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `.ts`/`.tsx` import extensions, `import type` for types. You cannot run commands, so be meticulous.

## Interface (keep exactly)

```ts
// src/landing/Landing.tsx
export interface LandingStats {
  businesses: number; invoices: number; currency: string;
  owedMinor: number; clearedByLoopsMinor: number; settledByChainsMinor: number; movedMinor: number;
  leverage: number | null;
}
export function Landing(props: {
  stats: LandingStats | null;     // live from the sandbox network; null while loading or offline
  onOpenDesk: () => void;         // "Open the clearing desk"
  onOpenBusiness: () => void;     // "Open the business app"
  onWatchDemo: () => void;        // "Watch the demo"
  playground: ReactNode;          // an interactive simulator I build; render it inside the "Try it" section
}): JSX.Element
```

When `stats` is null, fall back to the verified sandbox run: 9 businesses, 25 invoices, $28,100 owed, $24,000 cleared by loops, $4,100 by chains, $2,200 moved, 12.8×.

## Sections, top to bottom

1. **Nav.** Sticky and translucent with backdrop blur.
   - Left: the knot logo (inline SVG) and "Untangle".
   - Links: How it works · Agents · Try it · Trust. They scroll smoothly to anchors.
   - A primary "Live demo" button that calls `onOpenDesk`.
   - Collapses to a menu button under 768 px.
2. **Hero.** Dark (`#0a0f1a`), with soft radial teal and blue glows.
   - Eyebrow: "AI clearing for small businesses on PayPal".
   - Headline (very large, tight leading): **"Everyone on Main Street is owed money. Untangle settles it with a fraction of the cash."**
   - Sub: "AI agents find the debts that cancel out across a network of businesses, clear them on their PayPal invoices with no money moving, and settle the rest with the fewest PayPal payments possible."
   - Buttons: "Open the live demo" (primary, `onOpenDesk`) and "Watch the 3-minute demo" (`onWatchDemo`). A small text link: "I run a business →" (`onOpenBusiness`).
   - Visual: `TangleHero.tsx`, described below.
   - **Stats ribbon** under the hero: 4 big numbers with labels:
     - invoices settled (owed);
     - cleared with no money moving;
     - PayPal payments;
     - leverage.

     Count them up once on first view.
3. **The problem: a real street.** Light background.
   - Title: "Everyone is owed. Nobody can pay."
   - Three portrait cards, using the initials avatar style:
     - **Rosa's Bakery:** "Owes the mill $3,000 for flour. Waiting on $2,800 from the trucking company."
     - **Rossi Mill:** "Owes the trucker $2,400. Waiting on Rosa's $3,000."
     - **Ortega Trucking:** "Owes Rosa $2,800 for catering. Waiting on the mill's $2,400."
   - Draw an animated circular arrow linking the three cards (SVG, stroke-dashoffset animation). Caption: "It's a loop. $2,400 of it can simply cancel."
   - Fact strip: "56% of US small businesses are owed money right now, about $17,500 each." Small source note: "QuickBooks small business late payments report, 2025".
4. **How it works** (`id="how"`). Three steps in a row (stacked on mobile), each with a big step number, an icon and a mini illustration made with simple shapes:
   1. **"Drop in any proof."** A photo of a bill, a voice note, a PDF or a chat. AI reads it and the creditor's PayPal invoice goes out.
   2. **"Loops cancel."** Debts that run in a circle are cleared on every PayPal invoice in the loop, and no money moves.
   3. **"One payment settles a chain."** What's left is paid through PayPal with the fewest payments possible. One payment can settle several invoices at once.
5. **Meet the agents** (`id="agents"`).
   - Intro: "An orchestrator runs every clearing cycle and hands work to specialist agents. Each one works inside its own business's PayPal account through the PayPal Agent Toolkit, and nothing moves money without its owner's approval or written policy."
   - A grid of 8 cards: an icon, a name, a one-line job, and tool chips in PayPal blue for `paypal.*` tools.

| Agent | Icon | Job | Tools |
|---|---|---|---|
| Orchestrator | `Workflow` | Plans and runs the whole cycle, explaining every step | `untangle.*` |
| Discovery | `ScanSearch` | Searches every member's PayPal account for unpaid invoices between them | `paypal.list_invoices` |
| Intake | `FileScan` | Reads photos, voice notes, PDFs and chats into debts | Gemini multimodal |
| Invoicing | `ReceiptText` | Issues the PayPal invoice, with a QR code | `paypal.create_invoice`, `paypal.send_invoice`, `paypal.generate_invoice_qr_code` |
| Treasurer | `Landmark` | One per business: checks cash flow and signs within its owner's policy | `paypal.list_transactions` |
| Negotiator | `Scale` | Two treasurers settle a disputed amount from the evidence | Gemini |
| Watchdog | `ShieldCheck` | Re-reads every invoice from PayPal and checks for disputes | `paypal.get_invoice`, `paypal.list_disputes` |
| Collections | `BellRing` | Drafts reminders in the customer's own language | `paypal.send_invoice_reminder` |

6. **Try it yourself** (`id="try"`).
   - Title: "Untangle your street".
   - Sub: "Add a few debts between neighbours, then press Untangle. This runs the same clearing engine as the real network, right in your browser."
   - Render `props.playground` in a large rounded frame.
7. **Built to be trusted** (`id="trust"`). Four tiles with icons:
   - **Exactly-once PayPal writes.** Every payment on an invoice is recorded once, even if the server dies mid-way.
   - **Tamper-evident audit log.** Every step, by people or agents, is hash-chained.
   - **Owners stay in charge.** Agents act only within each owner's policy, and risky steps wait for approval.
   - **Checked against PayPal.** The Watchdog re-reads the invoices from PayPal after every round.
8. **Built with.** A row of text badges: PayPal Invoicing · Orders v2 + JS SDK v6 · Payouts · Webhooks · Transaction Search · PayPal Agent Toolkit · Google Gemini · AG Grid Enterprise · Neon · Render.
9. **Final call to action.** A dark band: "See a whole street settle in minutes." with the same two buttons. Footer: "Built for the PayPal AI Hackathon 2026 · Runs on the PayPal sandbox · MIT licensed".

## `TangleHero.tsx`: the signature visual

- **Shape:** an SVG with `viewBox="0 0 640 520"`, scaling to its container width.
  - 9 shop nodes on a slightly irregular circle: a circle with initials, the name under it, soft glow.
  - About 14 curved "threads" (quadratic paths) between them, using the Main Street debts: R→M, M→T, T→R, C→R, C→B, C→D, R→D, D→T, B→T, B→P, P→B, C→P, C→S, P→S.
- **An 8-second loop, as pure CSS keyframes:**

| Time | What happens |
|---|---|
| 0–2 s | All threads drawn in muted slate, gently pulsing ("the tangle") |
| 2–4 s | The loop threads (R→M→T→R, B→P→B and C→D→T→…) light up teal one after another |
| 4–5.5 s | The teal threads dissolve (opacity and stroke width to 0) with a small spark at each node |
| 5.5–7.5 s | 3 PayPal-blue threads remain (C→S, C→A, D→A in the real plan; use C→S, C→P and D→T if those nodes are drawn). A small glowing dot (the PayPal payment) travels along each. |
| 7.5–8 s | Fade back to the start |

- **Reduced motion:** with `prefers-reduced-motion`, show the final state statically.
- **Labels:** small labels at the right moments: "Loops cancel — no money moves" (teal) and "1 PayPal payment settles a chain" (blue).

## Design notes

- **Colors:** brand teal `#0F766E`, light teal `#14b8a6`, PayPal blue `#0070E0` (PayPal things only), ink `#0b1220`, slate `#64748b`.
- **Type:** the system UI font. Hero headline `clamp(2.4rem, 6vw, 4.6rem)`, weight 700, letter-spacing −0.03em. Big numbers use `tabular-nums`.
- **Layout:** generous whitespace with a section rhythm of about 96 px on desktop and 56 px on mobile. Max width 1120 px.
- **Reveal:** subtle on scroll (IntersectionObserver adds a `.is-visible` class: translateY(16px) and opacity 0 → 1, 500 ms). Respect reduced motion.
- **Accessibility:** landmarks, a single h1, real buttons and links, visible focus, AA contrast.

## Done means

- `src/landing/Landing.tsx` (named export `Landing`), `TangleHero.tsx`, the section files and `landing.css` are written, and everything compiles under the strict config.
- **Report:** the files you wrote and anything you're unsure about.
