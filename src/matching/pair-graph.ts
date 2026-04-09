import { pairLabelRouteEligibility } from "./match-labels.js";
import type { PairEdgeRecord } from "./matching-types.js";

export interface PairGraphNode {
  contractId: string;
  edges: readonly string[];
}

export interface PairGraph {
  nodes: ReadonlyMap<string, PairGraphNode>;
  edges: readonly PairEdgeRecord[];
}

export const buildPairGraph = (edges: readonly PairEdgeRecord[]): PairGraph => {
  const nodeMap = new Map<string, PairGraphNode>();

  for (const edge of edges) {
    const leftNode = nodeMap.get(edge.interpretedContractAId) ?? {
      contractId: edge.interpretedContractAId,
      edges: []
    };
    const rightNode = nodeMap.get(edge.interpretedContractBId) ?? {
      contractId: edge.interpretedContractBId,
      edges: []
    };
    nodeMap.set(edge.interpretedContractAId, {
      contractId: leftNode.contractId,
      edges: [...leftNode.edges, edge.id]
    });
    nodeMap.set(edge.interpretedContractBId, {
      contractId: rightNode.contractId,
      edges: [...rightNode.edges, edge.id]
    });
  }

  return {
    nodes: nodeMap,
    edges
  };
};

export const listRouteablePairEdges = (graph: PairGraph): readonly PairEdgeRecord[] =>
  graph.edges.filter((edge) => pairLabelRouteEligibility(edge.label, edge.approvalState));
