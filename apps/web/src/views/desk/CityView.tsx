import { useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, GridApi, GridOptions, IServerSideDatasource, IServerSideGetRowsParams, ValueFormatterParams } from "ag-grid-community";
import { LoaderCircle, ShieldAlert } from "lucide-react";
import { api } from "../../api.ts";
import { formatMoney } from "../../money.ts";
import type { ThemeMode } from "../../components/Header.tsx";
import { darkGridTheme, lightGridTheme } from "../../theme.ts";

type CityRow = Record<string, string | number | null>;

interface CityTotals {
  totalOwed: number;
  clearedByLoops: number;
  cashNeeded: number;
  count: number;
}

function StatTile({ label, value, detail, accent = false }: { label: string; value: string; detail: string; accent?: boolean }) {
  return (
    <div className="surface min-w-0 rounded-md border line px-3 py-2">
      <p className="truncate text-[9px] font-semibold uppercase tracking-[.1em] text-muted">{label}</p>
      <p className={`mt-1 truncate text-[16px] font-semibold tracking-tight tabular-nums ${accent ? "text-[var(--brand)]" : ""}`}>{value}</p>
      <p className="truncate text-[9px] text-muted">{detail}</p>
    </div>
  );
}

function ScreenCell(props: { value: number; data?: CityRow }) {
  const held = Number(props.value ?? 0) > 0;
  if (!held) return <span className="text-[10px] text-muted">—</span>;
  const reasons = props.data?.fraudReasons;
  const text = Array.isArray(reasons) && reasons.length > 0 ? reasons.join("; ") : "held for fraud review";
  return <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--red)]" title={text}><ShieldAlert size={12} />held · {text.slice(0, 60)}</span>;
}

export function CityView({ theme, currency }: { theme: ThemeMode; currency: string }) {
  const [gridApi, setGridApi] = useState<GridApi<CityRow> | null>(null);
  const [totals, setTotals] = useState<CityTotals | null>(null);
  const [loadingTotals, setLoadingTotals] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .deskRows({
        startRow: 0,
        endRow: 1e9,
        rowGroupCols: [{ id: "sector", field: "sector", displayName: "Sector" }],
        groupKeys: [],
        valueCols: [
          { id: "amountMinor", field: "amountMinor", aggFunc: "sum", displayName: "Owed" },
          { id: "clearedMinor", field: "clearedMinor", aggFunc: "sum", displayName: "Cleared by loops" },
          { id: "cashNeededMinor", field: "cashNeededMinor", aggFunc: "sum", displayName: "Cash needed" },
        ],
        sortModel: [],
        filterModel: {},
        group: true,
      })
      .then((res) => {
        if (cancelled) return;
        let totalOwed = 0;
        let clearedByLoops = 0;
        let cashNeeded = 0;
        let count = 0;
        for (const row of res.rows) {
          const r = row as CityRow;
          totalOwed += Number(r.amountMinor ?? 0);
          clearedByLoops += Number(r.clearedMinor ?? 0);
          cashNeeded += Number(r.cashNeededMinor ?? 0);
          count += Number(r.count ?? 0);
        }
        setTotals({ totalOwed, clearedByLoops, cashNeeded, count });
        setLoadingTotals(false);
      })
      .catch(() => {
        if (!cancelled) setLoadingTotals(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const datasource = useMemo<IServerSideDatasource<CityRow>>(
    () => ({
      getRows(params: IServerSideGetRowsParams<CityRow>) {
        api
          .deskRows({
            startRow: params.request.startRow ?? 0,
            endRow: params.request.endRow ?? 1e9,
            rowGroupCols: params.request.rowGroupCols,
            groupKeys: params.request.groupKeys,
            valueCols: params.request.valueCols,
            sortModel: params.request.sortModel,
            filterModel: params.request.filterModel ?? {},
            pivotMode: params.request.pivotMode,
          })
          .then((res) => {
            params.success({ rowData: res.rows as CityRow[], rowCount: res.lastRow });
          })
          .catch(() => params.fail());
      },
    }),
    [],
  );

  const columnDefs = useMemo<ColDef<CityRow>[]>(
    () => [
      { field: "sector", headerName: "Sector", rowGroup: true, hide: true },
      { field: "businessName", headerName: "Business", rowGroup: true, hide: true },
      { field: "debtorName", headerName: "Debtor", minWidth: 150, flex: 1, filter: "agTextColumnFilter" },
      { field: "creditorName", headerName: "Creditor", minWidth: 150, flex: 1, filter: "agTextColumnFilter" },
      {
        field: "amountMinor",
        headerName: "Owed",
        type: "rightAligned",
        minWidth: 110,
        aggFunc: "sum",
        enableValue: true,
        filter: "agNumberColumnFilter",
        valueFormatter: (params: ValueFormatterParams<CityRow>) => formatMoney(Number(params.value ?? 0), currency),
      },
      {
        field: "clearedMinor",
        headerName: "Cleared by loops",
        type: "rightAligned",
        minWidth: 130,
        aggFunc: "sum",
        enableValue: true,
        filter: "agNumberColumnFilter",
        valueFormatter: (params: ValueFormatterParams<CityRow>) => formatMoney(Number(params.value ?? 0), currency),
      },
      {
        field: "cashNeededMinor",
        headerName: "Cash needed",
        type: "rightAligned",
        minWidth: 120,
        aggFunc: "sum",
        enableValue: true,
        filter: "agNumberColumnFilter",
        valueFormatter: (params: ValueFormatterParams<CityRow>) => formatMoney(Number(params.value ?? 0), currency),
      },
      { field: "loopId", headerName: "Loop", width: 130, filter: "agTextColumnFilter" },
      {
        colId: "screen",
        field: "fraudHeld",
        headerName: "Screen",
        width: 200,
        minWidth: 170,
        aggFunc: "sum",
        enableValue: true,
        filter: "agNumberColumnFilter",
        cellRenderer: ScreenCell,
        valueFormatter: (params: ValueFormatterParams<CityRow>) => String(Number(params.value ?? 0)),
      },
      { field: "paypalInvoiceId", headerName: "PayPal invoice", width: 150, filter: "agTextColumnFilter" },
      { field: "description", headerName: "Description", minWidth: 180, flex: 1.2, filter: "agTextColumnFilter" },
      { field: "dueOn", headerName: "Due", width: 110 },
    ],
    [currency],
  );

  const gridOptions = useMemo<GridOptions<CityRow>>(
    () => ({
      rowModelType: "serverSide",
      serverSideDatasource: datasource,
      getRowId: (params) => String(params.data.id),
      autoGroupColumnDef: { headerName: "Sector / Business", minWidth: 240, flex: 1 },
      groupDisplayType: "singleColumn",
      groupDefaultExpanded: 0,
      suppressAggFuncInHeader: true,
      rowHeight: 30,
      headerHeight: 34,
      defaultColDef: { sortable: true, resizable: true, filter: true },
      statusBar: { statusPanels: [{ statusPanel: "agTotalAndFilteredRowCountComponent" }, { statusPanel: "agAggregationComponent" }] },
      onGridReady: (event) => setGridApi(event.api),
    }),
    [datasource],
  );

  const leverage = totals && totals.cashNeeded > 0 ? totals.totalOwed / totals.cashNeeded : null;

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-[50px] items-center gap-3 border-b line bg-[var(--surface)] px-4">
        <div>
          <h1 className="text-sm font-semibold tracking-tight">City desk</h1>
          <p className="text-[10px] text-muted">10,000 businesses · 60,000 invoices · grouped and aggregated on the server</p>
        </div>
        {loadingTotals && <LoaderCircle size={14} className="ml-auto animate-spin text-muted" />}
      </div>

      {totals && (
        <div className="grid grid-cols-2 gap-2 border-b line bg-[var(--surface-soft)] px-3 py-2 sm:grid-cols-3 xl:grid-cols-4">
          <StatTile label="Total owed" value={formatMoney(totals.totalOwed, currency)} detail={`${totals.count.toLocaleString("en-US")} invoices`} />
          <StatTile label="Cleared by loops" value={formatMoney(totals.clearedByLoops, currency)} detail="No money moved" />
          <StatTile label="Cash needed" value={formatMoney(totals.cashNeeded, currency)} detail="Moved through PayPal" />
          <StatTile label="Leverage" value={leverage === null ? "—" : `${leverage.toFixed(1)}×`} detail="Invoices settled per $1 moved" accent />
        </div>
      )}

      <div className="ag-grid-wrap flex-1">
        <AgGridReact<CityRow>
          columnDefs={columnDefs}
          gridOptions={gridOptions}
          theme={theme === "dark" ? darkGridTheme : lightGridTheme}
        />
      </div>
    </section>
  );
}
