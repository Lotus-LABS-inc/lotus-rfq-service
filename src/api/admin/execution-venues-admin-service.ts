import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getPolymarketExecutionAdapterV2EnvStatus,
  type PolymarketExecutionAdapterV2EnvStatus
} from "../../execution-system/index.js";

export type ExecutionVenueOperationalStatus =
  | "STRUCTURALLY_READY"
  | "LIVE_DISABLED"
  | "EXTERNALLY_BLOCKED"
  | "NOT_CONFIGURED";

export interface ExecutionVenueReadinessSummary {
  venue: ExecutionVenue;
  adapter: "PolymarketExecutionAdapterV2" | "NOT_IMPLEMENTED";
  structuralReadiness: PolymarketExecutionAdapterV2EnvStatus["readinessState"] | "NOT_CONFIGURED";
  operationalStatus: ExecutionVenueOperationalStatus;
  marketRoutingCoverage: "COVERED_BY_MATCHING" | "UNKNOWN";
  liveSubmissionSupported: boolean;
  liveExecutionEnabled: boolean;
  featureFlagSelected: boolean;
  host: string | null;
  chainId: string | null;
  requiredEnvPresent: boolean;
  missingEnv: readonly string[];
  dryRunRequiredEnvPresent: boolean;
  missingDryRunEnv: readonly string[];
  credentialsServerSideOnly: true;
  lastHarnessAttempt: {
    artifactPresent: boolean;
    generatedAt: string | null;
    mode: string | null;
    submitted: boolean | null;
    errorCode: string | null;
    errorStatus: number | null;
    errorMessage: string | null;
    blockers: readonly string[];
    warnings: readonly string[];
  };
  operatorMessage: string;
}

export interface ExecutionVenuesAdminServiceDeps {
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const executionVenues = ["POLYMARKET", "LIMITLESS", "OPINION", "MYRIAD", "PREDICT_FUN"] as const;
type ExecutionVenue = (typeof executionVenues)[number];

const isExecutionVenue = (venue: string): venue is ExecutionVenue =>
  executionVenues.includes(venue as ExecutionVenue);

export class ExecutionVenuesAdminService {
  private readonly repoRoot: string;
  private readonly env: NodeJS.ProcessEnv;

  public constructor(deps: ExecutionVenuesAdminServiceDeps = {}) {
    this.repoRoot = deps.repoRoot ?? process.cwd();
    this.env = deps.env ?? process.env;
  }

  public async listVenues(): Promise<ExecutionVenueReadinessSummary[]> {
    return Promise.all(executionVenues.map((venue) => this.getVenue(venue)));
  }

  public async getVenue(venue: string): Promise<ExecutionVenueReadinessSummary> {
    if (!isExecutionVenue(venue)) {
      throw new ExecutionVenueNotFoundError(venue);
    }
    if (venue !== "POLYMARKET") {
      return this.getFailClosedVenue(venue);
    }
    const adapterStatus = getPolymarketExecutionAdapterV2EnvStatus(this.env);
    const lastHarnessAttempt = await this.readPolymarketHarnessArtifact();
    const operationalStatus = this.resolveOperationalStatus(adapterStatus, lastHarnessAttempt.errorCode);
    return {
      venue: "POLYMARKET",
      adapter: "PolymarketExecutionAdapterV2",
      structuralReadiness: adapterStatus.readinessState,
      operationalStatus,
      marketRoutingCoverage: "COVERED_BY_MATCHING",
      liveSubmissionSupported: true,
      liveExecutionEnabled: adapterStatus.liveExecutionEnabled,
      featureFlagSelected: adapterStatus.featureFlagSelected,
      host: this.env.POLYMARKET_CLOB_HOST ?? this.env.POLY_CLOB_HOST ?? null,
      chainId: this.env.POLYMARKET_CHAIN_ID ?? this.env.POLY_CHAIN_ID ?? null,
      requiredEnvPresent: adapterStatus.requiredEnvPresent,
      missingEnv: adapterStatus.missingEnv,
      dryRunRequiredEnvPresent: adapterStatus.dryRunRequiredEnvPresent,
      missingDryRunEnv: adapterStatus.missingDryRunEnv,
      credentialsServerSideOnly: true,
      lastHarnessAttempt,
      operatorMessage: this.operatorMessage(operationalStatus, lastHarnessAttempt.errorCode)
    };
  }

  private getFailClosedVenue(venue: Exclude<ExecutionVenue, "POLYMARKET">): ExecutionVenueReadinessSummary {
    return {
      venue,
      adapter: "NOT_IMPLEMENTED",
      structuralReadiness: "NOT_CONFIGURED",
      operationalStatus: "NOT_CONFIGURED",
      marketRoutingCoverage: "COVERED_BY_MATCHING",
      liveSubmissionSupported: false,
      liveExecutionEnabled: false,
      featureFlagSelected: false,
      host: null,
      chainId: null,
      requiredEnvPresent: false,
      missingEnv: [],
      dryRunRequiredEnvPresent: false,
      missingDryRunEnv: [],
      credentialsServerSideOnly: true,
      lastHarnessAttempt: {
        artifactPresent: false,
        generatedAt: null,
        mode: null,
        submitted: null,
        errorCode: null,
        errorStatus: null,
        errorMessage: null,
        blockers: [`${venue} live execution adapter is not implemented.`],
        warnings: []
      },
      operatorMessage: `${venue} has market/routing coverage, but no reviewed live execution adapter is enabled. Orders must fail closed instead of submitting to this venue.`
    };
  }

  private resolveOperationalStatus(
    adapterStatus: PolymarketExecutionAdapterV2EnvStatus,
    lastErrorCode: string | null
  ): ExecutionVenueOperationalStatus {
    if (lastErrorCode === "POLYMARKET_V2_UNAUTHORIZED") {
      return "EXTERNALLY_BLOCKED";
    }
    if (adapterStatus.readinessState === "LIVE_READY") {
      return "STRUCTURALLY_READY";
    }
    if (adapterStatus.readinessState === "LIVE_DISABLED") {
      return "LIVE_DISABLED";
    }
    return "NOT_CONFIGURED";
  }

  private operatorMessage(status: ExecutionVenueOperationalStatus, lastErrorCode: string | null): string {
    if (status === "EXTERNALLY_BLOCKED" && lastErrorCode === "POLYMARKET_V2_UNAUTHORIZED") {
      return "Polymarket adapter is structurally ready, but the last live-submit attempt was rejected by the venue with invalid API credentials.";
    }
    if (status === "STRUCTURALLY_READY") {
      return "Polymarket adapter is structurally ready; live submission remains controlled by the operator harness gates.";
    }
    if (status === "LIVE_DISABLED") {
      return "Polymarket V2 dry-run path is configured, but live execution is disabled.";
    }
    return "Polymarket V2 adapter is not fully configured.";
  }

  private async readPolymarketHarnessArtifact(): Promise<ExecutionVenueReadinessSummary["lastHarnessAttempt"]> {
    const artifactPath = join(this.repoRoot, "artifacts", "execution", "polymarket-live-submit-checklist.json");
    try {
      const parsed: unknown = JSON.parse(await readFile(artifactPath, "utf8"));
      if (!isRecord(parsed)) {
        throw new Error("invalid artifact");
      }
      const plan = isRecord(parsed.plan) ? parsed.plan : {};
      const error = isRecord(parsed.error) ? parsed.error : {};
      return {
        artifactPresent: true,
        generatedAt: asString(parsed.generatedAt),
        mode: asString(plan.mode),
        submitted: typeof parsed.submitted === "boolean" ? parsed.submitted : null,
        errorCode: asString(error.code),
        errorStatus: typeof error.status === "number" ? error.status : null,
        errorMessage: asString(error.message),
        blockers: asStringArray(plan.blockers),
        warnings: asStringArray(plan.warnings)
      };
    } catch {
      return {
        artifactPresent: false,
        generatedAt: null,
        mode: null,
        submitted: null,
        errorCode: null,
        errorStatus: null,
        errorMessage: null,
        blockers: [],
        warnings: []
      };
    }
  }
}

export class ExecutionVenueNotFoundError extends Error {
  public constructor(venue: string) {
    super(`Execution venue ${venue} was not found.`);
    this.name = "ExecutionVenueNotFoundError";
  }
}
