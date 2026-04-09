import type { PairShadowObservation } from "./pair-shadow-observation-types.js";
import type { PairShadowRuntimeHooks } from "./pair-shadow-runtime-hooks.js";
import type { StagingShadowWindowConfig } from "./staging-shadow-window-config.js";

export interface PairShadowStagingReplayResult {
  stagingWindowId: string;
  observations: readonly PairShadowObservation[];
}

export class PairShadowStagingReplayDriver {
  public constructor(private readonly runtimeHooks: Pick<PairShadowRuntimeHooks, "recordReplayHarnessObservation">) {}

  public async run(config: StagingShadowWindowConfig): Promise<PairShadowStagingReplayResult> {
    const stagingWindowId = `staging-shadow-${Date.now()}`;
    const observations: PairShadowObservation[] = [];

    for (const route of config.routes) {
      if (route.canaryCountableScopeKeys.length === 0) {
        continue;
      }
      for (let index = 0; index < route.sampleTarget; index += 1) {
        const canonicalMarketId = route.canaryCountableScopeKeys[index % route.canaryCountableScopeKeys.length]!;
        observations.push(await this.runtimeHooks.recordReplayHarnessObservation({
          routeClass: route.routeClass,
          canonicalMarketId,
          stagingWindowId,
          sampleIndex: index + 1
        }));
      }
    }

    return {
      stagingWindowId,
      observations
    };
  }
}
