import type { PairShadowObservationRepository } from "../shadow/pair-shadow-observation-repository.js";
import type { CreatePairPromotionDecisionInput, PairPromotionDecisionRecord } from "../shadow/pair-shadow-observation-types.js";

export class PairPromotionDecisionRepository {
  public constructor(
    private readonly repository: Pick<PairShadowObservationRepository, "createPromotionDecision" | "listPromotionDecisions">
  ) {}

  public async create(input: CreatePairPromotionDecisionInput): Promise<PairPromotionDecisionRecord> {
    return this.repository.createPromotionDecision(input);
  }

  public async list(routeClass?: PairPromotionDecisionRecord["routeClass"]): Promise<readonly PairPromotionDecisionRecord[]> {
    return this.repository.listPromotionDecisions(routeClass);
  }
}
