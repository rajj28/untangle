import type { HTMLAttributes, ReactNode } from "react";

export function Card({ children, className = "", ...props }: {
  children: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLElement>) {
  return <section {...props} className={`ui-card ${className}`}>{children}</section>;
}
