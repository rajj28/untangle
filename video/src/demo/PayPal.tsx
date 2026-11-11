import type React from "react";
import { AbsoluteFill, Audio, Easing, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { cue, hasVoice, layLines, VOICE_RATE } from "../program/timing";
import { Backdrop } from "../ui/Backdrop";
import { C, fontFamily } from "../theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.22, 1, 0.36, 1);

/** One line walks through the PayPal calls Untangle makes; both cuts use it. */
const LINE = "p4";
const layout = () => layLines([LINE], 8, 0, 20);

export const paypalDuration = (_why = true) => layout().total;
export const paypalWindows = (_why = true) => layout().windows;

/** The real PayPal REST calls (apps/server/src/adapters) and what they did in this demo round. */
const ROWS = [
  { word: "invoice.", call: "POST /v2/invoicing/invoices", does: "Every debt is a real PayPal invoice", proof: "25 invoices · $28,100" },
  { word: "set-off", call: "POST /v2/invoicing/invoices/{id}/payments", does: "Each set-off recorded on the invoice, tagged with its round", proof: "22 set-offs" },
  { word: "deleted", call: "DELETE …/invoices/{id}/payments/{txn}", does: "Rolled back if a round fails", proof: "Paid twice: 0" },
  { word: "Payouts", call: "POST /v1/payments/payouts · /v2/checkout/orders", does: "Only the net moves", proof: "3 payments · $2,200" },
  { word: "webhooks", call: "INVOICING.INVOICE.PAID · PAYMENT.CAPTURE.REVERSED · PAYOUTS-ITEM.*", does: "Signature-verified, then commit or unwind", proof: "verify-webhook-signature" },
  { word: "Agent Toolkit", call: "@paypal/agent-toolkit", does: "Each agent acts with its own business's PayPal tools", proof: "per-business credentials" },
] as const;

const Row: React.FC<{ index: number }> = ({ index }) => {
  const frame = useCurrentFrame();
  const row = ROWS[index]!;
  const from = layout().starts[0]! + cue(LINE, row.word);
  const t = interpolate(frame, [from, from + 10], [0, 1], { ...clamp, easing: ease });
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "760px 1fr 300px",
        alignItems: "center",
        gap: 32,
        padding: "20px 28px",
        borderLeft: "3px solid #0070E0",
        background: "rgba(255,255,255,0.04)",
        borderRadius: 10,
        opacity: t,
        transform: `translateX(${(1 - t) * 24}px)`,
      }}
    >
      <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", fontSize: 24, color: "#7cc4ff" }}>{row.call}</div>
      <div style={{ fontFamily, fontSize: 26, color: C.ink }}>{row.does}</div>
      <div style={{ fontFamily, fontSize: 24, fontWeight: 700, color: "#ffffff", textAlign: "right" }}>{row.proof}</div>
    </div>
  );
};

export const PayPal: React.FC<{ why?: boolean }> = () => {
  const frame = useCurrentFrame();
  const titleIn = interpolate(frame, [4, 16], [0, 1], { ...clamp, easing: ease });
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 120px", gap: 16 }}>
        <div style={{ fontFamily, fontSize: 52, fontWeight: 800, letterSpacing: -1, color: C.ink, marginBottom: 20, opacity: titleIn }}>
          The PayPal calls behind one round
        </div>
        {ROWS.map((_, index) => <Row key={index} index={index} />)}
      </AbsoluteFill>
      {hasVoice(LINE) && (
        <Sequence from={layout().starts[0]!} layout="none">
          <Audio src={staticFile(`voice/${LINE}.wav`)} playbackRate={VOICE_RATE} />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};
