import { ClipboardCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { Approval } from "../types.ts";
import { api } from "../api.ts";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Skeleton } from "../ui/Skeleton.tsx";
import { ApprovalCard } from "./ApprovalCard.tsx";
import type { ToastMessage } from "../components/Toasts.tsx";

type PushToast = (toast: Omit<ToastMessage, "id">) => void;

/**
 * Renders all pending approvals for a network (desk) or a single business
 * (business assistant). Fetches from the network endpoint and optionally
 * filters to a specific businessId.
 */
export function ApprovalsPanel({
  networkId,
  filterBusinessId,
  onToast,
  onOpenPayDialog,
}: {
  networkId: string;
  /** When set, only show approvals for this business. */
  filterBusinessId?: string;
  onToast: PushToast;
  onOpenPayDialog?: (transferId: string) => void;
}) {
  const query = useQuery<Approval[]>({
    queryKey: ["approvals", networkId, "pending"],
    queryFn: () => api.networkApprovals(networkId, "pending"),
    staleTime: Infinity,
  });

  if (query.isLoading) {
    return <Skeleton variant="row" count={3} className="py-2" />;
  }

  const approvals = (query.data ?? []).filter(
    (approval) => filterBusinessId === undefined || approval.businessId === filterBusinessId
  );

  if (approvals.length === 0) {
    return (
      <EmptyState
        title="Nothing waiting for you."
        detail="Pending approvals from the AI agents will appear here."
        icon={<ClipboardCheck size={24} />}
      />
    );
  }

  return (
    <div className="approvals-panel space-y-3">
      {approvals.map((approval) => (
        <ApprovalCard
          key={approval.id}
          approval={approval}
          onToast={onToast}
          {...(onOpenPayDialog === undefined ? {} : { onOpenPayDialog })}
        />
      ))}
    </div>
  );
}
