import { classifyRouteabilityBasis } from "../inventory/inventory-basis-classifier.js";
import { pairLabelTriEligibility } from "./match-labels.js";
import type { ContractFamily, PairEdgeRecord } from "./matching-types.js";

export interface TriCandidate {
  triCandidateId: string;
  constituentPairEdgeIds: readonly string[];
  family: ContractFamily;
  basisClassification: ReturnType<typeof classifyRouteabilityBasis>;
  exactSafe: boolean;
  blockerReasons: readonly string[];
}

const edgeKey = (left: string, right: string): string => left.localeCompare(right) <= 0 ? `${left}|${right}` : `${right}|${left}`;

export const deriveTriCandidates = (edges: readonly PairEdgeRecord[]): readonly TriCandidate[] => {
  const exactEdges = edges.filter((edge) => pairLabelTriEligibility(edge.label, edge.approvalState));
  const byKey = new Map(exactEdges.map((edge) => [edgeKey(edge.interpretedContractAId, edge.interpretedContractBId), edge] as const));
  const contractIds = [...new Set(exactEdges.flatMap((edge) => [edge.interpretedContractAId, edge.interpretedContractBId]))].sort(
    (left, right) => left.localeCompare(right)
  );
  const results: TriCandidate[] = [];

  for (let index = 0; index < contractIds.length; index += 1) {
    for (let inner = index + 1; inner < contractIds.length; inner += 1) {
      for (let cursor = inner + 1; cursor < contractIds.length; cursor += 1) {
        const a = contractIds[index]!;
        const b = contractIds[inner]!;
        const c = contractIds[cursor]!;
        const ab = byKey.get(edgeKey(a, b));
        const ac = byKey.get(edgeKey(a, c));
        const bc = byKey.get(edgeKey(b, c));
        const blockerReasons: string[] = [];
        if (!ab || !ac || !bc) {
          blockerReasons.push("MISSING_EDGE");
        }
        const family = ab?.family ?? ac?.family ?? bc?.family ?? "OTHER_EVENT_STYLE";
        if (ab && ac && bc) {
          if (ab.family !== ac.family || ab.family !== bc.family) {
            blockerReasons.push("FAMILY_INCONSISTENCY");
          }
          if (!pairLabelTriEligibility(ab.label, ab.approvalState)
            || !pairLabelTriEligibility(ac.label, ac.approvalState)
            || !pairLabelTriEligibility(bc.label, bc.approvalState)) {
            blockerReasons.push("EDGE_NOT_APPROVED");
          }
        }

        results.push({
          triCandidateId: `${a}|${b}|${c}`,
          constituentPairEdgeIds: [ab?.id, ac?.id, bc?.id].filter((value): value is string => value !== undefined),
          family,
          basisClassification: classifyRouteabilityBasis(
            [ab?.temporalBasis, ac?.temporalBasis, bc?.temporalBasis]
              .filter((value): value is PairEdgeRecord["temporalBasis"] => value !== undefined)
              .map((basis) =>
                basis === "HISTORICAL_ONLY" ? "HISTORICAL"
                : basis === "LIVE_ONLY" ? "LIVE_CURRENT_STATE"
                : basis === "MIXED_BASIS" ? "UNKNOWN"
                : "UNKNOWN"
              )
          ),
          exactSafe: blockerReasons.length === 0,
          blockerReasons
        });
      }
    }
  }

  return results;
};
