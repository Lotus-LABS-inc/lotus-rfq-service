import { pairLabelRouteEligibility } from "../match-labels.js";
import type { PairEdgeRecord } from "../matching-types.js";

export interface CryptoPairGraph {
  readonly asset: string;
  readonly assets: readonly string[];
  readonly edges: readonly PairEdgeRecord[];
  readonly edgesByVenuePair: ReadonlyMap<string, readonly PairEdgeRecord[]>;
}

const buildVenuePairKey = (edge: PairEdgeRecord): string =>
  edge.leftVenue.localeCompare(edge.rightVenue) <= 0
    ? `${edge.leftVenue}|${edge.rightVenue}`
    : `${edge.rightVenue}|${edge.leftVenue}`;

export const buildCryptoPairGraph = (edges: readonly PairEdgeRecord[], assets: readonly string[] = ["BTC"]): CryptoPairGraph => {
  const edgesByVenuePair = new Map<string, readonly PairEdgeRecord[]>();
  for (const edge of edges) {
    const key = buildVenuePairKey(edge);
    const existing = edgesByVenuePair.get(key) ?? [];
    edgesByVenuePair.set(key, [...existing, edge]);
  }
  const uniqueAssets = [...new Set(assets)].sort();
  return {
    asset: uniqueAssets.length === 1 ? uniqueAssets[0]! : "MULTI_ASSET",
    assets: uniqueAssets,
    edges,
    edgesByVenuePair
  };
};

export const listRouteableCryptoPairEdges = (graph: CryptoPairGraph): readonly PairEdgeRecord[] =>
  graph.edges.filter((edge) => pairLabelRouteEligibility(edge.label, edge.approvalState));
