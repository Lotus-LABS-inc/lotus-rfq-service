import type { PairEdgeRepository } from "../../repositories/pair-edge.repository.js";
import type { PairEdgeApprovalState } from "../../matching/match-labels.js";
import type { PairEdgeRecord, PairEdgeReviewAction } from "../../matching/matching-types.js";

export class PairMatchReviewServiceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PairMatchReviewServiceError";
  }
}

export interface PairMatchReviewDetail {
  edge: PairEdgeRecord;
  history: readonly PairEdgeReviewAction[];
}

export class PairMatchReviewService {
  public constructor(private readonly repository: PairEdgeRepository) {}

  public async listEdges(filters: {
    approvalState?: PairEdgeApprovalState;
    label?: PairEdgeRecord["label"];
    canonicalEventId?: string;
  } = {}): Promise<readonly PairEdgeRecord[]> {
    return this.repository.listPairEdges(filters);
  }

  public async listPendingReview(): Promise<readonly PairEdgeRecord[]> {
    return this.repository.listPairEdges({ approvalState: "pendingReview" });
  }

  public async getEdge(edgeId: string): Promise<PairMatchReviewDetail> {
    const edge = await this.repository.getPairEdge(edgeId);
    if (!edge) {
      throw new PairMatchReviewServiceError(`Pair edge ${edgeId} not found.`);
    }
    const history = await this.repository.listReviewActions(edgeId);
    return { edge, history };
  }

  public async approveEdge(edgeId: string, reviewer: string, reason: string): Promise<PairMatchReviewDetail> {
    const edge = await this.repository.updatePairEdgeReviewState({
      pairEdgeId: edgeId,
      approvalState: "approved",
      reviewer,
      reviewReason: reason
    });
    if (!edge) {
      throw new PairMatchReviewServiceError(`Pair edge ${edgeId} not found.`);
    }
    await this.repository.recordReviewAction({
      pairEdgeId: edgeId,
      action: "APPROVE",
      reviewer,
      reason
    });
    return this.getEdge(edgeId);
  }

  public async rejectEdge(edgeId: string, reviewer: string, reason: string): Promise<PairMatchReviewDetail> {
    const edge = await this.repository.updatePairEdgeReviewState({
      pairEdgeId: edgeId,
      approvalState: "rejected",
      reviewer,
      reviewReason: reason
    });
    if (!edge) {
      throw new PairMatchReviewServiceError(`Pair edge ${edgeId} not found.`);
    }
    await this.repository.recordReviewAction({
      pairEdgeId: edgeId,
      action: "REJECT",
      reviewer,
      reason
    });
    return this.getEdge(edgeId);
  }
}
