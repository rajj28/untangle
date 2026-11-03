import { ArrowRight, CircleCheck, FileSearch } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./Button.tsx";

export function EmptyState({ title, detail, action, onAction, icon }: {
  title: string;
  detail: string;
  action?: string;
  onAction?: () => void;
  icon?: ReactNode;
}) {
  return <div className="ui-empty-state">
    <span className="ui-empty-icon" aria-hidden="true">{icon ?? <FileSearch size={24} />}</span>
    <h2>{title}</h2>
    <p>{detail}</p>
    {action !== undefined && onAction !== undefined && <Button variant="primary" onClick={onAction}>{action}<ArrowRight size={15} /></Button>}
    {action === undefined && <CircleCheck className="sr-only" aria-hidden="true" />}
  </div>;
}
