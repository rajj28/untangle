import { ArrowRight, CircleCheck, FilePlus2 } from "lucide-react";

export function Empty({ title, detail, action, onAction, settled = false }: {
  title: string;
  detail: string;
  action?: string | undefined;
  onAction?: (() => void) | undefined;
  settled?: boolean;
}) {
  const Icon = settled ? CircleCheck : FilePlus2;
  return (
    <div className="flex h-full min-h-64 flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--brand-tint)] text-[var(--brand)]"><Icon size={22} /></div>
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-muted">{detail}</p>
      {action && onAction && <button className="desk-button desk-button-primary mt-5" onClick={onAction}>{action}<ArrowRight size={14} /></button>}
    </div>
  );
}
