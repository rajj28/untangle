import type { KeyboardEvent, ReactNode } from "react";

export interface Segment<T extends string> { value: T; label: string; icon?: ReactNode }

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: readonly Segment<T>[];
  onChange: (value: T) => void;
  label: string;
}) {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = options.findIndex((option) => option.value === value);
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const next = options[(index + offset + options.length) % options.length];
    if (next) {
      onChange(next.value);
      event.currentTarget.querySelector<HTMLButtonElement>(`[data-segment="${next.value}"]`)?.focus();
    }
  };
  return <div className="ui-segmented" role="tablist" aria-label={label} onKeyDown={move}>
    {options.map((option) => <button key={option.value} data-segment={option.value} role="tab" aria-selected={value === option.value} tabIndex={value === option.value ? 0 : -1} className="ui-segment" onClick={() => onChange(option.value)}>
      {option.icon}{option.label}
    </button>)}
  </div>;
}
