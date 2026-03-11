import Decimal from "decimal.js";
import type {
    NormalizedResolutionProfile,
    ResolutionFactorComparison,
    ResolutionFactorComparisonResult
} from "./resolution-risk.types.js";

type ComparisonCode =
    | "canonical_event_mismatch"
    | "invalid_resolution_profile"
    | "invalid_outcome_schema"
    | "invalid_numeric_resolution_profile";

export class ResolutionPairComparisonError extends Error {
    public readonly code: ComparisonCode;

    public constructor(code: ComparisonCode) {
        super(code);
        this.name = "ResolutionPairComparisonError";
        this.code = code;
    }
}

export interface IResolutionPairComparator {
    compare(
        profileA: NormalizedResolutionProfile,
        profileB: NormalizedResolutionProfile
    ): ResolutionFactorComparisonResult;
}

export class ResolutionPairComparator implements IResolutionPairComparator {
    public compare(
        profileA: NormalizedResolutionProfile,
        profileB: NormalizedResolutionProfile
    ): ResolutionFactorComparisonResult {
        this.validateProfiles(profileA, profileB);

        return {
            oracleMismatch: this.compareOracle(profileA, profileB),
            ruleMismatch: this.compareRules(profileA, profileB),
            wordingAmbiguity: this.compareWording(profileA, profileB),
            disputeWindowMismatch: this.compareOptionalHours(
                profileA.disputeWindowHours,
                profileB.disputeWindowHours,
                "dispute window"
            ),
            settlementLagMismatch: this.compareOptionalHours(
                profileA.settlementLagHours,
                profileB.settlementLagHours,
                "settlement lag"
            ),
            structuralMismatch: this.compareStructure(profileA, profileB),
            historicalDivergence: this.compareHistoricalDivergence(profileA, profileB)
        };
    }

    private validateProfiles(
        profileA: NormalizedResolutionProfile,
        profileB: NormalizedResolutionProfile
    ): void {
        if (profileA.canonicalEventId !== profileB.canonicalEventId) {
            throw new ResolutionPairComparisonError("canonical_event_mismatch");
        }

        this.requireString(profileA.oracleType);
        this.requireString(profileB.oracleType);
        this.requireString(profileA.resolutionAuthorityType);
        this.requireString(profileB.resolutionAuthorityType);
        this.requireString(profileA.primaryResolutionText);
        this.requireString(profileB.primaryResolutionText);
        this.requireString(profileA.marketType);
        this.requireString(profileB.marketType);
        this.canonicalizeOutcomeSchema(profileA.outcomeSchema);
        this.canonicalizeOutcomeSchema(profileB.outcomeSchema);
        this.parseOptionalDecimal(profileA.disputeWindowHours);
        this.parseOptionalDecimal(profileB.disputeWindowHours);
        this.parseOptionalDecimal(profileA.settlementLagHours);
        this.parseOptionalDecimal(profileB.settlementLagHours);
        this.parseOptionalDecimal(profileA.historicalDivergenceRate);
        this.parseOptionalDecimal(profileB.historicalDivergenceRate);
    }

    private compareOracle(
        profileA: NormalizedResolutionProfile,
        profileB: NormalizedResolutionProfile
    ): ResolutionFactorComparison {
        const typeA = this.normalizeText(profileA.oracleType ?? "");
        const typeB = this.normalizeText(profileB.oracleType ?? "");
        const nameA = profileA.oracleName ? this.normalizeText(profileA.oracleName) : null;
        const nameB = profileB.oracleName ? this.normalizeText(profileB.oracleName) : null;

        if (typeA !== typeB) {
            return this.makeComparison(1, 1, "oracle type differs");
        }

        if (nameA === nameB && nameA !== null) {
            return this.makeComparison(0, 1, "oracle type and name match");
        }

        if (nameA === null && nameB === null) {
            return this.makeComparison(0.5, 0.5, "oracle names are missing; compared oracle type only");
        }

        if (nameA === null || nameB === null) {
            return this.makeComparison(0.5, 0.75, "one oracle name is missing");
        }

        return this.makeComparison(0.5, 1, "oracle type matches but oracle name differs");
    }

    private compareRules(
        profileA: NormalizedResolutionProfile,
        profileB: NormalizedResolutionProfile
    ): ResolutionFactorComparison {
        const authorityA = this.normalizeText(profileA.resolutionAuthorityType ?? "");
        const authorityB = this.normalizeText(profileB.resolutionAuthorityType ?? "");

        if (authorityA !== authorityB) {
            return this.makeComparison(1, 1, "resolution authority differs");
        }

        return this.compareRuleText(profileA.supplementalRulesText ?? null, profileB.supplementalRulesText ?? null);
    }

    private compareWording(
        profileA: NormalizedResolutionProfile,
        profileB: NormalizedResolutionProfile
    ): ResolutionFactorComparison {
        const normalizedA = this.normalizeText(profileA.primaryResolutionText ?? "");
        const normalizedB = this.normalizeText(profileB.primaryResolutionText ?? "");

        if (normalizedA === normalizedB) {
            return this.makeComparison(0, 1, "primary resolution wording matches");
        }

        const overlap = this.computeTokenOverlap(
            this.tokenizeText(profileA.primaryResolutionText ?? ""),
            this.tokenizeText(profileB.primaryResolutionText ?? "")
        );

        if (overlap >= 0.8) {
            return this.makeComparison(0, 1, "primary resolution wording is effectively identical");
        }

        if (overlap >= 0.4) {
            return this.makeComparison(0.5, 1, "primary resolution wording partially overlaps");
        }

        return this.makeComparison(1, 1, "primary resolution wording materially diverges");
    }

    private compareOptionalHours(
        left: string | null | undefined,
        right: string | null | undefined,
        label: string
    ): ResolutionFactorComparison {
        const leftValue = this.parseOptionalDecimal(left);
        const rightValue = this.parseOptionalDecimal(right);

        if (leftValue === null || rightValue === null) {
            return this.makeComparison(0, 0.4, `${label} metadata missing on one or both profiles`);
        }

        const difference = leftValue.minus(rightValue).abs();

        if (difference.eq(0)) {
            return this.makeComparison(0, 1, `${label} matches`);
        }

        if (difference.lte(24)) {
            return this.makeComparison(0.5, 1, `${label} differs within 24 hours`);
        }

        return this.makeComparison(1, 1, `${label} differs by more than 24 hours`);
    }

    private compareStructure(
        profileA: NormalizedResolutionProfile,
        profileB: NormalizedResolutionProfile
    ): ResolutionFactorComparison {
        const marketTypeA = this.normalizeText(profileA.marketType ?? "");
        const marketTypeB = this.normalizeText(profileB.marketType ?? "");

        if (marketTypeA !== marketTypeB) {
            return this.makeComparison(1, 1, "market type differs");
        }

        const schemaA = this.canonicalizeOutcomeSchema(profileA.outcomeSchema);
        const schemaB = this.canonicalizeOutcomeSchema(profileB.outcomeSchema);

        if (schemaA === schemaB) {
            return this.makeComparison(0, 1, "market type and outcome schema match");
        }

        return this.makeComparison(0.5, 1, "market type matches but outcome schema differs");
    }

    private compareHistoricalDivergence(
        profileA: NormalizedResolutionProfile,
        profileB: NormalizedResolutionProfile
    ): ResolutionFactorComparison {
        const leftValue = this.parseOptionalDecimal(profileA.historicalDivergenceRate);
        const rightValue = this.parseOptionalDecimal(profileB.historicalDivergenceRate);

        if (leftValue === null && rightValue === null) {
            return this.makeComparison(0, 0.3, "historical divergence is unavailable on both profiles");
        }

        const maxValue = leftValue === null
            ? rightValue
            : rightValue === null
                ? leftValue
                : Decimal.max(leftValue, rightValue);

        if (maxValue === null) {
            return this.makeComparison(0, 0.3, "historical divergence is unavailable on both profiles");
        }

        const confidence = leftValue === null || rightValue === null ? 0.7 : 1;

        if (maxValue.lt(0.01)) {
            return this.makeComparison(0, confidence, "historical divergence is below 1%");
        }

        if (maxValue.lt(0.05)) {
            return this.makeComparison(0.5, confidence, "historical divergence is between 1% and 5%");
        }

        return this.makeComparison(1, confidence, "historical divergence is 5% or higher");
    }

    private compareRuleText(left: string | null, right: string | null): ResolutionFactorComparison {
        if (left === null && right === null) {
            return this.makeComparison(0, 0.8, "supplemental rules are absent on both profiles");
        }

        if (left === null || right === null) {
            return this.makeComparison(0.5, 0.5, "supplemental rules are missing on one profile");
        }

        const normalizedLeft = this.normalizeText(left);
        const normalizedRight = this.normalizeText(right);

        if (normalizedLeft === normalizedRight) {
            return this.makeComparison(0, 1, "resolution authority and supplemental rules match");
        }

        const overlap = this.computeTokenOverlap(
            this.tokenizeText(left),
            this.tokenizeText(right)
        );

        if (overlap >= 0.8) {
            return this.makeComparison(0, 1, "supplemental rules are effectively identical");
        }

        if (overlap >= 0.4) {
            return this.makeComparison(0.5, 1, "supplemental rules partially overlap");
        }

        return this.makeComparison(0.5, 1, "supplemental rules materially differ");
    }

    private normalizeText(text: string): string {
        return text
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    private tokenizeText(text: string): readonly string[] {
        const normalized = this.normalizeText(text);
        if (normalized.length === 0) {
            return [];
        }

        return normalized
            .split(" ")
            .filter((token, index, tokens) => token.length > 0 && tokens.indexOf(token) === index)
            .sort((left, right) => left.localeCompare(right));
    }

    private computeTokenOverlap(left: readonly string[], right: readonly string[]): number {
        if (left.length === 0 || right.length === 0) {
            return 0;
        }

        const rightSet = new Set(right);
        const intersectionSize = left.filter((token) => rightSet.has(token)).length;
        const unionSize = new Set([...left, ...right]).size;

        return unionSize === 0 ? 0 : intersectionSize / unionSize;
    }

    private canonicalizeOutcomeSchema(schema: Record<string, unknown> | null | undefined): string {
        if (
            schema === null ||
            schema === undefined ||
            typeof schema !== "object" ||
            Array.isArray(schema)
        ) {
            throw new ResolutionPairComparisonError("invalid_outcome_schema");
        }

        return JSON.stringify(this.sortJsonValue(schema));
    }

    private sortJsonValue(value: unknown): unknown {
        if (Array.isArray(value)) {
            return value.map((entry) => this.sortJsonValue(entry));
        }

        if (value !== null && typeof value === "object") {
            const entries = Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, entry]) => [key, this.sortJsonValue(entry)]);

            return Object.fromEntries(entries);
        }

        return value;
    }

    private parseOptionalDecimal(value: string | null | undefined): InstanceType<typeof Decimal> | null {
        if (value === undefined || value === null) {
            return null;
        }

        try {
            const decimal = new Decimal(value);
            if (!decimal.isFinite() || decimal.isNegative()) {
                throw new ResolutionPairComparisonError("invalid_numeric_resolution_profile");
            }
            return decimal;
        } catch (error) {
            if (error instanceof ResolutionPairComparisonError) {
                throw error;
            }
            throw new ResolutionPairComparisonError("invalid_numeric_resolution_profile");
        }
    }

    private requireString(value: string | null | undefined): void {
        if (typeof value !== "string" || value.trim().length === 0) {
            throw new ResolutionPairComparisonError("invalid_resolution_profile");
        }
    }

    private makeComparison(
        score: number,
        confidence: number,
        reason?: string
    ): ResolutionFactorComparison {
        return reason ? { score, confidence, reason } : { score, confidence };
    }
}
