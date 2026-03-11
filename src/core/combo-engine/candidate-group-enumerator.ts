import Decimal from "decimal.js";

import type {
  CandidateGroup,
  CandidateGroupEnumeratorConfig,
  CandidateGroupResidual,
  OverlapGraph,
  OverlapGraphNode
} from "./types.js";

const DEFAULT_CONFIG: CandidateGroupEnumeratorConfig = {
  maxParticipants: 4,
  maxUniqueLegs: 6,
  stpMode: "CANCEL_NEWEST"
};

export interface ICandidateGroupEnumerator {
  enumerate(
    graph: OverlapGraph,
    config?: Partial<CandidateGroupEnumeratorConfig>
  ): CandidateGroup[];
}

export class CandidateGroupEnumerator implements ICandidateGroupEnumerator {
  public enumerate(
    graph: OverlapGraph,
    config: Partial<CandidateGroupEnumeratorConfig> = {}
  ): CandidateGroup[] {
    this.validateGraph(graph);

    const resolvedConfig: CandidateGroupEnumeratorConfig = {
      ...DEFAULT_CONFIG,
      ...config
    };

    if (resolvedConfig.maxParticipants <= 0) {
      throw new Error("invalid_max_participants");
    }

    if (resolvedConfig.maxUniqueLegs <= 0) {
      throw new Error("invalid_max_unique_legs");
    }

    const sortedNodes = [...graph.nodes].sort((left, right) => left.entityId.localeCompare(right.entityId));
    const adjacency = this.buildAdjacency(graph);
    const emitted = new Set<string>();
    const groups: CandidateGroup[] = [];

    for (const node of sortedNodes) {
      this.expandGroup(
        sortedNodes,
        adjacency,
        [node.entityId],
        node.entityId,
        resolvedConfig,
        emitted,
        groups
      );
    }

    groups.sort((left, right) => {
      const compressionDiff = new Decimal(right.estimatedCompressionScore).cmp(left.estimatedCompressionScore);
      if (compressionDiff !== 0) {
        return compressionDiff;
      }

      const exactnessDiff = new Decimal(right.exactnessScore).cmp(left.exactnessScore);
      if (exactnessDiff !== 0) {
        return exactnessDiff;
      }

      if (left.participantIds.length !== right.participantIds.length) {
        return left.participantIds.length - right.participantIds.length;
      }

      return left.participantIds.join("|").localeCompare(right.participantIds.join("|"));
    });

    return groups;
  }

  private expandGroup(
    sortedNodes: readonly OverlapGraphNode[],
    adjacency: Map<string, Set<string>>,
    currentIds: string[],
    rootId: string,
    config: CandidateGroupEnumeratorConfig,
    emitted: Set<string>,
    groups: CandidateGroup[]
  ): void {
    const canonicalIds = [...currentIds].sort((left, right) => left.localeCompare(right));
    const signature = canonicalIds.join("|");

    if (!emitted.has(signature)) {
      const maybeGroup = this.tryBuildGroup(sortedNodes, canonicalIds, config);
      if (maybeGroup !== null) {
        emitted.add(signature);
        groups.push(maybeGroup);
      }
    }

    if (canonicalIds.length >= config.maxParticipants) {
      return;
    }

    const currentSet = new Set(canonicalIds);
    const frontier = new Set<string>();
    for (const participantId of canonicalIds) {
      for (const neighborId of adjacency.get(participantId) ?? []) {
        if (!currentSet.has(neighborId) && neighborId.localeCompare(rootId) >= 0) {
          frontier.add(neighborId);
        }
      }
    }

    for (const neighborId of [...frontier].sort((left, right) => left.localeCompare(right))) {
      this.expandGroup(
        sortedNodes,
        adjacency,
        [...canonicalIds, neighborId],
        rootId,
        config,
        emitted,
        groups
      );
    }
  }

  private tryBuildGroup(
    sortedNodes: readonly OverlapGraphNode[],
    participantIds: readonly string[],
    config: CandidateGroupEnumeratorConfig
  ): CandidateGroup | null {
    if (participantIds.length < 2) {
      return null;
    }

    const nodes = participantIds.map((id) => sortedNodes.find((node) => node.entityId === id));
    if (nodes.some((node) => node === undefined)) {
      throw new Error("ambiguous_group_nodes");
    }

    const uniqueLegs = [...new Set(nodes.flatMap((node) => Object.keys(node!.vector)))].sort((a, b) =>
      a.localeCompare(b)
    );
    if (uniqueLegs.length > config.maxUniqueLegs) {
      return null;
    }

    if (config.stpMode !== "NONE" && this.hasForbiddenSelfTrade(nodes as OverlapGraphNode[])) {
      return null;
    }

    const grossTotal = nodes.reduce(
      (sum, node) => sum.plus(this.parsePositive(node!.grossAbsSize, "invalid_gross_abs_size")),
      new Decimal(0)
    );

    const residualMap = new Map<string, InstanceType<typeof Decimal>>();
    for (const node of nodes as OverlapGraphNode[]) {
      for (const [key, rawValue] of Object.entries(node.vector)) {
        const parsed = this.parseSigned(rawValue);
        residualMap.set(key, (residualMap.get(key) ?? new Decimal(0)).plus(parsed));
      }
    }

    const residualAfterNetting: CandidateGroupResidual[] = [...residualMap.entries()]
      .filter(([, value]) => !value.isZero())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([key, value]) => ({
        key,
        signedResidual: value.toString()
      }));

    const residualAbsTotal = residualAfterNetting.reduce(
      (sum, residual) => sum.plus(this.parsePositive(new Decimal(residual.signedResidual).abs().toString(), "invalid_residual")),
      new Decimal(0)
    );

    const estimatedCompressionScore = grossTotal.isZero()
      ? new Decimal(0)
      : new Decimal(1).minus(residualAbsTotal.div(grossTotal));

    const exactnessScore =
      residualAfterNetting.length === 0
        ? new Decimal(1)
        : new Decimal(1).minus(new Decimal(residualAfterNetting.length).div(uniqueLegs.length));

    return {
      participantIds,
      uniqueLegs,
      estimatedCompressionScore: estimatedCompressionScore.toString(),
      residualAfterNetting,
      exactnessScore: exactnessScore.toString()
    };
  }

  private hasForbiddenSelfTrade(nodes: readonly OverlapGraphNode[]): boolean {
    const byUser = new Map<string, OverlapGraphNode[]>();
    for (const node of nodes) {
      const bucket = byUser.get(node.userId) ?? [];
      bucket.push(node);
      byUser.set(node.userId, bucket);
    }

    for (const userNodes of byUser.values()) {
      if (userNodes.length < 2) {
        continue;
      }

      const vectorByKey = new Map<string, InstanceType<typeof Decimal>[]>();
      for (const node of userNodes) {
        for (const [key, rawValue] of Object.entries(node.vector)) {
          const parsed = this.parseSigned(rawValue);
          const values = vectorByKey.get(key) ?? [];
          values.push(parsed);
          vectorByKey.set(key, values);
        }
      }

      for (const values of vectorByKey.values()) {
        const hasPositive = values.some((value) => value.gt(0));
        const hasNegative = values.some((value) => value.lt(0));
        if (hasPositive && hasNegative) {
          return true;
        }
      }
    }

    return false;
  }

  private buildAdjacency(graph: OverlapGraph): Map<string, Set<string>> {
    const adjacency = new Map<string, Set<string>>();

    for (const node of graph.nodes) {
      adjacency.set(node.entityId, new Set<string>());
    }

    for (const edge of graph.edges) {
      adjacency.get(edge.from)?.add(edge.to);
      adjacency.get(edge.to)?.add(edge.from);
    }

    return adjacency;
  }

  private validateGraph(graph: OverlapGraph): void {
    if (graph.nodes.length === 0) {
      throw new Error("empty_overlap_graph");
    }

    const bucket = graph.nodes[0]?.compatibilityBucket;
    if (!bucket) {
      throw new Error("invalid_overlap_graph_bucket");
    }

    const seen = new Set<string>();
    for (const node of graph.nodes) {
      if (node.compatibilityBucket !== bucket) {
        throw new Error("overlap_graph_bucket_mismatch");
      }
      if (seen.has(node.entityId)) {
        throw new Error("duplicate_overlap_graph_node");
      }
      seen.add(node.entityId);

      for (const rawValue of Object.values(node.vector)) {
        this.parseSigned(rawValue);
      }
    }
  }

  private parseSigned(value: string): InstanceType<typeof Decimal> {
    try {
      const parsed = new Decimal(value);
      if (!parsed.isFinite()) {
        throw new Error("invalid_group_vector");
      }
      return parsed;
    } catch {
      throw new Error("invalid_group_vector");
    }
  }

  private parsePositive(value: string, errorCode: string): InstanceType<typeof Decimal> {
    try {
      const parsed = new Decimal(value);
      if (!parsed.isFinite() || parsed.lt(0)) {
        throw new Error(errorCode);
      }
      return parsed;
    } catch {
      throw new Error(errorCode);
    }
  }
}
