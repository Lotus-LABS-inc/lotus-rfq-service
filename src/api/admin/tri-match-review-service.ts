import { deriveTriCandidates } from "../../matching/tri-deriver.js";
import type { TriCandidate } from "../../matching/tri-deriver.js";
import type { PairEdgeRecord } from "../../matching/matching-types.js";
import type { PairEdgeRepository } from "../../repositories/pair-edge.repository.js";

export class TriMatchReviewServiceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TriMatchReviewServiceError";
  }
}

export interface TriCandidateDetail {
  candidate: TriCandidate;
  constituentEdges: readonly PairEdgeRecord[];
}

export interface TriMatchReviewSummary {
  total: number;
  eligible: number;
  blocked: number;
  blockerReasonCounts: Record<string, number>;
}

export class TriMatchReviewService {
  public constructor(private readonly repository: PairEdgeRepository) {}

  private async deriveAll(): Promise<readonly TriCandidate[]> {
    const edges = await this.repository.listPairEdges({});
    return deriveTriCandidates(edges);
  }

  public async listCandidates(): Promise<readonly TriCandidate[]> {
    return this.deriveAll();
  }

  public async listEligible(): Promise<readonly TriCandidate[]> {
    const candidates = await this.deriveAll();
    return candidates.filter((c) => c.exactSafe);
  }

  public async listBlocked(): Promise<readonly TriCandidate[]> {
    const candidates = await this.deriveAll();
    return candidates.filter((c) => !c.exactSafe);
  }

  public async getCandidate(triCandidateId: string): Promise<TriCandidateDetail> {
    const [candidates, allEdges] = await Promise.all([
      this.deriveAll(),
      this.repository.listPairEdges({})
    ]);
    const candidate = candidates.find((c) => c.triCandidateId === triCandidateId);
    if (!candidate) {
      throw new TriMatchReviewServiceError(`Tri candidate ${triCandidateId} not found.`);
    }
    const constituentEdges = allEdges.filter((edge) =>
      candidate.constituentPairEdgeIds.includes(edge.id)
    );
    return { candidate, constituentEdges };
  }

  public async getSummary(): Promise<TriMatchReviewSummary> {
    const candidates = await this.deriveAll();
    const eligible = candidates.filter((c) => c.exactSafe).length;
    const blocked = candidates.length - eligible;
    const blockerReasonCounts: Record<string, number> = {};
    for (const candidate of candidates) {
      for (const reason of candidate.blockerReasons) {
        blockerReasonCounts[reason] = (blockerReasonCounts[reason] ?? 0) + 1;
      }
    }
    return { total: candidates.length, eligible, blocked, blockerReasonCounts };
  }
}
