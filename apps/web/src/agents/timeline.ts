import type { AgentStep, AgentName, Approval } from "../types.ts";

/** A run's approvals keyed by the step seq they were requested after. */
export interface ApprovalsBySeq {
  [seq: number]: Approval[];
}

/** A group of consecutive steps from the same agent. */
export interface AgentBlock {
  agent: AgentName;
  businessId: string | null;
  steps: AgentStep[];
  /** The highest `seq` in this block (used for approval lookup). */
  lastSeq: number;
}

/**
 * Groups consecutive `AgentStep` objects by agent name into `AgentBlock`s.
 * Steps from the same agent are merged until the agent changes.
 * Pure function — no side-effects, safe to use in tests.
 */
export function groupSteps(steps: readonly AgentStep[]): AgentBlock[] {
  const blocks: AgentBlock[] = [];
  for (const step of steps) {
    const last = blocks[blocks.length - 1];
    if (last !== undefined && last.agent === step.agent && last.businessId === step.businessId) {
      last.steps.push(step);
      last.lastSeq = step.seq;
    } else {
      blocks.push({ agent: step.agent, businessId: step.businessId, steps: [step], lastSeq: step.seq });
    }
  }
  return blocks;
}

/**
 * Classifies a tool name into its namespace for visual styling.
 * Returns "paypal" for tools starting with "paypal.", "untangle" for "untangle.*",
 * and "other" for everything else.
 */
export type ToolKind = "paypal" | "untangle" | "other";

export function classifyTool(tool: string): ToolKind {
  if (tool.startsWith("paypal.")) return "paypal";
  if (tool.startsWith("untangle.")) return "untangle";
  return "other";
}

/**
 * Maps an urgency value from `Advice.recommendations` to a display variant.
 * "now" → amber, "soon" → blue, "fyi" → muted.
 */
export type UrgencyVariant = "now" | "soon" | "fyi";

export function urgencyLabel(urgency: UrgencyVariant): string {
  if (urgency === "now") return "Now";
  if (urgency === "soon") return "Soon";
  return "FYI";
}

export function urgencyClassName(urgency: UrgencyVariant): string {
  if (urgency === "now") return "urgency-now";
  if (urgency === "soon") return "urgency-soon";
  return "urgency-fyi";
}
