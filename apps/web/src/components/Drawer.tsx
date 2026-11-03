import type { ReactNode } from "react";
import { Sheet } from "../ui/Sheet.tsx";

export function Drawer({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  return <Sheet open={open} title={title} onClose={onClose} wide>{children}</Sheet>;
}
