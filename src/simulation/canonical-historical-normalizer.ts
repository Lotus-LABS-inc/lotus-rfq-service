import type { Logger } from "pino"

import type {
  CreateHistoricalMarketStateInput,
  HistoricalCanonicalCategory
} from "../core/historical-simulation/historical-simulation.types.js"
import type {
  NormalizedResolutionProfile,
  ResolutionRiskAssessment
} from "../core/rfq-engine/resolution-risk.types.js"

export type CanonicalHistoricalCategory = HistoricalCanonicalCategory
export type CanonicalHistoricalNormalizationMode = "singleVenue" | "pooledSimulation"

export interface CanonicalHistoricalMapping {
  canonicalEventId: string;
  canonicalCategory: CanonicalHistoricalCategory;
  canonicalMarketId?: string;
  resolutionProfileId?: string;
}

export interface CanonicalHistoricalMappingResolver {
  resolve(params: {
    venue: string;
    venueMarketId: string;
    sourceMarketMetadata?: Record<string, unknown>;
  }): Promise<readonly CanonicalHistoricalMapping[]>;
}

export interface CanonicalHistoricalResolutionRiskFreshness {
  profileCount: number;
  expectedPairCount: number;
  persistedPairCount: number;
  lastComputedAt: Date | null;
  latestProfileUpdatedAt: Date | null;
  isComplete: boolean;
  isStale: boolean;
  hasMixedVersions: boolean;
}

export interface CanonicalHistoricalResolutionRiskSnapshot {
  canonicalEventId: string;
  profiles: readonly NormalizedResolutionProfile[];
  assessments: readonly ResolutionRiskAssessment[];
  scoringVersion: string;
  freshness: CanonicalHistoricalResolutionRiskFreshness;
  safeEquivalentEligible: boolean;
  poolingReason: string;
}

export interface CanonicalHistoricalResolutionRiskProvider {
  getSnapshot(input: {
    canonicalEventId: string;
  }): Promise<CanonicalHistoricalResolutionRiskSnapshot | null>;
}

export interface CanonicalHistoricalNormalizeSource {
  state: CreateHistoricalMarketStateInput;
  sourceMarketMetadata?: Record<string, unknown>;
}

export interface CanonicalHistoricalNormalizeInput {
  mode: CanonicalHistoricalNormalizationMode;
  records: readonly CanonicalHistoricalNormalizeSource[];
  sliceIntervalMs?: number;
  requireResolutionRiskSnapshot?: boolean;
}

export interface CanonicalHistoricalNormalizedRecord {
  state: CreateHistoricalMarketStateInput;
  canonicalCategory: CanonicalHistoricalCategory;
  resolutionRiskSnapshot: CanonicalHistoricalResolutionRiskSnapshot | null;
  timelineSliceStart: Date;
  safeEquivalentEligible: boolean;
  mappingMetadata: CanonicalHistoricalMapping;
}

type CanonicalHistoricalNormalizerErrorCode =
  | "canonical_mapping_missing"
  | "canonical_mapping_ambiguous"
  | "mixed_canonical_event_group"
  | "resolution_risk_snapshot_missing"
  | "resolution_risk_snapshot_stale"
  | "resolution_risk_not_safe_equivalent"
  | "invalid_timeline_slice"

export class CanonicalHistoricalNormalizerError extends Error {
  public readonly code: CanonicalHistoricalNormalizerErrorCode

  public constructor(code: CanonicalHistoricalNormalizerErrorCode, message: string) {
    super(message)
    this.name = "CanonicalHistoricalNormalizerError"
    this.code = code
  }
}

interface ResolvedHistoricalSource {
  state: CreateHistoricalMarketStateInput;
  mapping: CanonicalHistoricalMapping;
  sourceMarketMetadata?: Record<string, unknown>;
}

const toTimelineSliceStart = (timestamp: Date, sliceIntervalMs?: number): Date => {
  if (sliceIntervalMs === undefined) {
    return new Date(timestamp)
  }

  if (!Number.isInteger(sliceIntervalMs) || sliceIntervalMs <= 0) {
    throw new CanonicalHistoricalNormalizerError(
      "invalid_timeline_slice",
      `sliceIntervalMs must be a positive integer. Received ${sliceIntervalMs}.`
    )
  }

  return new Date(Math.floor(timestamp.getTime() / sliceIntervalMs) * sliceIntervalMs)
}

const cloneStateWithCanonicalEventId = (
  state: CreateHistoricalMarketStateInput,
  canonicalEventId: string
): CreateHistoricalMarketStateInput => ({
  ...state,
  canonicalEventId,
  canonicalMarketId: state.canonicalMarketId ?? null,
  canonicalCategory: state.canonicalCategory ?? null,
  timestamp: new Date(state.timestamp),
  sourceTimestamp: new Date(state.sourceTimestamp)
})

const compareNormalizedRecords = (
  left: CanonicalHistoricalNormalizedRecord,
  right: CanonicalHistoricalNormalizedRecord
): number =>
  left.timelineSliceStart.getTime() - right.timelineSliceStart.getTime() ||
  left.state.canonicalEventId.localeCompare(right.state.canonicalEventId) ||
  left.state.venue.localeCompare(right.state.venue) ||
  left.state.venueMarketId.localeCompare(right.state.venueMarketId) ||
  left.state.sourceTimestamp.getTime() - right.state.sourceTimestamp.getTime()

const buildAssessmentKey = (profileAId: string, profileBId: string): string =>
  profileAId.localeCompare(profileBId) <= 0 ? `${profileAId}|${profileBId}` : `${profileBId}|${profileAId}`

const buildPairProfileIds = (resolved: readonly ResolvedHistoricalSource[]): readonly string[] => {
  const profileIds = resolved
    .map((record) => record.mapping.resolutionProfileId)
    .filter((value): value is string => value !== undefined)

  return [...new Set(profileIds)].sort((left, right) => left.localeCompare(right))
}

const findDistinctCanonicalEventIds = (resolved: readonly ResolvedHistoricalSource[]): readonly string[] =>
  [...new Set(resolved.map((record) => record.mapping.canonicalEventId))].sort((left, right) => left.localeCompare(right))

export interface CanonicalHistoricalNormalizerConfig {
  mappingResolver: CanonicalHistoricalMappingResolver;
  resolutionRiskProvider?: CanonicalHistoricalResolutionRiskProvider;
  logger?: Pick<Logger, "info" | "warn" | "error">;
}

export class CanonicalHistoricalNormalizer {
  private readonly logger: Pick<Logger, "info" | "warn" | "error"> | undefined

  public constructor(private readonly config: CanonicalHistoricalNormalizerConfig) {
    this.logger = config.logger
  }

  public async normalize(input: CanonicalHistoricalNormalizeInput): Promise<readonly CanonicalHistoricalNormalizedRecord[]> {
    const resolved = await this.resolveMappings(input.records)
    this.ensureSingleCanonicalEventWhenPooled(input.mode, resolved)

    const requireSnapshot = input.requireResolutionRiskSnapshot ?? input.mode === "pooledSimulation"
    const resolutionRiskSnapshot = await this.resolveResolutionRiskSnapshot(resolved, requireSnapshot)

    if (input.mode === "pooledSimulation") {
      this.ensurePooledSafeEquivalent(resolved, resolutionRiskSnapshot)
    }

    const safeEquivalentEligible = input.mode === "pooledSimulation"
      ? resolutionRiskSnapshot?.safeEquivalentEligible ?? false
      : resolutionRiskSnapshot?.safeEquivalentEligible ?? true

    const normalized = resolved
      .map((record) => ({
        state: {
          ...cloneStateWithCanonicalEventId(record.state, record.mapping.canonicalEventId),
          canonicalMarketId: record.mapping.canonicalMarketId ?? null,
          canonicalCategory: record.mapping.canonicalCategory
        },
        canonicalCategory: record.mapping.canonicalCategory,
        resolutionRiskSnapshot: resolutionRiskSnapshot ?? null,
        timelineSliceStart: toTimelineSliceStart(record.state.timestamp, input.sliceIntervalMs),
        safeEquivalentEligible,
        mappingMetadata: record.mapping
      }))
      .sort(compareNormalizedRecords)

    this.logger?.info(
      {
        mode: input.mode,
        recordCount: normalized.length,
        requireSnapshot,
        safeEquivalentEligible
      },
      "Normalized historical records into canonical simulation state."
    )

    return normalized
  }

  private async resolveMappings(
    records: readonly CanonicalHistoricalNormalizeSource[]
  ): Promise<readonly ResolvedHistoricalSource[]> {
    const resolved: ResolvedHistoricalSource[] = []

    for (const record of records) {
      const mappings = await this.config.mappingResolver.resolve({
        venue: record.state.venue,
        venueMarketId: record.state.venueMarketId,
        ...(record.sourceMarketMetadata !== undefined
          ? { sourceMarketMetadata: record.sourceMarketMetadata }
          : {})
      })

      if (mappings.length === 0) {
        throw new CanonicalHistoricalNormalizerError(
          "canonical_mapping_missing",
          `No canonical mapping found for ${record.state.venue}:${record.state.venueMarketId}.`
        )
      }

      if (mappings.length > 1) {
        throw new CanonicalHistoricalNormalizerError(
          "canonical_mapping_ambiguous",
          `Multiple canonical mappings found for ${record.state.venue}:${record.state.venueMarketId}.`
        )
      }

      resolved.push({
        state: record.state,
        mapping: mappings[0]!,
        ...(record.sourceMarketMetadata !== undefined
          ? { sourceMarketMetadata: record.sourceMarketMetadata }
          : {})
      })
    }

    return resolved
  }

  private ensureSingleCanonicalEventWhenPooled(
    mode: CanonicalHistoricalNormalizationMode,
    resolved: readonly ResolvedHistoricalSource[]
  ): void {
    if (mode !== "pooledSimulation") {
      return
    }

    const canonicalEventIds = findDistinctCanonicalEventIds(resolved)
    if (canonicalEventIds.length > 1) {
      throw new CanonicalHistoricalNormalizerError(
        "mixed_canonical_event_group",
        `Pooled simulation requires a single canonical event. Received ${canonicalEventIds.join(", ")}.`
      )
    }
  }

  private async resolveResolutionRiskSnapshot(
    resolved: readonly ResolvedHistoricalSource[],
    requireSnapshot: boolean
  ): Promise<CanonicalHistoricalResolutionRiskSnapshot | null> {
    const canonicalEventIds = findDistinctCanonicalEventIds(resolved)
    if (canonicalEventIds.length === 0) {
      return null
    }

    if (!this.config.resolutionRiskProvider) {
      if (requireSnapshot) {
        throw new CanonicalHistoricalNormalizerError(
          "resolution_risk_snapshot_missing",
          "Resolution-risk snapshot provider is required for this normalization mode."
        )
      }
      return null
    }

    const snapshot = await this.config.resolutionRiskProvider.getSnapshot({
      canonicalEventId: canonicalEventIds[0]!
    })

    if (!snapshot) {
      if (requireSnapshot) {
        throw new CanonicalHistoricalNormalizerError(
          "resolution_risk_snapshot_missing",
          `Resolution-risk snapshot not found for canonical event ${canonicalEventIds[0]}.`
        )
      }
      return null
    }

    if (snapshot.freshness.isStale || !snapshot.freshness.isComplete) {
      if (requireSnapshot) {
        throw new CanonicalHistoricalNormalizerError(
          "resolution_risk_snapshot_stale",
          `Resolution-risk snapshot for canonical event ${snapshot.canonicalEventId} is incomplete or stale.`
        )
      }
    }

    return snapshot
  }

  private ensurePooledSafeEquivalent(
    resolved: readonly ResolvedHistoricalSource[],
    snapshot: CanonicalHistoricalResolutionRiskSnapshot | null
  ): void {
    if (!snapshot) {
      throw new CanonicalHistoricalNormalizerError(
        "resolution_risk_snapshot_missing",
        "Resolution-risk snapshot is required for pooled simulation."
      )
    }

    if (!snapshot.safeEquivalentEligible) {
      throw new CanonicalHistoricalNormalizerError(
        "resolution_risk_not_safe_equivalent",
        `Resolution-risk snapshot for canonical event ${snapshot.canonicalEventId} is not SAFE_EQUIVALENT eligible.`
      )
    }

    const profileIds = buildPairProfileIds(resolved)
    if (profileIds.length <= 1) {
      return
    }

    const assessments = new Map(
      snapshot.assessments.map((assessment) => [
        buildAssessmentKey(assessment.marketAProfileId, assessment.marketBProfileId),
        assessment
      ])
    )

    for (let index = 0; index < profileIds.length; index += 1) {
      for (let offset = index + 1; offset < profileIds.length; offset += 1) {
        const key = buildAssessmentKey(profileIds[index]!, profileIds[offset]!)
        const assessment = assessments.get(key)

        if (!assessment || assessment.equivalenceClass !== "SAFE_EQUIVALENT") {
          throw new CanonicalHistoricalNormalizerError(
            "resolution_risk_not_safe_equivalent",
            `Resolution-risk pair ${key} is missing or not SAFE_EQUIVALENT for pooled simulation.`
          )
        }
      }
    }
  }
}
