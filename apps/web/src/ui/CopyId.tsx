import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "./Button.tsx";

export function CopyId({ value, label = "Copy id" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };
  const shortened = value.length > 19 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
  return <span className="ui-copy-id" title={value}>
    <code>{shortened}</code>
    <Button type="button" variant="ghost" size="sm" onClick={() => void copy()} aria-label={copied ? `${label}: copied` : label}>
      {copied ? <><Check size={14} />Copied</> : <Copy size={14} />}
    </Button>
  </span>;
}
