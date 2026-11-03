import { useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, ValueFormatterParams } from "ag-grid-community";
import type { ObligationView } from "../types.ts";
import { formatMoney } from "../money.ts";
import type { ThemeMode } from "../components/Header.tsx";
import { darkGridTheme, lightGridTheme } from "../theme.ts";

type MetricField = "outstandingMinor" | "amountMinor";

export function Matrix({ obligations, actingAs, theme, currency }: {
  obligations: ObligationView[];
  actingAs: string;
  theme: ThemeMode;
  currency: string;
}) {
  const [metric, setMetric] = useState<MetricField>("outstandingMinor");
  const rows = useMemo(() => obligations.filter((item) => item.status !== "cancelled" && (actingAs === "" || item.debtorId === actingAs || item.creditorId === actingAs)), [actingAs, obligations]);
  const maxValue = useMemo(() => {
    const cells = new Map<string, number>();
    for (const row of rows) {
      const key = `${row.debtorName}\u0000${row.creditorName}`;
      cells.set(key, (cells.get(key) ?? 0) + row[metric]);
    }
    return Math.max(0, ...cells.values());
  }, [metric, rows]);
  const columnDefs = useMemo<ColDef<ObligationView, number | string>[]>(() => [
    { field: "debtorName", headerName: "Who owes", rowGroup: true, hide: true, enableRowGroup: true },
    { field: "creditorName", headerName: "…to whom", pivot: true, hide: true, enablePivot: true },
    {
      field: metric,
      colId: "matrixValue",
      headerName: metric === "outstandingMinor" ? "Outstanding" : "Original amount",
      aggFunc: "sum",
      enableValue: true,
      allowedAggFuncs: ["sum"],
      valueFormatter: (params: ValueFormatterParams<ObligationView, number | string>) => params.value === null || params.value === undefined || Number(params.value) === 0 ? "" : formatMoney(Number(params.value), currency),
      cellStyle: (params) => {
        const value = typeof params.value === "number" ? params.value : Number(params.value ?? 0);
        if (value <= 0 || maxValue <= 0) return undefined;
        const alpha = Math.min(0.42, 0.06 + 0.34 * (value / maxValue));
        return { backgroundColor: `rgba(var(--brand-rgb), ${alpha.toFixed(3)})`, color: "var(--ink)" };
      },
    },
  ], [currency, maxValue, metric]);

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-[50px] items-center gap-4 border-b line bg-[var(--surface)] px-4">
        <div><h1 className="text-sm font-semibold tracking-tight">Obligation matrix</h1><p className="text-[10px] text-muted">Debtors across rows, creditors across columns</p></div>
        <div className="ml-auto flex items-center gap-1 rounded-md border line bg-[var(--surface-soft)] p-0.5">
          <button className={`rounded px-2.5 py-1 text-[10px] ${metric === "outstandingMinor" ? "bg-[var(--surface)] font-semibold text-[var(--ink)] shadow-sm" : "text-muted"}`} onClick={() => setMetric("outstandingMinor")}>Outstanding</button>
          <button className={`rounded px-2.5 py-1 text-[10px] ${metric === "amountMinor" ? "bg-[var(--surface)] font-semibold text-[var(--ink)] shadow-sm" : "text-muted"}`} onClick={() => setMetric("amountMinor")}>Original amount</button>
        </div>
      </div>
      <p className="border-b line bg-[var(--surface)] px-4 py-2 text-[10px] leading-4 text-muted">
        A loop is a cycle in this matrix — debts that run around back to where they started. Untangle finds every one across the whole network and cancels it on the PayPal invoices.
      </p>
      <div className="ag-grid-wrap flex-1">
        <AgGridReact<ObligationView>
          rowData={rows}
          columnDefs={columnDefs}
          pivotMode
          pivotRowTotals="after"
          grandTotalRow="bottom"
          getRowId={(params) => params.data.id}
          groupDefaultExpanded={-1}
          rowHeight={32}
          theme={theme === "dark" ? darkGridTheme : lightGridTheme}
          defaultColDef={{ sortable: true, resizable: true, filter: true, enableRowGroup: true, enablePivot: true, enableValue: true }}
          autoGroupColumnDef={{ headerName: "Who owes", minWidth: 180, flex: 1 }}
          suppressAggFuncInHeader
          pivotPanelShow="never"
          rowSelection={{ mode: "singleRow" }}
        />
      </div>
    </section>
  );
}
