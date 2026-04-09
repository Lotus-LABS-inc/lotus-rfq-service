import type { CanonicalGraphSnapshot } from "../repositories/canonical-graph.repository.js";
import { CanonicalCompatibilityRepository } from "../repositories/canonical-compatibility.repository.js";
import { CompatibilityVersionRepository } from "../repositories/compatibility-version.repository.js";
import {
    DEFAULT_COMPATIBILITY_MODEL_VERSION,
    DEFAULT_COMPATIBILITY_RULESET_VERSION
} from "./compatibility-versioning.js";
import { InterpretedContractBuilder } from "./interpreted-contract-builder.js";
import { CompatibilityDecisionBuilder } from "./compatibility-decision-builder.js";

export interface CanonicalCompatibilityProjectorConfig {
    rulesetVersion?: string;
    modelVersion?: string;
}

export class CanonicalCompatibilityProjector {
    private readonly interpretedContractBuilder = new InterpretedContractBuilder();
    private readonly decisionBuilder = new CompatibilityDecisionBuilder();
    private readonly rulesetVersion: string;
    private readonly modelVersion: string;

    public constructor(
        private readonly repository: CanonicalCompatibilityRepository,
        private readonly versionRepository: CompatibilityVersionRepository,
        config: CanonicalCompatibilityProjectorConfig = {}
    ) {
        this.rulesetVersion = config.rulesetVersion ?? DEFAULT_COMPATIBILITY_RULESET_VERSION;
        this.modelVersion = config.modelVersion ?? DEFAULT_COMPATIBILITY_MODEL_VERSION;
    }

    public async persistSnapshot(snapshot: CanonicalGraphSnapshot): Promise<void> {
        const profileMap = new Map(snapshot.venueMarketProfiles.map((profile) => [profile.id, profile]));
        const fingerprintMap = new Map(snapshot.propositionFingerprints.map((fingerprint) => [fingerprint.venueMarketProfileId, fingerprint]));
        const resolutionMap = new Map(snapshot.resolutionProfiles.map((profile) => [profile.venueMarketProfileId, profile]));
        const settlementMap = new Map(snapshot.settlementProfiles.map((profile) => [profile.venueMarketProfileId, profile]));
        const interpretedContracts = new Map<string, ReturnType<InterpretedContractBuilder["build"]>>();

        for (const market of snapshot.venueMarketProfiles) {
            const fingerprint = fingerprintMap.get(market.id);
            const resolutionProfile = resolutionMap.get(market.id);
            const settlementProfile = settlementMap.get(market.id);
            if (!fingerprint || !resolutionProfile || !settlementProfile) {
                continue;
            }
            const contract = this.interpretedContractBuilder.build({
                market,
                fingerprint,
                resolutionProfile,
                settlementProfile
            });
            const persistedId = await this.repository.upsertInterpretedContract(contract);
            interpretedContracts.set(market.id, {
                ...contract,
                id: persistedId
            });
        }

        for (const edge of snapshot.compatibilityEdges) {
            const version = await this.versionRepository.upsert({
                scoringVersion: edge.scoringVersion,
                rulesetVersion: this.rulesetVersion,
                modelVersion: this.modelVersion
            });
            const leftContract = interpretedContracts.get(edge.marketAProfileId);
            const rightContract = interpretedContracts.get(edge.marketBProfileId);
            if (!leftContract || !rightContract) {
                continue;
            }
            const decision = this.decisionBuilder.build({
                canonicalEventId: edge.canonicalEventId,
                interpretedContractA: leftContract,
                interpretedContractB: rightContract,
                compatibilityEdge: edge,
                compatibilityVersionId: version.id
            });
            await this.repository.upsertCompatibilityDecision(decision);
        }
    }
}
