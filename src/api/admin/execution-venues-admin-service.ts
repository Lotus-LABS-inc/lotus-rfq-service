import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getLimitlessExecutionAdapterEnvStatus,
  getPolymarketExecutionAdapterV2EnvStatus,
  type ExecutionSigningModel,
  type LimitlessExecutionAdapterEnvStatus,
  type PolymarketExecutionAdapterV2EnvStatus
} from "../../execution-system/index.js";

export type ExecutionVenueOperationalStatus =
  | "STRUCTURALLY_READY"
  | "LIVE_DISABLED"
  | "EXTERNALLY_BLOCKED"
  | "NOT_CONFIGURED";

export interface ExecutionVenueReadinessSummary {
  venue: ExecutionVenue;
  adapter: "PolymarketExecutionAdapterV2" | "LimitlessExecutionAdapter" | "NOT_IMPLEMENTED";
  executionSigningModel: ExecutionSigningModel;
  structuralReadiness:
    | PolymarketExecutionAdapterV2EnvStatus["readinessState"]
    | LimitlessExecutionAdapterEnvStatus["readinessState"]
    | "NOT_CONFIGURED";
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
    if (venue === "LIMITLESS") {
      return this.getLimitlessVenue();
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
      executionSigningModel: "BACKEND_SIGNER",
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

  private getLimitlessVenue(): ExecutionVenueReadinessSummary {
    const adapterStatus = getLimitlessExecutionAdapterEnvStatus(this.env);
    const operationalStatus = this.resolveLimitlessOperationalStatus(adapterStatus);
    const blockers = this.limitlessBlockers(adapterStatus);
    return {
      venue: "LIMITLESS",
      adapter: "LimitlessExecutionAdapter",
      executionSigningModel: adapterStatus.executionSigningModel,
      structuralReadiness: adapterStatus.readinessState,
      operationalStatus,
      marketRoutingCoverage: "COVERED_BY_MATCHING",
      liveSubmissionSupported: true,
      liveExecutionEnabled: adapterStatus.liveExecutionEnabled,
      featureFlagSelected: adapterStatus.featureFlagSelected,
      host: this.env.LIMITLESS_BASE_URL ?? null,
      chainId: this.env.LIMITLESS_CHAIN_ID ?? this.env.LIMITLESS_FUNDING_PREFERRED_CHAIN_ID ?? null,
      requiredEnvPresent: adapterStatus.requiredEnvPresent,
      missingEnv: adapterStatus.missingEnv,
      dryRunRequiredEnvPresent: adapterStatus.dryRunRequiredEnvPresent,
      missingDryRunEnv: adapterStatus.missingDryRunEnv,
      credentialsServerSideOnly: true,
      lastHarnessAttempt: {
        artifactPresent: false,
        generatedAt: null,
        mode: null,
        submitted: null,
        errorCode: null,
        errorStatus: null,
        errorMessage: null,
        blockers,
        warnings: []
      },
      operatorMessage: this.limitlessOperatorMessage(operationalStatus, adapterStatus)
    };
  }

  private getFailClosedVenue(venue: Exclude<ExecutionVenue, "POLYMARKET" | "LIMITLESS">): ExecutionVenueReadinessSummary {
    const executionSigningModel = this.userSignedVenueModel(venue);
    return {
      venue,
      adapter: "NOT_IMPLEMENTED",
      executionSigningModel,
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
        blockers: [`${venue} backend live execution is not enabled for signing model ${executionSigningModel}.`],
        warnings: []
      },
      operatorMessage: `${venue} has market/routing coverage, but requires a reviewed ${executionSigningModel} execution flow before live backend submission. Orders must fail closed instead of submitting to this venue.`
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

  private resolveLimitlessOperationalStatus(
    adapterStatus: LimitlessExecutionAdapterEnvStatus
  ): ExecutionVenueOperationalStatus {
    if (adapterStatus.readinessState === "LIVE_READY") {
      return "STRUCTURALLY_READY";
    }
    if (adapterStatus.readinessState === "LIVE_DISABLED") {
      return "LIVE_DISABLED";
    }
    return "NOT_CONFIGURED";
  }

  private limitlessBlockers(adapterStatus: LimitlessExecutionAdapterEnvStatus): string[] {
    const blockers: string[] = [];
    if (!adapterStatus.featureFlagSelected) {
      blockers.push("LIMITLESS_EXECUTION_MODE must be backend_signer before this adapter is selected.");
    }
    if (!adapterStatus.dryRunRequiredEnvPresent) {
      blockers.push(`Missing Limitless dry-run env: ${adapterStatus.missingDryRunEnv.join(", ")}.`);
    }
    if (!adapterStatus.liveExecutionEnabled) {
      blockers.push("LIMITLESS_LIVE_EXECUTION_ENABLED is false.");
    }
    if (adapterStatus.liveExecutionEnabled && !adapterStatus.requiredEnvPresent) {
      blockers.push(`Missing Limitless live env: ${adapterStatus.missingEnv.join(", ")}.`);
    }
    blockers.push("Settlement evidence reader is not implemented yet; live fills must remain operator-reviewed.");
    return blockers;
  }

  private limitlessOperatorMessage(
    status: ExecutionVenueOperationalStatus,
    adapterStatus: LimitlessExecutionAdapterEnvStatus
  ): string {
    if (!adapterStatus.featureFlagSelected) {
      return "Limitless backend-signer adapter is scaffolded but not selected. Set LIMITLESS_EXECUTION_MODE=backend_signer only after SDK signing and settlement evidence are reviewed.";
    }
    if (status === "STRUCTURALLY_READY") {
      return "Limitless backend-signer adapter is structurally ready, but live fills still require reviewed settlement evidence before production enablement.";
    }
    if (status === "LIVE_DISABLED") {
      return "Limitless dry-run path is configured, but live execution is disabled.";
    }
    return "Limitless backend-signer adapter is not fully configured.";
  }

  private userSignedVenueModel(
    venue: Exclude<ExecutionVenue, "POLYMARKET" | "LIMITLESS">
  ): ExecutionSigningModel {
    if (venue === "OPINION" || venue === "PREDICT_FUN") {
      return "USER_SIGNED_BACKEND_RELAY";
    }
    if (venue === "MYRIAD") {
      return "USER_SIGNED";
    }
    return "NOT_SUPPORTED";
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
