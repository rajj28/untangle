# SPEC-CHAOS: the "Pull the plug" button (web only)

Goal: on camera, an operator crashes the server in the middle of a settlement round. It restarts, finishes
the round, and the Watchdog proves on PayPal that no invoice payment was written twice. The server side
already exists. Build only the web UI described here. Do not touch `apps/server`.

## Server contract (already built)

- `POST /api/demo/chaos` with body `{ "afterRecords": number }` (1..50, default 5).
  Response `200 { "armed": true, "afterRecords": number }`. Returns 404 `NOT_FOUND` when the server is not in demo mode.
  POSTs need the same `x-demo-token` header as every other POST; reuse the existing `post` helper in `src/api.ts`.
- Once armed, the next settlement round's set-off writes count down. After that many PayPal writes, the server
  emits a live event `demo.crashed` (payload `{ invoiceId, paymentId, at }`) and then the process exits.
  A supervisor restarts it within a few seconds. Jobs resume on start, and the live stream reconnects by itself (`src/live.ts`).
- Arming also emits a live event `demo.chaos_armed` (payload `{ afterRecords }`).

## What to build

1. `src/api.ts`: add `armChaos: (afterRecords: number) => post<{ armed: boolean; afterRecords: number }>("/api/demo/chaos", { afterRecords })`.
2. `src/views/Settlement.tsx` (desk): add a quiet button **"Pull the plug"** (lucide `Unplug` icon) in the
   view's header actions. Show it only when `config.demo === true`; read `Config` from props the way the view already does.
   - It opens the existing `Dialog` (`src/components/Dialog.tsx`), titled "Crash the server in the middle of the next round?".
   - The dialog body is one short paragraph: "Untangle will crash right after PayPal accepts the 5th set-off payment, before it
     can write down that it succeeded. It restarts, finishes the round, and the Watchdog checks PayPal for duplicates."
   - Include a number input labelled "Crash after this many PayPal writes" (1..50, default 5).
   - Buttons: "Cancel" (secondary) and "Arm the crash" (danger variant), which calls `api.armChaos` and closes the dialog.
   - On success, show a success toast: "Armed. The server will crash after N PayPal writes in the next round."
     On error, use the existing error-toast pattern.
3. A crash banner in the desk shell (`src/desk/DeskApp.tsx`), driven by the `events` prop:
   - If the latest `demo.crashed` event is newer than the latest event of any other type, show a red banner at the top
     of the desk content: "The server crashed on purpose mid-round. Restarting…". Use the `danger` tokens already used for
     error states, with `role="status"`.
   - Once any later event arrives after the crash (the server is back), switch to a green banner for 8 seconds:
     "Back online. The round resumes exactly where it stopped." Then hide it.
   - Keep it simple: derive the state from `events` plus one timer. No new global state.
4. `src/events.ts` (or wherever event titles are humanized for the Activity view): add readable titles.
   - `demo.chaos_armed` → "Crash armed for the next round"
   - `demo.crashed` → "Server crashed on purpose after a PayPal write"
   Add a unit test for these two titles next to the existing events tests in `test/events.test.ts`.

## Constraints

- TypeScript strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`; React 19; Tailwind 4; lucide-react.
- Match the surrounding code's style and naming. Keep copy short and plain.
- Do not add dependencies. Do not run git. Do not run any commands.
- Only edit these files: `src/api.ts`, `src/views/Settlement.tsx`, `src/desk/DeskApp.tsx`, `src/events.ts` (or the actual
  humanizer file), and `test/events.test.ts`.
- When done, list every file you changed and anything you were unsure about.
