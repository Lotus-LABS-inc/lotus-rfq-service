import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getLimitlessExecutionAdapterEnvStatus,
  LIMITLESS_DEFAULT_BASE_URL,
  getOpinionExecutionAdapterEnvStatus,
  getPredictFunExecutionAdapterEnvStatus,
  getPolymarketExecutionAdapterV2EnvStatus,
  type ExecutionSigningModel,
  type LimitlessExecutionAdapterEnvStatus,
  type PolymarketExecutionAdapterV2EnvStatus,
  type UserSignedRelayExecutionAdapterEnvStatus
} from "../../execution-system/index.js";
import type { UserVenueAccountRepository } from "../../core/execution/user-venue-accounts.js";

export type ExecutionVenueOperationalStatus =
  | "STRUCTURALLY_READY"
  | "LIVE_DISABLED"
  | "EXTERNALLY_BLOCKED"
  | "NOT_CONFIGURED";

export interface ExecutionVenueReadinessSummary {
  venue: ExecutionVenue;
  adapter: "PolymarketExecutionAdapterV2" | "LimitlessExecutionAdapter" | "OpinionExecutionAdapter" | "PredictFunExecutionAdapter" | "NOT_IMPLEMENTED";
  executionSigningModel: ExecutionSigningModel;
  structuralReadiness:
    | PolymarketExecutionAdapterV2EnvStatus["readinessState"]
    | LimitlessExecutionAdapterEnvStatus["readinessState"]
    | UserSignedRelayExecutionAdapterEnvStatus["readinessState"]
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
    fillStatus: string | null;
    settlementStatus: string | null;
    settlementVerified: boolean | null;
    blockers: readonly string[];
    warnings: readonly string[];
  };
  operatorMessage: string;
  venueAccountRequired: boolean;
  venueAccountConfigured: boolean;
  activeLinkedAccounts: number;
  accountSetupBlockers: readonly string[];
}

export interface ExecutionVenuesAdminServiceDeps {
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
  venueAccountRepository?: Pick<UserVenueAccountRepository, "countActiveAccountsByVenue"> | undefined;
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
  private readonly venueAccountRepository?: Pick<UserVenueAccountRepository, "countActiveAccountsByVenue"> | undefined;

  public constructor(deps: ExecutionVenuesAdminServiceDeps = {}) {
    this.repoRoot = deps.repoRoot ?? process.cwd();
    this.env = deps.env ?? process.env;
    this.venueAccountRepository = deps.venueAccountRepository;
  }

  public async listVenues(): Promise<ExecutionVenueReadinessSummary[]> {
    const accountCounts = await this.loadActiveVenueAccountCounts();
    return Promise.all(executionVenues.map((venue) => this.getVenue(venue, accountCounts)));
  }

  public async getVenue(venue: string, accountCounts?: Record<string, number>): Promise<ExecutionVenueReadinessSummary> {
    if (!isExecutionVenue(venue)) {
      throw new ExecutionVenueNotFoundError(venue);
    }
    const counts = accountCounts ?? await this.loadActiveVenueAccountCounts();
    if (venue === "LIMITLESS") {
      return this.withVenueAccountReadiness(await this.getLimitlessVenue(), counts);
    }
    if (venue === "OPINION") {
      return this.withVenueAccountReadiness(await this.getUserSignedRelayVenue(getOpinionExecutionAdapterEnvStatus(this.env)), counts);
    }
    if (venue === "PREDICT_FUN") {
      return this.withVenueAccountReadiness(await this.getUserSignedRelayVenue(getPredictFunExecutionAdapterEnvStatus(this.env)), counts);
    }
    if (venue !== "POLYMARKET") {
      return this.withVenueAccountReadiness(this.getFailClosedVenue(venue), counts);
    }
    const adapterStatus = getPolymarketExecutionAdapterV2EnvStatus(this.env);
    const lastHarnessAttempt = await this.readPolymarketHarnessArtifact();
    const operationalStatus = this.resolveOperationalStatus(adapterStatus, lastHarnessAttempt.errorCode);
    return this.withVenueAccountReadiness({
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
      operatorMessage: this.operatorMessage(operationalStatus, lastHarnessAttempt.errorCode),
      venueAccountRequired: false,
      venueAccountConfigured: false,
      activeLinkedAccounts: 0,
      accountSetupBlockers: []
    }, counts);
  }

  private async getLimitlessVenue(): Promise<ExecutionVenueReadinessSummary> {
    const adapterStatus = getLimitlessExecutionAdapterEnvStatus(this.env);
    const operationalStatus = this.resolveLimitlessOperationalStatus(adapterStatus);
    const blockers = this.limitlessBlockers(adapterStatus);
    const lastHarnessAttempt = await this.readLimitlessHarnessArtifact(blockers);
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
      host: this.env.LIMITLESS_BASE_URL ?? LIMITLESS_DEFAULT_BASE_URL,
      chainId: this.env.LIMITLESS_CHAIN_ID ?? this.env.LIMITLESS_FUNDING_PREFERRED_CHAIN_ID ?? null,
      requiredEnvPresent: adapterStatus.requiredEnvPresent,
      missingEnv: adapterStatus.missingEnv,
      dryRunRequiredEnvPresent: adapterStatus.dryRunRequiredEnvPresent,
      missingDryRunEnv: adapterStatus.missingDryRunEnv,
      credentialsServerSideOnly: true,
      lastHarnessAttempt,
      operatorMessage: this.limitlessOperatorMessage(operationalStatus, adapterStatus),
      venueAccountRequired: false,
      venueAccountConfigured: false,
      activeLinkedAccounts: 0,
      accountSetupBlockers: []
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
        fillStatus: null,
        settlementStatus: null,
        settlementVerified: null,
        blockers: [`${venue} backend live execution is not enabled for signing model ${executionSigningModel}.`],
        warnings: []
      },
      operatorMessage: `${venue} has market/routing coverage, but requires a reviewed ${executionSigningModel} execution flow before live backend submission. Orders must fail closed instead of submitting to this venue.`,
      venueAccountRequired: false,
      venueAccountConfigured: false,
      activeLinkedAccounts: 0,
      accountSetupBlockers: []
    };
  }

  private async getUserSignedRelayVenue(
    adapterStatus: UserSignedRelayExecutionAdapterEnvStatus
  ): Promise<ExecutionVenueReadinessSummary> {
    const operationalStatus = this.resolveUserSignedRelayOperationalStatus(adapterStatus);
    const blockers = this.userSignedRelayBlockers(adapterStatus);
    const lastHarnessAttempt = adapterStatus.venue === "PREDICT_FUN"
      ? await this.readPredictFunHarnessArtifact(blockers)
      : {
          artifactPresent: false,
          generatedAt: null,
          mode: null,
          submitted: null,
          errorCode: null,
          errorStatus: null,
          errorMessage: null,
          fillStatus: null,
          settlementStatus: null,
          settlementVerified: null,
          blockers,
          warnings: []
        };
    return {
      venue: adapterStatus.venue,
      adapter: adapterStatus.adapter,
      executionSigningModel: adapterStatus.executionSigningModel,
      structuralReadiness: adapterStatus.readinessState,
      operationalStatus,
      marketRoutingCoverage: "COVERED_BY_MATCHING",
      liveSubmissionSupported: adapterStatus.venue === "PREDICT_FUN" &&
        adapterStatus.relayImplementationStatus === "SIGNED_RELAY_IMPLEMENTED",
      liveExecutionEnabled: adapterStatus.liveExecutionEnabled,
      featureFlagSelected: adapterStatus.featureFlagSelected,
      host: adapterStatus.venue === "OPINION"
        ? this.env.OPINION_CLOB_BASE_URL ?? null
        : this.env.PREDICT_MAINNET_BASE_URL ?? null,
      chainId: null,
      requiredEnvPresent: adapterStatus.requiredEnvPresent,
      missingEnv: adapterStatus.missingEnv,
      dryRunRequiredEnvPresent: adapterStatus.dryRunRequiredEnvPresent,
      missingDryRunEnv: adapterStatus.missingDryRunEnv,
      credentialsServerSideOnly: true,
      lastHarnessAttempt,
      operatorMessage: this.userSignedRelayOperatorMessage(adapterStatus, operationalStatus),
      venueAccountRequired: false,
      venueAccountConfigured: false,
      activeLinkedAccounts: 0,
      accountSetupBlockers: []
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
      blockers.push("LIMITLESS_EXECUTION_MODE must be user_signed_backend_relay, backend_signer, or delegated_partner_server_wallet before this adapter is selected.");
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
    blockers.push("Limitless settlement evidence reader is implemented, but live fills must remain operator-reviewed until the tiny harness proves fill/status/finality behavior.");
    return blockers;
  }

  private limitlessOperatorMessage(
    status: ExecutionVenueOperationalStatus,
    adapterStatus: LimitlessExecutionAdapterEnvStatus
  ): string {
    if (!adapterStatus.featureFlagSelected) {
      return "Limitless adapter is scaffolded but not selected. Set LIMITLESS_EXECUTION_MODE=user_signed_backend_relay for the non-custodial Turnkey wallet flow; delegated_partner_server_wallet and backend_signer are non-default legacy/operator paths.";
    }
    if (adapterStatus.executionMode === "user_signed_backend_relay") {
      if (status === "STRUCTURALLY_READY") {
        return "Limitless user-signed backend relay is structurally ready. Users keep control of their Turnkey EVM wallets; Lotus only relays signed orders with server-side HMAC after quote and account checks.";
      }
      if (status === "LIVE_DISABLED") {
        return "Limitless user-signed backend relay dry-run path is configured, but live relay is disabled.";
      }
      return "Limitless user-signed backend relay is not fully configured.";
    }
    if (adapterStatus.executionMode === "delegated_partner_server_wallet") {
      if (status === "STRUCTURALLY_READY") {
        return "Limitless delegated partner server-wallet adapter is structurally ready, but live fills still require reviewed settlement evidence before production enablement.";
      }
      if (status === "LIVE_DISABLED") {
        return "Limitless delegated partner server-wallet dry-run path is configured, but live execution is disabled.";
      }
      return "Limitless delegated partner server-wallet adapter is not fully configured.";
    }
    if (status === "STRUCTURALLY_READY") {
      return "Limitless backend-signer adapter is structurally ready, but live fills still require reviewed settlement evidence before production enablement.";
    }
    if (status === "LIVE_DISABLED") {
      return "Limitless dry-run path is configured, but live execution is disabled.";
    }
    return "Limitless backend-signer adapter is not fully configured.";
  }

  private resolveUserSignedRelayOperationalStatus(
    adapterStatus: UserSignedRelayExecutionAdapterEnvStatus
  ): ExecutionVenueOperationalStatus {
    if (adapterStatus.readinessState === "LIVE_READY") {
      return "STRUCTURALLY_READY";
    }
    if (adapterStatus.readinessState === "LIVE_DISABLED") {
      return "LIVE_DISABLED";
    }
    return "NOT_CONFIGURED";
  }

  private userSignedRelayBlockers(adapterStatus: UserSignedRelayExecutionAdapterEnvStatus): string[] {
    const blockers: string[] = [];
    if (!adapterStatus.featureFlagSelected) {
      blockers.push(`${adapterStatus.venue}_EXECUTION_MODE must be user_signed_backend_relay before relay instructions are selected.`);
    }
    if (!adapterStatus.dryRunRequiredEnvPresent) {
      blockers.push(`Missing ${adapterStatus.venue} relay dry-run env: ${adapterStatus.missingDryRunEnv.join(", ")}.`);
    }
    if (!adapterStatus.liveExecutionEnabled) {
      blockers.push(`${adapterStatus.venue}_LIVE_EXECUTION_ENABLED is false.`);
    }
    if (adapterStatus.liveExecutionEnabled && !adapterStatus.requiredEnvPresent) {
      blockers.push(`Missing ${adapterStatus.venue} relay live env: ${adapterStatus.missingEnv.join(", ")}.`);
    }
    if (adapterStatus.relayImplementationStatus === "PREPARE_ONLY") {
      if (adapterStatus.venue === "OPINION") {
        blockers.push("Opinion builder account creation and signed-payload relay submit are not confirmed for this API key; cancel/fill/status and settlement evidence readers are not implemented yet.");
      } else {
        blockers.push("Signed-payload relay submit is prepare-only; cancel/fill/status and settlement evidence readers are not implemented yet.");
      }
    } else {
      blockers.push("Signed-payload relay submit is implemented but settlement evidence remains pending; do not mark settlement verified without venue evidence.");
    }
    return blockers;
  }

  private userSignedRelayOperatorMessage(
    adapterStatus: UserSignedRelayExecutionAdapterEnvStatus,
    status: ExecutionVenueOperationalStatus
  ): string {
    if (!adapterStatus.featureFlagSelected) {
      return `${adapterStatus.venue} user-signed backend relay adapter is scaffolded but not selected.`;
    }
    if (status === "STRUCTURALLY_READY" && adapterStatus.relayImplementationStatus === "SIGNED_RELAY_IMPLEMENTED") {
      return `${adapterStatus.venue} user-signed relay env is structurally ready; signed-payload relay is implemented, but live relay remains operator-gated and settlement evidence must be reviewed before production enablement.`;
    }
    if (status === "STRUCTURALLY_READY") {
      if (adapterStatus.venue === "OPINION") {
        return "OPINION user-signed relay prepare path is configured, but backend submit remains disabled until builder account creation, signed-payload relay, cancel/fill/status, and settlement evidence are confirmed.";
      }
      return `${adapterStatus.venue} user-signed relay env is structurally ready, but backend submit remains disabled until signed-payload relay, cancel/fill/status, and settlement evidence are reviewed.`;
    }
    if (status === "LIVE_DISABLED") {
      return `${adapterStatus.venue} user-signed relay prepare path is configured, but live relay is disabled.`;
    }
    return `${adapterStatus.venue} user-signed relay adapter is not fully configured.`;
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

  private async loadActiveVenueAccountCounts(): Promise<Record<string, number>> {
    if (!this.venueAccountRepository) {
      return {};
    }
    try {
      return await this.venueAccountRepository.countActiveAccountsByVenue();
    } catch {
      return {};
    }
  }

  private withVenueAccountReadiness(
    summary: ExecutionVenueReadinessSummary,
    accountCounts: Record<string, number>
  ): ExecutionVenueReadinessSummary {
    const venueAccountRequired = summary.venue === "POLYMARKET" ||
      summary.venue === "OPINION" ||
      summary.venue === "PREDICT_FUN" ||
      (summary.venue === "LIMITLESS" && (
        summary.executionSigningModel === "DELEGATED_BACKEND_SIGNER" ||
        summary.executionSigningModel === "USER_SIGNED_BACKEND_RELAY"
      ));
    const activeLinkedAccounts = accountCounts[summary.venue] ?? 0;
    const venueAccountConfigured = !venueAccountRequired || activeLinkedAccounts > 0;
    return {
      ...summary,
      venueAccountRequired,
      venueAccountConfigured,
      activeLinkedAccounts,
      accountSetupBlockers: venueAccountRequired && activeLinkedAccounts === 0
        ? [`${summary.venue} requires an active Turnkey EVM venue account binding before signed relay submit.`]
        : []
    };
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
        fillStatus: null,
        settlementStatus: null,
        settlementVerified: null,
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
        fillStatus: null,
        settlementStatus: null,
        settlementVerified: null,
        blockers: [],
        warnings: []
      };
    }
  }

  private async readLimitlessHarnessArtifact(
    fallbackBlockers: readonly string[]
  ): Promise<ExecutionVenueReadinessSummary["lastHarnessAttempt"]> {
    const artifactPath = join(this.repoRoot, "artifacts", "execution", "limitless-live-submit-checklist.json");
    try {
      const parsed: unknown = JSON.parse(await readFile(artifactPath, "utf8"));
      if (!isRecord(parsed)) {
        throw new Error("invalid artifact");
      }
      const plan = isRecord(parsed.plan) ? parsed.plan : {};
      const error = isRecord(parsed.error) ? parsed.error : {};
      const fillState = isRecord(parsed.fillState) ? parsed.fillState : {};
      const settlementState = isRecord(parsed.settlementState) ? parsed.settlementState : {};
      return {
        artifactPresent: true,
        generatedAt: asString(parsed.generatedAt),
        mode: asString(plan.mode),
        submitted: typeof parsed.submitted === "boolean" ? parsed.submitted : null,
        errorCode: asString(error.code),
        errorStatus: typeof error.status === "number" ? error.status : null,
        errorMessage: asString(error.message),
        fillStatus: asString(fillState.status),
        settlementStatus: asString(settlementState.status),
        settlementVerified: typeof parsed.settlementVerified === "boolean" ? parsed.settlementVerified : null,
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
        fillStatus: null,
        settlementStatus: null,
        settlementVerified: null,
        blockers: [...fallbackBlockers],
        warnings: []
      };
    }
  }

  private async readPredictFunHarnessArtifact(
    fallbackBlockers: readonly string[]
  ): Promise<ExecutionVenueReadinessSummary["lastHarnessAttempt"]> {
    const artifactPath = join(this.repoRoot, "artifacts", "execution", "predictfun-live-submit-checklist.json");
    try {
      const parsed: unknown = JSON.parse(await readFile(artifactPath, "utf8"));
      if (!isRecord(parsed)) {
        throw new Error("invalid artifact");
      }
      const plan = isRecord(parsed.plan) ? parsed.plan : {};
      const error = isRecord(parsed.error) ? parsed.error : {};
      const fillState = isRecord(parsed.fillState) ? parsed.fillState : {};
      const settlementState = isRecord(parsed.settlementState) ? parsed.settlementState : {};
      return {
        artifactPresent: true,
        generatedAt: asString(parsed.generatedAt),
        mode: asString(plan.mode),
        submitted: typeof parsed.submitted === "boolean" ? parsed.submitted : null,
        errorCode: asString(error.code),
        errorStatus: typeof error.status === "number" ? error.status : null,
        errorMessage: asString(error.message),
        fillStatus: asString(fillState.status),
        settlementStatus: asString(settlementState.status),
        settlementVerified: typeof parsed.settlementVerified === "boolean" ? parsed.settlementVerified : null,
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
        fillStatus: null,
        settlementStatus: null,
        settlementVerified: null,
        blockers: [...fallbackBlockers],
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
