import { buildPairGraph, listRouteablePairEdges, type PairGraph } from "../pair-graph.js";
import type { PairEdgeRecord } from "../matching-types.js";

export interface SportsPairGraph extends PairGraph {
  domains: readonly string[];
}

export const buildSportsPairGraph = (edges: readonly PairEdgeRecord[]): SportsPairGraph => ({
  ...buildPairGraph(edges),
  domains: ["SPORTS", "ESPORTS"]
});

export const listRouteableSportsPairEdges = (graph: SportsPairGraph): readonly PairEdgeRecord[] =>
  listRouteablePairEdges(graph);
