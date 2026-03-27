import type {
  PredictEnvironment,
  PredictFallbackAvailability,
  PredictFallbackSnapshot,
  PredictSimulationProvenance
} from "./predict-types.js";

export interface PredictHistoricalFallbackLoader {
  load(input: {
    environment: PredictEnvironment;
    marketId: string;
    start: Date;
    end: Date;
  }): Promise<readonly PredictFallbackSnapshot[]>;
}

export interface PredictHistoricalFallbackConfig {
  documentedAvailability: boolean;
  loader?: PredictHistoricalFallbackLoader;
}

export class PredictHistoricalFallback {
  public constructor(private readonly config: PredictHistoricalFallbackConfig) {}

  public getAvailability(): PredictFallbackAvailability {
    if (!this.config.documentedAvailability) {
      return {
        documentedAvailability: false,
        available: false,
        reason: "predict_predexon_fallback_not_documented"
      };
    }

    return {
      documentedAvailability: true,
      available: this.config.loader !== undefined,
      reason: this.config.loader ? null : "predict_predexon_fallback_loader_missing"
    };
  }

  public async load(input: {
    environment: PredictEnvironment;
    marketId: string;
    start: Date;
    end: Date;
  }): Promise<readonly PredictFallbackSnapshot[]> {
    const availability = this.getAvailability();
    if (!availability.available || !this.config.loader) {
      return [];
    }
    const snapshots = await this.config.loader.load(input);
    return snapshots.map((snapshot) => ({
      ...snapshot,
      provenance: this.normalizeProvenance(snapshot.provenance)
    }));
  }

  private normalizeProvenance(provenance: PredictSimulationProvenance): PredictSimulationProvenance {
    if (provenance === "NATIVE_PREDICT") {
      return "PREDExON_FALLBACK";
    }
    return provenance;
  }
}
