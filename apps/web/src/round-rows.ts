import type { ObligationView, RoundView } from "./types.ts";

export type SettlementRowType = "loops" | "setoff" | "chains" | "transfer" | "leg";

export interface SettlementRow {
  id: string;
  path: string[];
  rowType: SettlementRowType;
  label: string;
  amountMinor: number;
  status: string;
  from: string;
  to: string;
  description: string;
  invoiceId: string | null;
  paypalRef: string | null;
  transferId: string | null;
  payerId: string | null;
  obligationId: string | null;
  instrument: string | null;
  partyIds: string[];
}

export type BusinessNames = Readonly<Record<string, string | undefined>>;

const EMPTY_ROW = {
  status: "",
  from: "",
  to: "",
  description: "",
  invoiceId: null,
  paypalRef: null,
  transferId: null,
  payerId: null,
  obligationId: null,
  instrument: null,
  partyIds: [] as string[],
} as const;

export function roundRows(
  round: RoundView,
  names: BusinessNames,
  obligations: readonly ObligationView[] = [],
): SettlementRow[] {
  const obligationById = new Map(obligations.map((item) => [item.id, item]));
  const rows: SettlementRow[] = [{
    id: "loops",
    path: ["loops"],
    rowType: "loops",
    label: "Loops — cleared with no money moving",
    amountMinor: round.setoffs.reduce((sum, setoff) => sum + setoff.amountMinor, 0),
    ...EMPTY_ROW,
  }];

  for (const setoff of round.setoffs) {
    const obligation = obligationById.get(setoff.obligationId);
    const id = `setoff:${setoff.obligationId}`;
    rows.push({
      id,
      path: ["loops", id],
      rowType: "setoff",
      label: `${names[setoff.debtorId] ?? "Business"} → ${names[setoff.creditorId] ?? "Business"}`,
      amountMinor: setoff.amountMinor,
      status: setoff.status,
      from: names[setoff.debtorId] ?? "Business",
      to: names[setoff.creditorId] ?? "Business",
      description: obligation?.description ?? "Invoice set-off",
      invoiceId: obligation?.paypalInvoiceId ?? null,
      paypalRef: setoff.paypalPaymentId,
      transferId: null,
      payerId: null,
      obligationId: setoff.obligationId,
      instrument: null,
      partyIds: [setoff.debtorId, setoff.creditorId],
    });
  }

  rows.push({
    id: "chains",
    path: ["chains"],
    rowType: "chains",
    label: `Chains — settled by ${round.transfers.length} PayPal payments`,
    amountMinor: round.transfers.reduce((sum, transfer) => sum + transfer.amountMinor, 0),
    ...EMPTY_ROW,
  });

  for (const transfer of round.transfers) {
    const transferPath = `transfer:${transfer.id}`;
    rows.push({
      id: transferPath,
      path: ["chains", transferPath],
      rowType: "transfer",
      label: `${names[transfer.payerId] ?? "Business"} → ${names[transfer.payeeId] ?? "Business"}`,
      amountMinor: transfer.amountMinor,
      status: transfer.status,
      from: names[transfer.payerId] ?? "Business",
      to: names[transfer.payeeId] ?? "Business",
      description: transfer.instrument === "payouts" ? "PayPal Payouts" : "PayPal checkout",
      invoiceId: null,
      paypalRef: transfer.paypalCaptureId ?? transfer.payoutItemId ?? transfer.paypalOrderId ?? transfer.payoutBatchId,
      transferId: transfer.id,
      payerId: transfer.payerId,
      obligationId: null,
      instrument: transfer.instrument,
      partyIds: [transfer.payerId, transfer.payeeId],
    });
    for (const leg of transfer.legs) {
      const obligation = obligationById.get(leg.obligationId);
      const id = `leg:${leg.obligationId}`;
      rows.push({
        id: `${transferPath}:${id}`,
        path: ["chains", transferPath, id],
        rowType: "leg",
        label: `${obligation?.debtorName ?? "Business"} → ${obligation?.creditorName ?? "Business"}`,
        amountMinor: leg.amountMinor,
        status: leg.status,
        from: obligation?.debtorName ?? "Business",
        to: obligation?.creditorName ?? "Business",
        description: obligation?.description ?? "Invoice in this chain",
        invoiceId: obligation?.paypalInvoiceId ?? null,
        paypalRef: leg.paypalPaymentId,
        transferId: transfer.id,
        payerId: transfer.payerId,
        obligationId: leg.obligationId,
        instrument: transfer.instrument,
        partyIds: obligation ? [obligation.debtorId, obligation.creditorId, transfer.payerId, transfer.payeeId] : [transfer.payerId, transfer.payeeId],
      });
    }
  }
  return rows;
}

export function settlementRowId(row: SettlementRow): string {
  return row.path.join("/");
}
