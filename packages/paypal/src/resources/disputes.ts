import type { HttpCore } from "../http.ts";
import type { Dispute, DisputeSummary } from "../types.ts";

export interface EvidenceInput {
  evidences: { evidence_type: string; evidence_info?: unknown; notes?: string }[];
}

export interface EvidenceFile {
  name: string;
  contentType: string;
  data: Uint8Array;
}

export function createDisputesResource(http: HttpCore) {
  return {
    async list(q: {
      disputed_transaction_id?: string;
      start_time?: string;
      dispute_state?: string;
      page_size?: number;
      next_page_token?: string;
    } = {}): Promise<{ items: DisputeSummary[]; links?: unknown }> {
      const result = await http.request<{ items?: DisputeSummary[]; links?: unknown }>("GET", "/v1/customer/disputes", { query: q });
      return { ...result, items: result.items ?? [] };
    },

    async get(id: string): Promise<Dispute> {
      return http.request<Dispute>("GET", `/v1/customer/disputes/${encodeURIComponent(id)}`);
    },

    async provideEvidence(id: string, input: EvidenceInput, files: EvidenceFile[] = []): Promise<void> {
      const form = new FormData();
      form.append("input", new Blob([JSON.stringify(input)], { type: "application/json" }));
      for (const file of files) {
        form.append("evidence-file", new Blob([file.data as BlobPart], { type: file.contentType }), file.name);
      }
      await http.request<void>("POST", `/v1/customer/disputes/${encodeURIComponent(id)}/provide-evidence`, { form });
    },
  };
}
