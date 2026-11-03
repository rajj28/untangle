import type { z } from "zod";
import type { Gemini, GeminiContent, GeminiPart } from "./gemini.ts";
import { AiError, parseJson } from "./gemini.ts";

export interface AgentTool {
  /** Name the model sees; unique within one agent. */
  name: string;
  /** Name shown in the agent console, e.g. "paypal.list_invoices" or "untangle.plan_round". */
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Whose PayPal account the tool acts on, for the console. */
  businessId?: string;
  run(args: Record<string, unknown>): Promise<unknown>;
  /** One line for the console; the model always receives the full (size-capped) result. */
  summarize?(result: unknown, args: Record<string, unknown>): string;
}

export interface StepEvent {
  kind: "thought" | "tool_call" | "tool_result" | "decision" | "message" | "error";
  title: string;
  detail?: string | null;
  tool?: string | null;
  businessId?: string | null;
}

export type StepSink = (step: StepEvent) => Promise<void>;

export interface ToolCallRecord {
  tool: string;
  label: string;
  args: Record<string, unknown>;
  result: unknown;
  ok: boolean;
}

const MAX_RESULT_CHARS = 14_000;

function capResult(value: unknown): Record<string, unknown> {
  const text = JSON.stringify(value ?? null);
  if (text.length <= MAX_RESULT_CHARS) return { result: value ?? null };
  return { result_truncated: text.slice(0, MAX_RESULT_CHARS), note: "Result was truncated." };
}

function short(text: string, max = 280): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * The tool loop. The model's turns are sent back verbatim (thought signatures included),
 * tools run in parallel when the model asks for several at once, and every call is reported.
 */
export async function runAgent(gemini: Gemini, input: {
  system: string;
  prompt: GeminiPart[];
  tools: AgentTool[];
  onStep: StepSink;
  maxSteps?: number;
}): Promise<{ text: string; calls: ToolCallRecord[]; contents: GeminiContent[] }> {
  const byName = new Map(input.tools.map((tool) => [tool.name, tool]));
  const declarations = input.tools.map((tool) => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters }));
  const contents: GeminiContent[] = [{ role: "user", parts: input.prompt }];
  const calls: ToolCallRecord[] = [];
  let text = "";
  for (let step = 0; step < (input.maxSteps ?? 8); step++) {
    const result = await gemini.generate({ system: input.system, contents, tools: declarations });
    contents.push(result.content);
    text = result.text;
    if (result.functionCalls.length > 0 && result.text.trim() !== "") {
      await input.onStep({ kind: "thought", title: short(result.text, 200) });
    }
    if (result.functionCalls.length === 0) break;
    const responses = await Promise.all(result.functionCalls.map(async (call) => {
      const tool = byName.get(call.name);
      if (tool === undefined) {
        return { functionResponse: { name: call.name, response: { error: `Unknown tool ${call.name}` } } } satisfies GeminiPart;
      }
      await input.onStep({ kind: "tool_call", title: `Called ${tool.label}`, detail: short(JSON.stringify(call.args), 240), tool: tool.label, businessId: tool.businessId ?? null });
      try {
        const output = await tool.run(call.args);
        calls.push({ tool: tool.name, label: tool.label, args: call.args, result: output, ok: true });
        await input.onStep({ kind: "tool_result", title: tool.summarize?.(output, call.args) ?? `${tool.label} answered`, tool: tool.label, businessId: tool.businessId ?? null });
        return { functionResponse: { name: call.name, response: capResult(output) } } satisfies GeminiPart;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        calls.push({ tool: tool.name, label: tool.label, args: call.args, result: message, ok: false });
        await input.onStep({ kind: "error", title: `${tool.label} failed`, detail: short(message), tool: tool.label, businessId: tool.businessId ?? null });
        return { functionResponse: { name: call.name, response: { error: short(message, 600) } } } satisfies GeminiPart;
      }
    }));
    contents.push({ role: "user", parts: responses });
  }
  return { text, calls, contents };
}

/** One structured answer, validated with zod; a malformed answer gets one corrective retry. */
export async function generateStructured<T>(gemini: Gemini, input: {
  system: string;
  parts: GeminiPart[];
  jsonSchema: Record<string, unknown>;
  schema: z.ZodType<T>;
  history?: GeminiContent[];
  temperature?: number;
}): Promise<{ value: T; model: string }> {
  const contents: GeminiContent[] = [...(input.history ?? []), { role: "user", parts: input.parts }];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await gemini.generate({
      system: input.system,
      contents,
      responseJsonSchema: input.jsonSchema,
      ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
    });
    let problem: string;
    try {
      const parsed = input.schema.safeParse(parseJson(result.text));
      if (parsed.success) return { value: parsed.data, model: result.model };
      problem = parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    } catch {
      problem = "The answer was not valid JSON.";
    }
    contents.push(result.content, { role: "user", parts: [{ text: `Your answer did not match the required format (${problem}). Reply again with only the corrected JSON.` }] });
  }
  throw new AiError("AI_BAD_OUTPUT", "Gemini did not return a valid structured answer", true);
}
