export interface CompatibilityVersionRecord {
    id: string;
    scoringVersion: string;
    rulesetVersion: string;
    modelVersion: string;
    overrideVersion: string | null;
    createdAt: Date;
}

export interface CompatibilityVersionDescriptor {
    scoringVersion: string;
    rulesetVersion: string;
    modelVersion: string;
    overrideVersion?: string | null;
}

export const DEFAULT_COMPATIBILITY_RULESET_VERSION = "compatibility-ruleset-v1";
export const DEFAULT_COMPATIBILITY_MODEL_VERSION = "compatibility-model-v1";
