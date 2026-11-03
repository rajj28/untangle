import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { JSX, KeyboardEvent } from "react";
import type { BusinessSummary, ObligationView, RoundView } from "../../types.ts";
import { buildGraph, graphNodeRadius, layout } from "./graph.ts";
import type { GraphEdge, GraphEdgeKind, PositionedGraphNode } from "./graph.ts";

export interface NetworkViewProps {
  obligations: ObligationView[];
  businesses: BusinessSummary[];
  round: RoundView | null;
  /** Business the viewer is acting as, or null for everyone. */
  actingAs: string | null;
  currency: string;
}

interface EdgeGeometry {
  edge: GraphEdge;
  path: string;
  markerX: number;
  markerY: number;
}

const avatarColors = ["#0f766e", "#2563eb", "#7c3aed", "#be123c", "#b45309", "#047857", "#0369a1", "#a21caf"];

function hashText(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) | 0;
  return Math.abs(hash);
}

function avatarColor(initials: string): string {
  return avatarColors[hashText(initials) % avatarColors.length] ?? avatarColors[0] ?? "#0f766e";
}

function edgeColor(kind: GraphEdgeKind): string {
  if (kind === "loop") return "var(--brand)";
  if (kind === "chain") return "#0070E0";
  if (kind === "settled") return "var(--ink-muted)";
  return "var(--ink-soft)";
}

function edgeLabel(kind: GraphEdgeKind): string {
  if (kind === "loop") return "Cleared in a loop — no money moved";
  if (kind === "chain") return "Settled by a PayPal chain payment";
  if (kind === "settled") return "Settled";
  return "Open obligation";
}

function isRecorded(status: string | null): boolean {
  const normalized = status?.trim().toLocaleLowerCase();
  return normalized === "recorded" || normalized === "settled" || normalized === "completed" || normalized === "paid";
}

function shortName(name: string): string {
  return name.length > 16 ? `${name.slice(0, 15)}…` : name;
}

function formatMoney(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amountMinor / 100);
  } catch {
    return `${currency} ${(amountMinor / 100).toFixed(2)}`;
  }
}

function netLabel(amountMinor: number, currency: string): string {
  const prefix = amountMinor > 0 ? "+" : "";
  return `${prefix}${formatMoney(amountMinor, currency)}`;
}

function edgeWidth(edge: GraphEdge, largestAmount: number): number {
  const value = edge.outstandingMinor > 0 ? edge.outstandingMinor : edge.amountMinor;
  if (largestAmount <= 0) return 1.5;
  return 1.5 + (Math.sqrt(Math.max(0, value) / largestAmount) * 6.5);
}

function netRingColor(netMinor: number): string {
  if (netMinor > 0) return "var(--brand)";
  if (netMinor < 0) return "var(--amber)";
  return "var(--ink-muted)";
}

function geometryForEdges(edges: GraphEdge[], positions: Map<string, PositionedGraphNode>): EdgeGeometry[] {
  const pairGroups = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const key = [edge.source, edge.target].sort().join("\u0000");
    const group = pairGroups.get(key) ?? [];
    group.push(edge);
    pairGroups.set(key, group);
  }

  return edges.flatMap((edge) => {
    const start = positions.get(edge.source);
    const end = positions.get(edge.target);
    if (!start || !end) return [];
    if (edge.source === edge.target) {
      const loopRadius = 44;
      return [{
        edge,
        path: `M ${start.x} ${start.y - 24} C ${start.x + loopRadius} ${start.y - 68}, ${start.x + loopRadius} ${start.y + 36}, ${start.x + 8} ${start.y + 24}`,
        markerX: start.x + loopRadius * 0.75,
        markerY: start.y - 10,
      }];
    }

    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const distance = Math.hypot(deltaX, deltaY) || 1;
    const trim = 31;
    const startX = start.x + (deltaX / distance) * trim;
    const startY = start.y + (deltaY / distance) * trim;
    const endX = end.x - (deltaX / distance) * trim;
    const endY = end.y - (deltaY / distance) * trim;
    const groupKey = [edge.source, edge.target].sort().join("\u0000");
    const group = pairGroups.get(groupKey) ?? [edge];
    const sameDirection = group.filter((item) => item.source === edge.source && item.target === edge.target);
    const parallelIndex = sameDirection.findIndex((item) => item.id === edge.id);
    const parallelOffset = (parallelIndex - (sameDirection.length - 1) / 2) * 12;
    const direction = edge.source.localeCompare(edge.target) <= 0 ? 1 : -1;
    const bend = direction * 20 + parallelOffset;
    const controlX = (startX + endX) / 2 + (-deltaY / distance) * bend;
    const controlY = (startY + endY) / 2 + (deltaX / distance) * bend;
    const markerX = 0.25 * startX + 0.5 * controlX + 0.25 * endX;
    const markerY = 0.25 * startY + 0.5 * controlY + 0.25 * endY;
    return [{
      edge,
      path: `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`,
      markerX,
      markerY,
    }];
  });
}

function useContainerWidth() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const update = () => {
      const nextWidth = Math.floor(element.getBoundingClientRect().width);
      setWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
    };
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { containerRef, width };
}

function useViewportHeight(): number {
  const [viewportHeight, setViewportHeight] = useState(() => (typeof window === "undefined" ? 640 : window.innerHeight));

  useEffect(() => {
    const update = () => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return viewportHeight;
}

function selectionIncludesNode(activeNode: string | null, activeEdge: GraphEdge | null, nodeId: string): boolean {
  if (activeNode) return activeNode === nodeId;
  return activeEdge?.source === nodeId || activeEdge?.target === nodeId;
}

export default function NetworkView(props: NetworkViewProps): JSX.Element {
  const { containerRef, width } = useContainerWidth();
  const [activeNodeId, setActiveNodeId] = useState<string | null>(props.actingAs);
  const [activeEdgeId, setActiveEdgeId] = useState<string | null>(null);
  const markerPrefix = useId().replaceAll(":", "");
  const viewportHeight = useViewportHeight();
  const graphHeight = Math.max(320, Math.min(Math.floor(viewportHeight * 0.7), Math.round(width * 0.75)));

  const graph = useMemo(
    () => buildGraph(props.obligations, props.businesses, props.round),
    [props.businesses, props.obligations, props.round],
  );
  const positionedNodes = useMemo(
    () => (width > 0 ? layout(graph.nodes, graph.edges, width, graphHeight) : []),
    [graph.edges, graph.nodes, graphHeight, width],
  );
  const positions = useMemo(() => new Map(positionedNodes.map((node) => [node.id, node])), [positionedNodes]);
  const edgeGeometry = useMemo(() => geometryForEdges(graph.edges, positions), [graph.edges, positions]);
  const nodesById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const activeEdge = useMemo(
    () => graph.edges.find((edge) => edge.id === activeEdgeId) ?? null,
    [activeEdgeId, graph.edges],
  );
  const activeNode = useMemo(
    () => graph.nodes.find((node) => node.id === activeNodeId) ?? null,
    [activeNodeId, graph.nodes],
  );
  const largestAmount = useMemo(
    () => Math.max(...graph.edges.map((edge) => Math.max(edge.amountMinor, edge.outstandingMinor)), 0),
    [graph.edges],
  );
  const maximumVolume = useMemo(
    () => Math.max(...graph.nodes.map((node) => node.owesMinor + node.owedMinor), 0),
    [graph.nodes],
  );
  const hasSelection = activeNode !== null || activeEdge !== null;

  useEffect(() => {
    if (props.actingAs) {
      setActiveNodeId(props.actingAs);
      setActiveEdgeId(null);
    }
  }, [props.actingAs]);

  const clearSelection = () => {
    setActiveNodeId(null);
    setActiveEdgeId(null);
  };
  const selectNode = (nodeId: string) => {
    setActiveNodeId(nodeId);
    setActiveEdgeId(null);
  };
  const selectEdge = (edgeId: string) => {
    setActiveNodeId(null);
    setActiveEdgeId(edgeId);
  };
  const onNodeKeyDown = (event: KeyboardEvent<SVGGElement>, nodeId: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectNode(nodeId);
    }
  };

  if (graph.edges.length === 0) {
    return (
      <section className="rounded-xl border p-8 text-center shadow-sm" style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
        <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full" style={{ background: "var(--brand-tint)", color: "var(--brand)" }}>↔</div>
        <h2 className="text-base font-semibold" style={{ color: "var(--ink)" }}>Your network will take shape here</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm" style={{ color: "var(--ink-soft)" }}>Add an obligation to see who owes whom, where loops can disappear, and which payments settle a chain.</p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border shadow-sm" style={{ background: "var(--surface)", borderColor: "var(--line)", boxShadow: "var(--shadow)" }}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3" style={{ borderColor: "var(--line)" }}>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--ink)" }}>Who owes whom</h2>
          <p className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)" }}>Follow each invoice from debtor to creditor.</p>
        </div>
        {props.actingAs ? <span className="rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: "var(--brand-tint)", color: "var(--brand)" }}>Your perspective</span> : null}
      </div>

      <div ref={containerRef} className="relative w-full overflow-hidden" style={{ height: `${graphHeight}px`, minHeight: "320px" }}>
        {width > 0 ? (
          <svg
            className="block size-full"
            viewBox={`0 0 ${width} ${graphHeight}`}
            role="img"
            aria-label="Network of businesses and obligations"
            onPointerDown={clearSelection}
          >
            <defs>
              <pattern id={`${markerPrefix}-dots`} width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="var(--line)" opacity="0.8" />
              </pattern>
              {(["loop", "chain", "open", "settled"] as const).map((kind) => (
                <marker key={kind} id={`${markerPrefix}-${kind}-arrow`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                  <path d="M 0 0 L 8 4 L 0 8 z" fill={edgeColor(kind)} />
                </marker>
              ))}
            </defs>
            <rect width={width} height={graphHeight} fill={`url(#${markerPrefix}-dots)`} opacity="0.55" />

            <g aria-label="Obligations">
              {edgeGeometry.map((geometry) => {
                const { edge } = geometry;
                const isFocused = activeEdge?.id === edge.id || (activeNodeId !== null && (edge.source === activeNodeId || edge.target === activeNodeId));
                const opacity = hasSelection && !isFocused ? 0.12 : edge.kind === "settled" ? 0.4 : 0.94;
                return (
                  <g key={edge.id}>
                    <path
                      d={geometry.path}
                      fill="none"
                      stroke={edgeColor(edge.kind)}
                      strokeWidth={edgeWidth(edge, largestAmount)}
                      strokeLinecap="round"
                      strokeDasharray={edge.kind === "loop" && !isRecorded(edge.roundStatus) ? "7 6" : undefined}
                      markerEnd={`url(#${markerPrefix}-${edge.kind}-arrow)`}
                      opacity={opacity}
                      style={{ cursor: "pointer", pointerEvents: "stroke", transition: "stroke-width 600ms ease, opacity 600ms ease" }}
                      onPointerEnter={() => selectEdge(edge.id)}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        selectEdge(edge.id);
                      }}
                    />
                    {edge.alsoChain ? (
                      <circle cx={geometry.markerX} cy={geometry.markerY} r="5" fill="#0070E0" stroke="var(--surface)" strokeWidth="2" opacity={opacity} pointerEvents="none">
                        <title>Also settled by a PayPal chain payment</title>
                      </circle>
                    ) : null}
                  </g>
                );
              })}
            </g>

            <g aria-label="Businesses">
              {positionedNodes.map((node) => {
                const radius = graphNodeRadius(node, maximumVolume);
                const selected = selectionIncludesNode(activeNodeId, activeEdge, node.id);
                const opacity = hasSelection && !selected ? 0.24 : 1;
                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x} ${node.y})`}
                    tabIndex={0}
                    role="button"
                    aria-label={`${node.name}, net ${netLabel(node.netMinor, props.currency)}`}
                    opacity={opacity}
                    style={{ cursor: "pointer", outline: "none", transition: "opacity 180ms ease" }}
                    onPointerEnter={() => selectNode(node.id)}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      selectNode(node.id);
                    }}
                    onFocus={() => selectNode(node.id)}
                    onKeyDown={(event) => onNodeKeyDown(event, node.id)}
                  >
                    <title>{node.name}</title>
                    <circle r={radius + 5} fill="var(--surface)" stroke={netRingColor(node.netMinor)} strokeWidth={selected ? 3.5 : 2.5} />
                    <circle r={radius} fill={avatarColor(node.initials)} />
                    <text textAnchor="middle" dominantBaseline="central" fill="white" fontSize={radius > 26 ? 13 : 12} fontWeight="700" letterSpacing="0.04em">{node.initials}</text>
                    <text y={radius + 20} textAnchor="middle" fill="var(--ink)" fontSize="12" fontWeight="650" pointerEvents="none">{shortName(node.name)}<title>{node.name}</title></text>
                  </g>
                );
              })}
            </g>
          </svg>
        ) : null}

        {activeNode ? (
          <div className="pointer-events-none absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] rounded-lg border px-3 py-2 shadow-lg" style={{ background: "color-mix(in srgb, var(--surface) 94%, transparent)", borderColor: "var(--line)", color: "var(--ink)", backdropFilter: "blur(10px)" }}>
            <div className="text-sm font-semibold">{activeNode.name}</div>
            <div className="mt-1 flex flex-wrap gap-x-2 text-xs" style={{ color: "var(--ink-soft)" }}>
              <span>Owes {formatMoney(activeNode.owesMinor, props.currency)}</span><span aria-hidden="true">·</span><span>Owed {formatMoney(activeNode.owedMinor, props.currency)}</span><span aria-hidden="true">·</span><span>Net {netLabel(activeNode.netMinor, props.currency)}</span>
            </div>
          </div>
        ) : null}
        {activeEdge && !activeNode ? (
          <div className="pointer-events-none absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] rounded-lg border px-3 py-2 shadow-lg" style={{ background: "color-mix(in srgb, var(--surface) 94%, transparent)", borderColor: "var(--line)", color: "var(--ink)", backdropFilter: "blur(10px)" }}>
            <div className="text-sm font-semibold">{nodesById.get(activeEdge.source)?.name ?? activeEdge.source} <span style={{ color: "var(--ink-muted)" }}>→</span> {nodesById.get(activeEdge.target)?.name ?? activeEdge.target}</div>
            {activeEdge.description ? <div className="mt-0.5 truncate text-xs" style={{ color: "var(--ink-soft)" }}>{activeEdge.description}</div> : null}
            <div className="mt-1 flex flex-wrap gap-x-2 text-xs" style={{ color: "var(--ink-soft)" }}>
              <span>{edgeLabel(activeEdge.kind)}</span><span aria-hidden="true">·</span><span>Amount {formatMoney(activeEdge.amountMinor, props.currency)}</span><span aria-hidden="true">·</span><span>Outstanding {formatMoney(activeEdge.outstandingMinor, props.currency)}</span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-3 text-xs" style={{ borderColor: "var(--line)", color: "var(--ink-soft)" }} aria-label="Network legend">
        <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full" style={{ background: "var(--brand)" }} />Loop (cleared, no money)</span>
        <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full" style={{ background: "#0070E0" }} />Chain (one PayPal payment)</span>
        <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full" style={{ background: "var(--ink-soft)" }} />Open</span>
        <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full" style={{ background: "var(--ink-muted)", opacity: 0.45 }} />Settled</span>
      </div>
      <p className="border-t px-4 py-2.5 text-xs" style={{ borderColor: "var(--line)", color: "var(--ink-muted)", background: "var(--surface-soft)" }}>Loops are debts that run in a circle; Untangle cancels them on the PayPal invoices.</p>
    </section>
  );
}
