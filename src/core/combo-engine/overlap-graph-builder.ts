import Decimal from "decimal.js";

import type {
  OverlapGraph,
  OverlapGraphEdge,
  OverlapGraphNode,
  OverlapGraphOverlapLeg,
  ResidualVector
} from "./types.js";

export interface IOverlapGraphBuilder {
  build(vectors: readonly ResidualVector[]): OverlapGraph;
}

export class OverlapGraphBuilder implements IOverlapGraphBuilder {
  public build(vectors: readonly ResidualVector[]): OverlapGraph {
    if (vectors.length === 0) {
      throw new Error("empty_overlap_graph_input");
    }

    const nodes = this.normalizeNodes(vectors);
    const edges: OverlapGraphEdge[] = [];

    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      const left = nodes[leftIndex];
      if (!left) {
        continue;
      }

      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const right = nodes[rightIndex];
        if (!right) {
          continue;
        }

        const edge = this.buildEdge(left, right);
        if (edge !== null) {
          edges.push(edge);
        }
      }
    }

    edges.sort((left, right) => {
      if (left.from !== right.from) {
        return left.from.localeCompare(right.from);
      }
      return left.to.localeCompare(right.to);
    });

    return {
      nodes,
      edges
    };
  }

  private normalizeNodes(vectors: readonly ResidualVector[]): OverlapGraphNode[] {
    const bucket = vectors[0]?.compatibilityBucket;
    if (!bucket || bucket.trim().length === 0) {
      throw new Error("invalid_compatibility_bucket");
    }

    const seenEntityIds = new Set<string>();

    return vectors.map((vector) => {
      if (vector.compatibilityBucket !== bucket) {
        throw new Error("compatibility_bucket_mismatch");
      }

      if (seenEntityIds.has(vector.entityId)) {
        throw new Error("duplicate_entity_id");
      }
      seenEntityIds.add(vector.entityId);

      this.validateVectorEntries(vector.vector);

      return {
        entityId: vector.entityId,
        userId: vector.userId,
        compatibilityBucket: vector.compatibilityBucket,
        vector: { ...vector.vector },
        legCount: vector.legCount,
        grossAbsSize: vector.grossAbsSize
      };
    });
  }

  private buildEdge(left: OverlapGraphNode, right: OverlapGraphNode): OverlapGraphEdge | null {
    const overlapLegs: OverlapGraphOverlapLeg[] = [];
    let compressionPotential = new Decimal(0);

    const sharedKeys = [...new Set([...Object.keys(left.vector), ...Object.keys(right.vector)])]
      .filter((key) => key in left.vector && key in right.vector)
      .sort((a, b) => a.localeCompare(b));

    for (const key of sharedKeys) {
      const rawLeft = left.vector[key];
      const rawRight = right.vector[key];
      if (rawLeft === undefined || rawRight === undefined) {
        continue;
      }

      const signedLeft = this.parseSignedSize(rawLeft);
      const signedRight = this.parseSignedSize(rawRight);

      if (signedLeft.isZero() || signedRight.isZero()) {
        continue;
      }

      if (signedLeft.gt(0) === signedRight.gt(0)) {
        continue;
      }

      const offsetSize = Decimal.min(signedLeft.abs(), signedRight.abs());
      overlapLegs.push({
        key,
        signedSizeA: signedLeft.toString(),
        signedSizeB: signedRight.toString(),
        offsetSize: offsetSize.toString()
      });
      compressionPotential = compressionPotential.plus(offsetSize);
    }

    if (overlapLegs.length === 0) {
      return null;
    }

    const grossLeft = this.parseGrossAbsSize(left.grossAbsSize);
    const grossRight = this.parseGrossAbsSize(right.grossAbsSize);
    const exactOppositionScore = compressionPotential.div(Decimal.max(grossLeft, grossRight));
    const partialOverlapScore = compressionPotential.div(Decimal.min(grossLeft, grossRight));
    const orderedIds = [left.entityId, right.entityId].sort((a, b) => a.localeCompare(b));
    const from = orderedIds[0];
    const to = orderedIds[1];
    if (from === undefined || to === undefined) {
      throw new Error("invalid_edge_order");
    }

    return {
      from,
      to,
      overlapLegs,
      compressionPotential: compressionPotential.toString(),
      exactOppositionScore: exactOppositionScore.toString(),
      partialOverlapScore: partialOverlapScore.toString()
    };
  }

  private validateVectorEntries(vector: Record<string, string>): void {
    for (const [key, rawValue] of Object.entries(vector)) {
      if (key.trim().length === 0) {
        throw new Error("invalid_vector_entry");
      }
      this.parseSignedSize(rawValue);
    }
  }

  private parseSignedSize(value: string): InstanceType<typeof Decimal> {
    try {
      const parsed = new Decimal(value);
      if (!parsed.isFinite()) {
        throw new Error("invalid_signed_size");
      }
      return parsed;
    } catch {
      throw new Error("invalid_signed_size");
    }
  }

  private parseGrossAbsSize(value: string): InstanceType<typeof Decimal> {
    try {
      const parsed = new Decimal(value);
      if (!parsed.isFinite() || parsed.lte(0)) {
        throw new Error("invalid_gross_abs_size");
      }
      return parsed;
    } catch {
      throw new Error("invalid_gross_abs_size");
    }
  }
}
