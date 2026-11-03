import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../../api.ts";
import type { BusEvent, ObligationView, RoundView } from "../../types.ts";

export function useBusinessEvents(events: readonly BusEvent[], obligations: readonly ObligationView[], businessId: string, round: RoundView | undefined) {
  const relatedObligations = useMemo(() => obligations.filter((item) => item.debtorId === businessId || item.creditorId === businessId), [businessId, obligations]);
  const histories = useQueries({ queries: relatedObligations.map((item) => ({
    queryKey: ["history", item.id], queryFn: () => api.history(item.id), enabled: businessId !== "", staleTime: Infinity,
  })) });
  const related = useMemo(() => {
    const obligationIds = new Set(relatedObligations.map((item) => item.id));
    const transferIds = new Set(round?.transfers.filter((item) => item.payerId === businessId || item.payeeId === businessId).map((item) => item.id) ?? []);
    const roundIds = new Set<string>();
    if (round && round.statements.some((item) => item.businessId === businessId)) roundIds.add(round.id);
    for (const history of histories) {
      if (history.data === undefined) continue;
      for (const entry of history.data.setoffs) roundIds.add(entry.roundId);
      for (const entry of history.data.legs) {
        transferIds.add(entry.transferId);
        roundIds.add(entry.roundId);
      }
    }
    return { obligationIds, transferIds, roundIds };
  }, [businessId, histories, relatedObligations, round]);
  const filtered = useMemo(() => events.filter((event) => {
    const payload = JSON.stringify(event.payload);
    return payload.includes(businessId)
      || [...related.obligationIds].some((id) => payload.includes(id))
      || [...related.transferIds].some((id) => payload.includes(id))
      || [...related.roundIds].some((id) => payload.includes(id));
  }).sort((a, b) => b.seq - a.seq), [businessId, events, related]);
  return {
    events: filtered,
    loading: histories.some((item) => item.isLoading),
    error: histories.find((item) => item.error !== null)?.error ?? null,
  };
}
