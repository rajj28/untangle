import type { JSX } from "react";
import { useEffect, useRef } from "react";
import {
  Workflow,
  ScanSearch,
  FileScan,
  ReceiptText,
  Landmark,
  Scale,
  ShieldCheck,
  BellRing,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface Agent {
  name: string;
  Icon: LucideIcon;
  job: string;
  tools: readonly string[];
  color: string;
}

const AGENTS: Agent[] = [
  {
    name: "Orchestrator",
    Icon: Workflow,
    job: "Plans and runs the whole cycle, explaining every step",
    tools: ["untangle.*"],
    color: "#0f766e",
  },
  {
    name: "Discovery",
    Icon: ScanSearch,
    job: "Searches every member's PayPal account for unpaid invoices between them",
    tools: ["paypal.list_invoices"],
    color: "#2563eb",
  },
  {
    name: "Intake",
    Icon: FileScan,
    job: "Reads photos, voice notes, PDFs and chats into debts",
    tools: ["Gemini multimodal"],
    color: "#7c3aed",
  },
  {
    name: "Invoicing",
    Icon: ReceiptText,
    job: "Issues the PayPal invoice, with a QR code",
    tools: ["paypal.create_invoice", "paypal.send_invoice", "paypal.generate_invoice_qr_code"],
    color: "#0070e0",
  },
  {
    name: "Treasurer",
    Icon: Landmark,
    job: "One per business: checks cash flow and signs within its owner's policy",
    tools: ["paypal.list_transactions"],
    color: "#b45309",
  },
  {
    name: "Negotiator",
    Icon: Scale,
    job: "Two treasurers settle a disputed amount from the evidence",
    tools: ["Gemini"],
    color: "#be123c",
  },
  {
    name: "Watchdog",
    Icon: ShieldCheck,
    job: "Re-reads every invoice from PayPal and checks for disputes",
    tools: ["paypal.get_invoice", "paypal.list_disputes"],
    color: "#0e7490",
  },
  {
    name: "Collections",
    Icon: BellRing,
    job: "Drafts reminders in the customer's own language",
    tools: ["paypal.send_invoice_reminder"],
    color: "#4d7c0f",
  },
] as const;

function ToolChip({ tool }: { tool: string }): JSX.Element {
  const isPaypal = tool.startsWith("paypal.");
  return (
    <span
      className="ln-tool-chip"
      style={
        isPaypal
          ? { background: "#dbeafe", color: "#0070e0" }
          : { background: "#f4f4f5", color: "#52525b" }
      }
    >
      {tool}
    </span>
  );
}

function AgentCard({ agent, delay }: { agent: Agent; delay: number }): JSX.Element {
  return (
    <article
      className="ln-agent-card reveal flex flex-col gap-3"
      style={{ transitionDelay: `${delay}ms` }}
    >
      {/* Icon */}
      <div
        className="flex items-center justify-center w-11 h-11 rounded-xl"
        style={{ background: agent.color + "18" }}
      >
        <agent.Icon size={22} style={{ color: agent.color }} aria-hidden="true" />
      </div>

      {/* Name + job */}
      <div>
        <h3 className="font-semibold text-zinc-900 text-base leading-snug mb-1">
          {agent.name}
        </h3>
        <p className="text-sm text-zinc-500 leading-relaxed">
          {agent.job}
        </p>
      </div>

      {/* Tool chips */}
      <div className="flex flex-wrap gap-1.5 mt-auto pt-1">
        {agent.tools.map((tool) => (
          <ToolChip key={tool} tool={tool} />
        ))}
      </div>
    </article>
  );
}

export function AgentsSection(): JSX.Element {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
          }
        });
      },
      { threshold: 0.1 },
    );
    el.querySelectorAll(".reveal").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  return (
    <section id="agents" ref={ref} className="ln-section bg-zinc-50" aria-labelledby="agents-heading">
      <div className="ln-container">
        {/* Heading */}
        <div className="max-w-2xl mx-auto text-center mb-16 reveal">
          <p className="ln-eyebrow mb-3">The crew</p>
          <h2 id="agents-heading" className="text-4xl font-bold text-zinc-900 leading-tight tracking-tight mb-4">
            Meet the agents
          </h2>
          <p className="text-zinc-500 text-lg leading-relaxed">
            An orchestrator runs every clearing cycle and hands work to specialist agents. Each one works inside its own business's PayPal account through the PayPal Agent Toolkit, and nothing moves money without its owner's approval or written policy.
          </p>
        </div>

        {/* Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {AGENTS.map((agent, i) => (
            <AgentCard key={agent.name} agent={agent} delay={i * 60} />
          ))}
        </div>
      </div>
    </section>
  );
}
