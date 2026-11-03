import { Check } from "lucide-react";

export interface StepItem { label: string; state: "complete" | "current" | "upcoming" }

export function Stepper({ steps, density = "full" }: { steps: readonly StepItem[]; density?: "compact" | "full" }) {
  return <ol className={`ui-stepper ui-stepper-${density}`} aria-label="Settlement progress">
    {steps.map((step, index) => <li key={`${step.label}-${index}`} className={`ui-step ui-step-${step.state}`} aria-current={step.state === "current" ? "step" : undefined}>
      <span className="ui-step-mark" aria-hidden="true">{step.state === "complete" ? <Check size={12} /> : index + 1}</span>
      <span className="ui-step-label">{step.label}</span>
      {index < steps.length - 1 && <span className="ui-step-line" aria-hidden="true" />}
    </li>)}
  </ol>;
}
