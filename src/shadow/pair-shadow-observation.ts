import { PairShadowObservationRepository } from "./pair-shadow-observation-repository.js";
import type { CreatePairShadowObservationInput, PairShadowObservation } from "./pair-shadow-observation-types.js";

export class PairShadowObservationService {
  public constructor(private readonly repository: Pick<PairShadowObservationRepository, "createObservation" | "listObservations">) {}

  public async recordRuntimeObservation(
    input: Omit<CreatePairShadowObservationInput, "sourceKind" | "reproducibilityHash">
  ): Promise<PairShadowObservation> {
    const reproducibilityHash = PairShadowObservationRepository.buildReproducibilityHash({
      routeClass: input.routeClass,
      scopeKey: input.scopeKey,
      canonicalEventId: input.canonicalEventId,
      canonicalMarketId: input.canonicalMarketId,
      decisionTimestamp: input.decisionTimestamp,
      chosenShadowRoute: input.chosenShadowRoute,
      baselineComparator: input.baselineComparator,
      metadata: input.metadata
    });
    return this.repository.createObservation({
      ...input,
      sourceKind: "RUNTIME_OBSERVATION",
      reproducibilityHash
    });
  }

  public async list(routeClass?: PairShadowObservation["routeClass"]): Promise<readonly PairShadowObservation[]> {
    return this.repository.listObservations(routeClass);
  }
}
