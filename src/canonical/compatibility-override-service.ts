import type { CompatibilityDecision } from "./compatibility-decision.js";
import type { CompatibilityClass } from "./canonicalization-types.js";
import { CanonicalCompatibilityRepository } from "../repositories/canonical-compatibility.repository.js";
import {
    CompatibilityOverrideRepository,
    type CompatibilityOverrideRecord
} from "../repositories/compatibility-override.repository.js";

export class CompatibilityOverrideServiceError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "CompatibilityOverrideServiceError";
    }
}

export interface CreateCompatibilityOverrideRequest {
    targetDecisionId: string;
    forcedCompatibilityClass: CompatibilityClass;
    reviewerIdentity: string;
    reason: string;
    evidencePayload?: Record<string, unknown>;
    expiresAt?: Date | null;
    overrideVersion: string;
}

export interface EffectiveCompatibilityDecision {
    baseDecision: CompatibilityDecision;
    effectiveClass: CompatibilityClass;
    activeOverride: CompatibilityOverrideRecord | null;
    overrideAmbiguous: boolean;
}

export class CompatibilityOverrideService {
    public constructor(
        private readonly decisionRepository: CanonicalCompatibilityRepository,
        private readonly overrideRepository: CompatibilityOverrideRepository
    ) {}

    public async createOverride(input: CreateCompatibilityOverrideRequest): Promise<CompatibilityOverrideRecord> {
        const decision = await this.decisionRepository.getCompatibilityDecisionById(input.targetDecisionId);
        if (!decision) {
            throw new CompatibilityOverrideServiceError(`Compatibility decision ${input.targetDecisionId} was not found.`);
        }

        const override = await this.overrideRepository.create({
            targetDecisionId: input.targetDecisionId,
            forcedCompatibilityClass: input.forcedCompatibilityClass,
            reviewerIdentity: input.reviewerIdentity,
            reason: input.reason,
            overrideVersion: input.overrideVersion,
            ...(input.evidencePayload ? { evidencePayload: input.evidencePayload } : {}),
            ...(input.expiresAt ? { expiresAt: input.expiresAt } : {})
        });
        await this.overrideRepository.appendAuditEvent(override.id, "created", input.reviewerIdentity, {
            targetDecisionId: input.targetDecisionId,
            forcedCompatibilityClass: input.forcedCompatibilityClass,
            reason: input.reason
        });
        return override;
    }

    public async deactivateOverride(overrideId: string, reviewerIdentity: string): Promise<CompatibilityOverrideRecord | null> {
        const override = await this.overrideRepository.deactivate(overrideId);
        if (override) {
            await this.overrideRepository.appendAuditEvent(override.id, "deactivated", reviewerIdentity, {});
        }
        return override;
    }

    public async listActiveOverrides(): Promise<readonly CompatibilityOverrideRecord[]> {
        return this.overrideRepository.listActive();
    }

    public async listOverrideHistory(overrideId: string): Promise<readonly Record<string, unknown>[]> {
        return this.overrideRepository.listAuditHistory(overrideId);
    }

    public async resolveEffectiveDecision(decisionId: string): Promise<EffectiveCompatibilityDecision> {
        const decision = await this.decisionRepository.getCompatibilityDecisionById(decisionId);
        if (!decision) {
            throw new CompatibilityOverrideServiceError(`Compatibility decision ${decisionId} was not found.`);
        }

        const activeOverrides = await this.overrideRepository.listActiveByDecision(decisionId);
        const distinctForcedClasses = new Set(activeOverrides.map((override) => override.forcedCompatibilityClass));
        if (distinctForcedClasses.size > 1) {
            return {
                baseDecision: decision,
                effectiveClass: "DO_NOT_POOL",
                activeOverride: null,
                overrideAmbiguous: true
            };
        }

        const activeOverride = activeOverrides[0] ?? null;
        return {
            baseDecision: decision,
            effectiveClass: activeOverride?.forcedCompatibilityClass ?? decision.compatibilityClass,
            activeOverride,
            overrideAmbiguous: false
        };
    }
}
