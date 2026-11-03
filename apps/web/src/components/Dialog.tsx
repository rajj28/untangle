import type { ReactNode } from "react";
import { Sheet } from "../ui/Sheet.tsx";

export function Dialog({ open, title, onClose, children, wide = false }: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return <Sheet open={open} title={title} onClose={onClose} wide={wide}>{children}</Sheet>;
}
