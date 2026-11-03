import type { HttpCore } from "../http.ts";
import type { BalancesResponse, TransactionSearchPage } from "../types.ts";

export interface TransactionQuery {
  start_date: string;
  end_date: string;
  transaction_id?: string;
  transaction_status?: "D" | "P" | "S" | "V";
  fields?: string;
  page?: number;
  page_size?: number;
}

export function createReportingResource(http: HttpCore) {
  return {
    async listTransactions(q: TransactionQuery): Promise<TransactionSearchPage> {
      const start = Date.parse(q.start_date);
      const end = Date.parse(q.end_date);
      if (!Number.isFinite(start) || !Number.isFinite(end)) throw new TypeError("start_date and end_date must be valid dates");
      if (end < start) throw new TypeError("end_date must not be earlier than start_date");
      if (end - start > 31 * 24 * 60 * 60 * 1000) throw new TypeError("transaction date range cannot exceed 31 days");

      const result = await http.request<Partial<TransactionSearchPage>>("GET", "/v1/reporting/transactions", {
        query: {
          start_date: q.start_date,
          end_date: q.end_date,
          transaction_id: q.transaction_id,
          transaction_status: q.transaction_status,
          fields: q.fields ?? "all",
          page: q.page,
          page_size: q.page_size ?? 500,
        },
      });
      return { ...result, transaction_details: result.transaction_details ?? [] };
    },

    async listBalances(q: { as_of_time?: string; currency_code?: string } = {}): Promise<BalancesResponse> {
      return http.request<BalancesResponse>("GET", "/v1/reporting/balances", { query: q });
    },
  };
}
