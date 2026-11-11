import { useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, GridApi, GridOptions, ValueFormatterParams } from "ag-grid-community";
import { findLoops } from "@untangle/engine";
import type { Obligation } from "@untangle/engine";
import type { ObligationView, RoundView } from "../types.ts";
import { formatMoney } from "../money.ts";
import type { ThemeMode } from "../components/Header.tsx";
import { darkGridTheme, lightGridTheme } from "../theme.ts";

interface CycleRow {
  id: string;
  cycle: string;
  cleared: number;
  moved: number;
}

interface PositionRow {
  businessId: string;
  businessName: string;
  owes: number;
  cleared: number;
  pays: number;
  receives: number;
  netAfter: number;
  position: number[];
}

function buildCycleRows(round: RoundView, obligations: readonly ObligationView[]): CycleRow[] {
  const obligationRows: Obligation[] = obligations.map((o) => ({
    id: o.id,
    debtor: o.debtorId,
    creditor: o.creditorId,
    amount: o.amountMinor,
  }));
  const setoffs: Record<string, number> = {};
  for (const setoff of round.setoffs) setoffs[setoff.obligationId] = setoff.amountMinor;
  const loops = findLoops(obligationRows, setoffs);
  const rows: CycleRow[] = loops.map((loop, index) => ({
    id: loop.id,
    cycle: `Loop ${index + 1}`,
    cleared: (loop.amount * loop.memberIds.length) / 100,
    moved: 0,
  }));
  round.transfers.forEach((transfer, index) => {
    rows.push({ id: `transfer:${transfer.id}`, cycle: `Payment ${index + 1}`, cleared: 0, moved: transfer.amountMinor / 100 });
  });
  return rows;
}

function buildPositionRows(round: RoundView, obligations: readonly ObligationView[], names: Readonly<Record<string, string>>): PositionRow[] {
  const debts = new Map<string, number>();
  const credits = new Map<string, number>();
  for (const o of obligations) {
    if (o.status === "cancelled") continue;
    debts.set(o.debtorId, (debts.get(o.debtorId) ?? 0) + o.amountMinor);
    credits.set(o.creditorId, (credits.get(o.creditorId) ?? 0) + o.amountMinor);
  }
  return round.statements.map((statement) => {
    const businessId = statement.businessId;
    const totals = statement.body.totals;
    const owes = debts.get(businessId) ?? 0;
    const owedTo = credits.get(businessId) ?? 0;
    const netBefore = owes - owedTo;
    const cleared = totals.clearedMinor;
    const pays = totals.paysMinor;
    const receives = totals.receivesMinor;
    const netAfter = netBefore - cleared - pays + receives;
    return {
      businessId,
      businessName: names[businessId] ?? "Business",
      owes,
      cleared,
      pays,
      receives,
      netAfter,
      position: [owes, cleared, pays, receives, Math.max(0, netAfter)],
    };
  });
}

export function AnalysisPanel({ round, obligations, names, currency, theme }: {
  round: RoundView;
  obligations: readonly ObligationView[];
  names: Readonly<Record<string, string>>;
  currency: string;
  theme: ThemeMode;
}) {
  const cycleRef = useRef<AgGridReact<CycleRow>>(null);
  const [chartCreated, setChartCreated] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

  const cycleRows = useMemo(() => buildCycleRows(round, obligations), [obligations, round]);
  const positionRows = useMemo(() => buildPositionRows(round, obligations, names), [names, obligations, round]);

  const cycleColumnDefs = useMemo<ColDef<CycleRow>[]>(
    () => [
      { field: "cycle", headerName: "Loop / payment", minWidth: 140, flex: 1, chartDataType: "category" },
      {
        field: "cleared",
        headerName: "Debt cleared",
        type: "rightAligned",
        chartDataType: "series",
        valueFormatter: (params: ValueFormatterParams<CycleRow>) => formatMoney(Math.round(Number(params.value ?? 0) * 100), currency),
      },
      {
        field: "moved",
        headerName: "Cash moved",
        type: "rightAligned",
        chartDataType: "series",
        valueFormatter: (params: ValueFormatterParams<CycleRow>) => formatMoney(Math.round(Number(params.value ?? 0) * 100), currency),
      },
    ],
    [currency],
  );

  const cycleGridOptions = useMemo<GridOptions<CycleRow>>(
    () => ({
      enableCharts: true,
      getRowId: (params) => params.data.id,
      rowHeight: 28,
      headerHeight: 32,
      defaultColDef: { sortable: true },
      onGridReady: () => {
        window.requestAnimationFrame(() => {
          const api = cycleRef.current?.api;
          if (!api || chartCreated) return;
          try {
            api.createRangeChart({
              cellRange: { columns: ["cycle", "cleared", "moved"] },
              chartType: "groupedColumn",
              ...(chartRef.current ? { chartContainer: chartRef.current } : {}),
              chartThemeOverrides: {
                bar: { axes: { number: { label: { formatter: (params: { value: number }) => "$" + Number(params.value).toLocaleString() } } } },
              },
            });
            setChartCreated(true);
          } catch {
            setChartCreated(true);
          }
        });
      },
    }),
    [chartCreated],
  );

  const positionColumnDefs = useMemo<ColDef<PositionRow>[]>(
    () => [
      { field: "businessName", headerName: "Business", minWidth: 160, flex: 1 },
      { field: "owes", headerName: "Owed", type: "rightAligned", valueFormatter: (params: ValueFormatterParams<PositionRow>) => formatMoney(Number(params.value ?? 0), currency) },
      { field: "cleared", headerName: "Cleared by loops", type: "rightAligned", valueFormatter: (params: ValueFormatterParams<PositionRow>) => formatMoney(Number(params.value ?? 0), currency) },
      { field: "pays", headerName: "Cash paid", type: "rightAligned", valueFormatter: (params: ValueFormatterParams<PositionRow>) => formatMoney(Number(params.value ?? 0), currency) },
      { field: "receives", headerName: "Cash received", type: "rightAligned", valueFormatter: (params: ValueFormatterParams<PositionRow>) => formatMoney(Number(params.value ?? 0), currency) },
      { field: "netAfter", headerName: "Net after", type: "rightAligned", valueFormatter: (params: ValueFormatterParams<PositionRow>) => formatMoney(Number(params.value ?? 0), currency) },
      {
        colId: "position",
        field: "position",
        headerName: "Position before → after",
        width: 180,
        cellRenderer: "agSparklineCellRenderer",
        cellRendererParams: {
          sparklineOptions: { type: "bar" },
        },
      },
    ],
    [currency],
  );

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div className="rounded-md border line bg-[var(--surface)] p-3">
        <h3 className="text-xs font-semibold text-soft">Debt cleared vs cash moved per loop / payment</h3>
        <p className="mb-2 text-[10px] text-muted">Each loop cancels debt with no money; each payment moves cash through PayPal.</p>
        <div className="ag-grid-wrap" style={{ height: 200 }}>
          <AgGridReact<CycleRow>
            ref={cycleRef}
            rowData={cycleRows}
            columnDefs={cycleColumnDefs}
            gridOptions={cycleGridOptions}
            theme={theme === "dark" ? darkGridTheme : lightGridTheme}
          />
        </div>
        <div ref={chartRef} className="mt-3" style={{ height: 300 }} />
      </div>

      <div className="rounded-md border line bg-[var(--surface)] p-3">
        <h3 className="text-xs font-semibold text-soft">Business positions: before → after clearing</h3>
        <div className="ag-grid-wrap" style={{ height: 288 }}>
          <AgGridReact<PositionRow>
            rowData={positionRows}
            columnDefs={positionColumnDefs}
            defaultColDef={{ sortable: true, resizable: true }}
            getRowId={(params) => params.data.businessId}
            theme={theme === "dark" ? darkGridTheme : lightGridTheme}
          />
        </div>
      </div>
    </div>
  );
}
