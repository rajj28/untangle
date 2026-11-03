import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
} from "d3-force";
import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import type { BusinessSummary, ObligationView, RoundView } from "../../types.ts";

export interface GraphNode {
  id: string;
  name: string;
  initials: string;
  owesMinor: number;
  owedMinor: number;
  netMinor: number;
}

export type GraphEdgeKind = "loop" | "chain" | "open" | "settled";

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  amountMinor: number;
  outstandingMinor: number;
  description: string | null;
  kind: GraphEdgeKind;
  /** Set-off status takes precedence when an obligation appears in both paths. */
  roundStatus: string | null;
  /** A loop edge can also be represented by a transfer leg. */
  alsoChain: boolean;
}

export interface PositionedGraphNode extends GraphNode {
  x: number;
  y: number;
}

interface DraftNode {
  id: string;
  name: string;
  owesMinor: number;
  owedMinor: number;
}

interface SimulationNode extends SimulationNodeDatum {
  id: string;
  radius: number;
}

interface SimulationLink extends SimulationLinkDatum<SimulationNode> {
  source: string;
  target: string;
}

const layoutCache = new Map<string, PositionedGraphNode[]>();

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0] ?? "?";
  const last = words.length > 1 ? words[words.length - 1] ?? first : "";
  return `${first.charAt(0)}${last.charAt(0)}`.toLocaleUpperCase();
}

function isCancelled(status: string): boolean {
  return status.trim().toLocaleLowerCase() === "cancelled";
}

function addBusiness(nodes: Map<string, DraftNode>, id: string, name: string): DraftNode {
  const existing = nodes.get(id);
  if (existing) return existing;

  const node: DraftNode = { id, name: name || "Unknown business", owesMinor: 0, owedMinor: 0 };
  nodes.set(id, node);
  return node;
}

/**
 * Converts obligations and the latest clearing round into the renderer's small,
 * display-focused graph model. Financial positions deliberately use only still
 * outstanding amounts, including obligations that have a pending round action.
 */
export function buildGraph(
  obligations: ObligationView[],
  businesses: BusinessSummary[],
  round: RoundView | null,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = new Map<string, DraftNode>();
  for (const business of businesses) addBusiness(nodes, business.id, business.name);

  const setoffs = new Map<string, string>();
  const legs = new Map<string, string>();
  if (round) {
    for (const setoff of round.setoffs) setoffs.set(setoff.obligationId, setoff.status);
    for (const transfer of round.transfers) {
      for (const leg of transfer.legs) legs.set(leg.obligationId, leg.status);
    }
  }

  const edges: GraphEdge[] = [];
  for (const obligation of obligations) {
    if (isCancelled(obligation.status)) continue;

    const debtor = addBusiness(nodes, obligation.debtorId, obligation.debtorName);
    const creditor = addBusiness(nodes, obligation.creditorId, obligation.creditorName);
    debtor.owesMinor += obligation.outstandingMinor;
    creditor.owedMinor += obligation.outstandingMinor;

    const setoffStatus = setoffs.get(obligation.id);
    const legStatus = legs.get(obligation.id);
    const hasSetoff = setoffStatus !== undefined;
    const hasLeg = legStatus !== undefined;
    const kind: GraphEdgeKind = hasSetoff
      ? "loop"
      : hasLeg
        ? "chain"
        : obligation.outstandingMinor === 0
          ? "settled"
          : "open";

    edges.push({
      id: obligation.id,
      source: obligation.debtorId,
      target: obligation.creditorId,
      amountMinor: obligation.amountMinor,
      outstandingMinor: obligation.outstandingMinor,
      description: obligation.description,
      kind,
      roundStatus: hasSetoff ? setoffStatus ?? null : hasLeg ? legStatus ?? null : null,
      alsoChain: hasSetoff && hasLeg,
    });
  }

  return {
    nodes: [...nodes.values()].map((node) => ({
      ...node,
      initials: initialsFor(node.name),
      netMinor: node.owedMinor - node.owesMinor,
    })),
    edges,
  };
}

export function graphNodeRadius(node: Pick<GraphNode, "owesMinor" | "owedMinor">, maxVolume: number): number {
  if (maxVolume <= 0) return 22;
  const volume = node.owesMinor + node.owedMinor;
  return 22 + Math.sqrt(Math.max(0, volume) / maxVolume) * 8;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function cacheKey(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number): string {
  const ids = nodes.map((node) => node.id).sort().join("|");
  const topology = edges
    .map((edge) => `${edge.source}>${edge.target}`)
    .sort()
    .join("|");
  return `${Math.round(width)}x${Math.round(height)}:${ids}:${topology}`;
}

/**
 * A synchronous, seeded d3-force layout. Starting the sorted nodes on a circle
 * avoids the simulation's random initial positions and keeps renders stable.
 */
export function layout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
): PositionedGraphNode[] {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const key = cacheKey(nodes, edges, safeWidth, safeHeight);
  const cached = layoutCache.get(key);
  if (cached) return cached;
  if (nodes.length === 0) return [];

  const orderedNodes = [...nodes].sort((left, right) => left.id.localeCompare(right.id));
  const maximumVolume = Math.max(...orderedNodes.map((node) => node.owesMinor + node.owedMinor), 0);
  const initialRadius = Math.max(1, Math.min(safeWidth, safeHeight) * 0.28);
  const centerX = safeWidth / 2;
  const centerY = safeHeight / 2;
  const simulationNodes: SimulationNode[] = orderedNodes.map((node, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / orderedNodes.length;
    return {
      id: node.id,
      radius: graphNodeRadius(node, maximumVolume),
      x: centerX + Math.cos(angle) * initialRadius,
      y: centerY + Math.sin(angle) * initialRadius,
    };
  });
  const knownIds = new Set(simulationNodes.map((node) => node.id));
  const simulationLinks: SimulationLink[] = edges
    .filter((edge) => knownIds.has(edge.source) && knownIds.has(edge.target))
    .map((edge) => ({ source: edge.source, target: edge.target }));
  const distanceScale = Math.min(safeWidth / 760, safeHeight / 500);
  const linkDistance = clamp(140 * distanceScale, 72, 180);

  const simulation = forceSimulation(simulationNodes)
    .force(
      "link",
      forceLink<SimulationNode, SimulationLink>(simulationLinks)
        .id((node) => node.id)
        .distance(linkDistance)
        .strength(0.85),
    )
    .force("charge", forceManyBody<SimulationNode>().strength(-400))
    .force("collide", forceCollide<SimulationNode>().radius((node) => node.radius + 7).iterations(2))
    .force("center", forceCenter(centerX, centerY))
    .stop();

  for (let tick = 0; tick < 300; tick += 1) simulation.tick();

  const positions = new Map(
    simulationNodes.map((node) => {
      const padding = node.radius + 5;
      const minX = Math.min(padding, safeWidth / 2);
      const maxX = Math.max(minX, safeWidth - padding);
      const minY = Math.min(padding, safeHeight / 2);
      const maxY = Math.max(minY, safeHeight - padding);
      return [
        node.id,
        {
          x: clamp(node.x ?? centerX, minX, maxX),
          y: clamp(node.y ?? centerY, minY, maxY),
        },
      ] as const;
    }),
  );
  const result = nodes.map((node) => {
    const position = positions.get(node.id);
    return { ...node, x: position?.x ?? centerX, y: position?.y ?? centerY };
  });
  layoutCache.set(key, result);
  return result;
}
