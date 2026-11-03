import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "paypal";
export type ButtonSize = "sm" | "md" | "lg";

export function Button({ variant = "secondary", size = "md", loading = false, disabled = false, className = "", children, ...props }: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  return <button
    {...props}
    className={`ui-button ui-button-${variant} ui-button-${size} ${className}`}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
  >
    {loading && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
    {children}
  </button>;
}
