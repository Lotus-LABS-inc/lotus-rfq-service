import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { FundingVenue } from "./types.js";

export interface InternalWithdrawalEvidenceReadInput {
  userId: string;
  withdrawalIntentId: string;
  withdrawalRouteLegId: string;
  sourceVenue: FundingVenue;
  withdrawalTxHash: string;
}

export type LimitlessWithdrawalEvidenceReadInput = InternalWithdrawalEvidenceReadInput & { sourceVenue: "LIMITLESS" };

export interface InternalWithdrawalEvidenceReadOutput {
  sourceVenue: FundingVenue;
  withdrawalTxHash: string;
  status: "PENDING" | "VENUE_RELEASED" | "DESTINATION_RECEIVED" | "COMPLETED" | "FAILED" | "UNKNOWN";
  venueReleased: boolean;
  destinationReceived: boolean;
  completed: boolean;
  destinationChain?: string;
  destinationWalletAddress?: string;
  token?: string;
  amount?: string;
  confirmations?: number;
  observedAt?: string;
  reason: string;
}

export type LimitlessWithdrawalEvidenceReadOutput = InternalWithdrawalEvidenceReadOutput & { sourceVenue: "LIMITLESS" };

export interface InternalWithdrawalEvidenceReadStatus {
  enabled: boolean;
  configured: boolean;
  fixturePathConfigured: boolean;
  credentialsServerSideOnly: true;
}

export type LimitlessWithdrawalEvidenceReadStatus = InternalWithdrawalEvidenceReadStatus;

export interface InternalWithdrawalEvidenceReadServiceConfig {
  venue?: FundingVenue | undefined;
  enabled?: boolean | undefined;
  fixturePath?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

export type LimitlessWithdrawalEvidenceReadServiceConfig = InternalWithdrawalEvidenceReadServiceConfig & { venue?: "LIMITLESS" };

export class LimitlessWithdrawalEvidenceReadNotConfiguredError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LimitlessWithdrawalEvidenceReadNotConfiguredError";
  }
}

export class LimitlessWithdrawalEvidenceNotFoundError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LimitlessWithdrawalEvidenceNotFoundError";
  }
}

export class LimitlessWithdrawalEvidenceMalformedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LimitlessWithdrawalEvidenceMalformedError";
  }
}

export const buildInternalWithdrawalEvidenceReadConfigFromEnv = (
  venue: FundingVenue,
  env: NodeJS.ProcessEnv = process.env
): InternalWithdrawalEvidenceReadServiceConfig => ({
  venue,
  enabled: env[`${venue}_INTERNAL_WITHDRAWAL_EVIDENCE_READ_ENABLED`] === "true",
  fixturePath: env[`${venue}_INTERNAL_WITHDRAWAL_EVIDENCE_FIXTURE_PATH`],
  env
});

export const buildLimitlessWithdrawalEvidenceReadConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): LimitlessWithdrawalEvidenceReadServiceConfig => ({
  ...buildInternalWithdrawalEvidenceReadConfigFromEnv("LIMITLESS", env),
  venue: "LIMITLESS"
});

export class InternalWithdrawalEvidenceReadService {
  public constructor(private readonly config: InternalWithdrawalEvidenceReadServiceConfig = {}) {}

  public getStatus(venue: FundingVenue = this.config.venue ?? "LIMITLESS"): InternalWithdrawalEvidenceReadStatus {
    const resolved = this.resolveConfig(venue);
    return {
      enabled: resolved.enabled,
      configured: resolved.enabled && nonEmpty(resolved.fixturePath),
      fixturePathConfigured: nonEmpty(resolved.fixturePath),
      credentialsServerSideOnly: true
    };
  }

  public async readEvidence(input: InternalWithdrawalEvidenceReadInput): Promise<InternalWithdrawalEvidenceReadOutput> {
    const resolved = this.resolveConfig(input.sourceVenue);
    const status = this.getStatus(input.sourceVenue);
    if (!status.configured || !resolved.fixturePath) {
      throw new LimitlessWithdrawalEvidenceReadNotConfiguredError(`${input.sourceVenue} withdrawal evidence read is disabled or incomplete.`);
    }

    const records = await this.readFixtureRecords(resolved.fixturePath);
    const matched = records.find((record) => matchesInput(record, input));
    if (!matched) {
      throw new LimitlessWithdrawalEvidenceNotFoundError(`${input.sourceVenue} withdrawal evidence was not found for this submitted tx hash.`);
    }
    return normalizeRecord(matched, input);
  }

  private resolveConfig(venue: FundingVenue): {
    enabled: boolean;
    fixturePath?: string | undefined;
  } {
    if (this.config.venue) {
      return {
        enabled: this.config.enabled === true,
        fixturePath: this.config.fixturePath
      };
    }
    const env = this.config.env ?? process.env;
    return {
      enabled: env[`${venue}_INTERNAL_WITHDRAWAL_EVIDENCE_READ_ENABLED`] === "true",
      fixturePath: env[`${venue}_INTERNAL_WITHDRAWAL_EVIDENCE_FIXTURE_PATH`]
    };
  }

  private async readFixtureRecords(path: string): Promise<Record<string, unknown>[]> {
    const resolved = isAbsolute(path) ? path : resolve(process.cwd(), path);
    const parsed = JSON.parse(stripBom(await readFile(resolved, "utf8"))) as unknown;
    const records = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.records)
        ? parsed.records
        : [parsed];
    if (!records.every(isRecord)) {
      throw new LimitlessWithdrawalEvidenceMalformedError("Withdrawal evidence fixture must contain object records.");
    }
    return records;
  }
}

export class LimitlessWithdrawalEvidenceReadService extends InternalWithdrawalEvidenceReadService {
  public constructor(config: LimitlessWithdrawalEvidenceReadServiceConfig) {
    super({ ...config, venue: "LIMITLESS" });
  }
}

const nonEmpty = (value: string | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;

const stripBom = (value: string): string => value.charCodeAt(0) === 0xFEFF ? value.slice(1) : value;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const optionalStringMatches = (recordValue: unknown, inputValue: string): boolean =>
  typeof recordValue !== "string" || recordValue.length === 0 || recordValue === inputValue;

const matchesInput = (record: Record<string, unknown>, input: InternalWithdrawalEvidenceReadInput): boolean =>
  record.sourceVenue === input.sourceVenue &&
  equalsIgnoreCase(stringValue(record.withdrawalTxHash), input.withdrawalTxHash) &&
  optionalStringMatches(record.userId, input.userId) &&
  optionalStringMatches(record.withdrawalIntentId, input.withdrawalIntentId) &&
  optionalStringMatches(record.withdrawalRouteLegId, input.withdrawalRouteLegId);

const normalizeRecord = (
  record: Record<string, unknown>,
  input: InternalWithdrawalEvidenceReadInput
): InternalWithdrawalEvidenceReadOutput => {
  const status = stringValue(record.status)?.toUpperCase();
  if (!isEvidenceStatus(status)) {
    throw new LimitlessWithdrawalEvidenceMalformedError("Withdrawal evidence status is missing or unsupported.");
  }
  return {
    sourceVenue: input.sourceVenue,
    withdrawalTxHash: stringValue(record.withdrawalTxHash) ?? input.withdrawalTxHash,
    status,
    venueReleased: booleanValue(record.venueReleased),
    destinationReceived: booleanValue(record.destinationReceived),
    completed: booleanValue(record.completed),
    ...(stringValue(record.destinationChain) ? { destinationChain: stringValue(record.destinationChain)! } : {}),
    ...(stringValue(record.destinationWalletAddress) ? { destinationWalletAddress: stringValue(record.destinationWalletAddress)! } : {}),
    ...(stringValue(record.token) ? { token: stringValue(record.token)! } : {}),
    ...(stringValue(record.amount) ? { amount: stringValue(record.amount)! } : {}),
    ...(numberValue(record.confirmations) !== null ? { confirmations: numberValue(record.confirmations)! } : {}),
    ...(stringValue(record.observedAt) ? { observedAt: stringValue(record.observedAt)! } : {}),
    reason: stringValue(record.reason) ?? `${input.sourceVenue}_WITHDRAWAL_EVIDENCE_NORMALIZED`
  };
};

const isEvidenceStatus = (status: string | undefined): status is InternalWithdrawalEvidenceReadOutput["status"] =>
  status === "PENDING" ||
  status === "VENUE_RELEASED" ||
  status === "DESTINATION_RECEIVED" ||
  status === "COMPLETED" ||
  status === "FAILED" ||
  status === "UNKNOWN";

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const numberValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const booleanValue = (value: unknown): boolean =>
  value === true || value === "true";

const equalsIgnoreCase = (a: string | undefined, b: string): boolean =>
  typeof a === "string" && a.toLowerCase() === b.toLowerCase();
