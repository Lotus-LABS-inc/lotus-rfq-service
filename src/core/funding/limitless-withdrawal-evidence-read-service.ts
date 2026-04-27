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
  recoveryReviewRequired?: boolean;
  recoveryReason?: string;
  bridgeAddress?: string;
  bridgeStatus?: string;
  bridgeAmount?: string;
  bridgeTxHash?: string;
  reason: string;
}

export type LimitlessWithdrawalEvidenceReadOutput = InternalWithdrawalEvidenceReadOutput & { sourceVenue: "LIMITLESS" };

export interface InternalWithdrawalEvidenceReadStatus {
  enabled: boolean;
  configured: boolean;
  fixturePathConfigured: boolean;
  onchainConfigured: boolean;
  readMode: InternalWithdrawalEvidenceReadMode;
  credentialsServerSideOnly: true;
}

export type LimitlessWithdrawalEvidenceReadStatus = InternalWithdrawalEvidenceReadStatus;

export interface InternalWithdrawalEvidenceReadServiceConfig {
  venue?: FundingVenue | undefined;
  enabled?: boolean | undefined;
  fixturePath?: string | undefined;
  readMode?: InternalWithdrawalEvidenceReadMode | undefined;
  polygonRpcUrl?: string | undefined;
  bscRpcUrl?: string | undefined;
  bridgeStatusBaseUrl?: string | undefined;
  usdcTokenAddress?: string | undefined;
  usdtTokenAddress?: string | undefined;
  usd1TokenAddress?: string | undefined;
  minimumConfirmations?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
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

export type InternalWithdrawalEvidenceReadMode = "FIXTURE" | "POLYGON_ONCHAIN" | "BSC_ONCHAIN";

export const buildInternalWithdrawalEvidenceReadConfigFromEnv = (
  venue: FundingVenue,
  env: NodeJS.ProcessEnv = process.env
): InternalWithdrawalEvidenceReadServiceConfig => ({
  venue,
  enabled: env[`${venue}_INTERNAL_WITHDRAWAL_EVIDENCE_READ_ENABLED`] === "true",
  readMode: readModeFromEnv(env[`${venue}_INTERNAL_WITHDRAWAL_EVIDENCE_READ_MODE`]),
  fixturePath: env[`${venue}_INTERNAL_WITHDRAWAL_EVIDENCE_FIXTURE_PATH`],
  polygonRpcUrl: env[`${venue}_INTERNAL_WITHDRAWAL_EVIDENCE_POLYGON_RPC_URL`],
  bscRpcUrl: env[`${venue}_INTERNAL_WITHDRAWAL_EVIDENCE_BSC_RPC_URL`],
  bridgeStatusBaseUrl: env[`${venue}_INTERNAL_WITHDRAWAL_EVIDENCE_BRIDGE_STATUS_BASE_URL`],
  usdcTokenAddress: env[`${venue}_INTERNAL_WITHDRAWAL_EVIDENCE_USDC_ADDRESS`],
  usdtTokenAddress: env[`${venue}_INTERNAL_WITHDRAWAL_EVIDENCE_USDT_ADDRESS`],
  usd1TokenAddress: env[`${venue}_INTERNAL_WITHDRAWAL_EVIDENCE_USD1_ADDRESS`],
  minimumConfirmations: positiveInt(env[`${venue}_WITHDRAWAL_MIN_CONFIRMATIONS`], 1),
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
      configured: resolved.enabled && (
        nonEmpty(resolved.fixturePath) ||
        (resolved.readMode === "POLYGON_ONCHAIN" && nonEmpty(resolved.polygonRpcUrl)) ||
        (resolved.readMode === "BSC_ONCHAIN" && nonEmpty(resolved.bscRpcUrl))
      ),
      fixturePathConfigured: nonEmpty(resolved.fixturePath),
      onchainConfigured: (resolved.readMode === "POLYGON_ONCHAIN" && nonEmpty(resolved.polygonRpcUrl)) ||
        (resolved.readMode === "BSC_ONCHAIN" && nonEmpty(resolved.bscRpcUrl) && (
          venue !== "MYRIAD" || nonEmpty(resolved.usd1TokenAddress)
        )),
      readMode: resolved.readMode,
      credentialsServerSideOnly: true
    };
  }

  public async readEvidence(input: InternalWithdrawalEvidenceReadInput): Promise<InternalWithdrawalEvidenceReadOutput> {
    const resolved = this.resolveConfig(input.sourceVenue);
    const status = this.getStatus(input.sourceVenue);
    if (!status.configured) {
      throw new LimitlessWithdrawalEvidenceReadNotConfiguredError(`${input.sourceVenue} withdrawal evidence read is disabled or incomplete.`);
    }

    if (input.sourceVenue === "POLYMARKET" && resolved.readMode === "POLYGON_ONCHAIN") {
      if (!resolved.polygonRpcUrl) {
        throw new LimitlessWithdrawalEvidenceReadNotConfiguredError("POLYMARKET on-chain withdrawal evidence RPC URL is not configured.");
      }
      return this.readPolymarketOnchainEvidence(input, {
        polygonRpcUrl: resolved.polygonRpcUrl,
        bridgeStatusBaseUrl: resolved.bridgeStatusBaseUrl,
        usdcTokenAddress: resolved.usdcTokenAddress,
        minimumConfirmations: resolved.minimumConfirmations,
        fetchImpl: resolved.fetchImpl
      });
    }

    if (input.sourceVenue === "PREDICT_FUN" && resolved.readMode === "BSC_ONCHAIN") {
      if (!resolved.bscRpcUrl) {
        throw new LimitlessWithdrawalEvidenceReadNotConfiguredError("PREDICT_FUN BSC withdrawal evidence RPC URL is not configured.");
      }
      return this.readPredictFunBscOnchainEvidence(input, {
        bscRpcUrl: resolved.bscRpcUrl,
        usdtTokenAddress: resolved.usdtTokenAddress,
        minimumConfirmations: resolved.minimumConfirmations,
        fetchImpl: resolved.fetchImpl
      });
    }

    if (input.sourceVenue === "OPINION" && resolved.readMode === "BSC_ONCHAIN") {
      if (!resolved.bscRpcUrl) {
        throw new LimitlessWithdrawalEvidenceReadNotConfiguredError("OPINION BSC USDT withdrawal evidence RPC URL is not configured.");
      }
      return this.readOpinionBscOnchainEvidence(input, {
        bscRpcUrl: resolved.bscRpcUrl,
        usdtTokenAddress: resolved.usdtTokenAddress,
        minimumConfirmations: resolved.minimumConfirmations,
        fetchImpl: resolved.fetchImpl
      });
    }

    if (input.sourceVenue === "MYRIAD" && resolved.readMode === "BSC_ONCHAIN") {
      if (!resolved.bscRpcUrl || !resolved.usd1TokenAddress) {
        throw new LimitlessWithdrawalEvidenceReadNotConfiguredError("MYRIAD BSC USD1 withdrawal evidence RPC URL or token address is not configured.");
      }
      return this.readMyriadBscOnchainEvidence(input, {
        bscRpcUrl: resolved.bscRpcUrl,
        usd1TokenAddress: resolved.usd1TokenAddress,
        minimumConfirmations: resolved.minimumConfirmations,
        fetchImpl: resolved.fetchImpl
      });
    }

    if (!resolved.fixturePath) {
      throw new LimitlessWithdrawalEvidenceReadNotConfiguredError(`${input.sourceVenue} withdrawal evidence fixture path is not configured.`);
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
    readMode: InternalWithdrawalEvidenceReadMode;
    fixturePath?: string | undefined;
    polygonRpcUrl?: string | undefined;
    bscRpcUrl?: string | undefined;
    bridgeStatusBaseUrl?: string | undefined;
    usdcTokenAddress: string;
    usdtTokenAddress: string;
    usd1TokenAddress?: string | undefined;
    minimumConfirmations: number;
    fetchImpl: typeof fetch;
  } {
    if (this.config.venue) {
      return {
        enabled: this.config.enabled === true,
        readMode: this.config.readMode ?? "FIXTURE",
        fixturePath: this.config.fixturePath,
        polygonRpcUrl: this.config.polygonRpcUrl,
        bscRpcUrl: this.config.bscRpcUrl,
        bridgeStatusBaseUrl: this.config.bridgeStatusBaseUrl,
        usdcTokenAddress: this.config.usdcTokenAddress ?? POLYGON_USDC_TOKEN_ADDRESS,
        usdtTokenAddress: this.config.usdtTokenAddress ?? BSC_USDT_TOKEN_ADDRESS,
        usd1TokenAddress: this.config.usd1TokenAddress,
        minimumConfirmations: this.config.minimumConfirmations ?? 1,
        fetchImpl: this.config.fetchImpl ?? fetch
      };
    }
    const env = this.config.env ?? process.env;
    return {
      enabled: env[`${venue}_INTERNAL_WITHDRAWAL_EVIDENCE_READ_ENABLED`] === "true",
      readMode: readModeFromEnv(env[`${venue}_INTERNAL_WITHDRAWAL_EVIDENCE_READ_MODE`]),
      fixturePath: env[`${venue}_INTERNAL_WITHDRAWAL_EVIDENCE_FIXTURE_PATH`],
      polygonRpcUrl: env[`${venue}_INTERNAL_WITHDRAWAL_EVIDENCE_POLYGON_RPC_URL`],
      bscRpcUrl: env[`${venue}_INTERNAL_WITHDRAWAL_EVIDENCE_BSC_RPC_URL`],
      bridgeStatusBaseUrl: env[`${venue}_INTERNAL_WITHDRAWAL_EVIDENCE_BRIDGE_STATUS_BASE_URL`],
      usdcTokenAddress: env[`${venue}_INTERNAL_WITHDRAWAL_EVIDENCE_USDC_ADDRESS`] ?? POLYGON_USDC_TOKEN_ADDRESS,
      usdtTokenAddress: env[`${venue}_INTERNAL_WITHDRAWAL_EVIDENCE_USDT_ADDRESS`] ?? BSC_USDT_TOKEN_ADDRESS,
      usd1TokenAddress: env[`${venue}_INTERNAL_WITHDRAWAL_EVIDENCE_USD1_ADDRESS`],
      minimumConfirmations: positiveInt(env[`${venue}_WITHDRAWAL_MIN_CONFIRMATIONS`], 1),
      fetchImpl: this.config.fetchImpl ?? fetch
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

  private async readPolymarketOnchainEvidence(
    input: InternalWithdrawalEvidenceReadInput,
    config: {
      polygonRpcUrl: string;
      bridgeStatusBaseUrl?: string | undefined;
      usdcTokenAddress: string;
      minimumConfirmations: number;
      fetchImpl: typeof fetch;
    }
  ): Promise<InternalWithdrawalEvidenceReadOutput> {
    const receipt = await rpcCall(config, "eth_getTransactionReceipt", [input.withdrawalTxHash]);
    if (!isRecord(receipt)) {
      return {
        sourceVenue: input.sourceVenue,
        withdrawalTxHash: input.withdrawalTxHash,
        status: "PENDING",
        venueReleased: false,
        destinationReceived: false,
        completed: false,
        reason: "POLYMARKET_WITHDRAWAL_ONCHAIN_RECEIPT_PENDING"
      };
    }
    const txStatus = stringValue(receipt.status);
    if (txStatus !== "0x1") {
      return {
        sourceVenue: input.sourceVenue,
        withdrawalTxHash: input.withdrawalTxHash,
        status: "FAILED",
        venueReleased: false,
        destinationReceived: false,
        completed: false,
        reason: "POLYMARKET_WITHDRAWAL_ONCHAIN_TX_FAILED"
      };
    }
    const transfer = findUsdcTransfer(receipt, config.usdcTokenAddress);
    if (!transfer) {
      return {
        sourceVenue: input.sourceVenue,
        withdrawalTxHash: input.withdrawalTxHash,
        status: "UNKNOWN",
        venueReleased: false,
        destinationReceived: false,
        completed: false,
        reason: "POLYMARKET_WITHDRAWAL_ONCHAIN_USDC_TRANSFER_NOT_FOUND"
      };
    }
    const currentBlockHex = await rpcCall(config, "eth_blockNumber", []);
    const currentBlock = hexToBigInt(stringValue(currentBlockHex));
    const txBlock = hexToBigInt(stringValue(receipt.blockNumber));
    const confirmations = currentBlock !== null && txBlock !== null && currentBlock >= txBlock
      ? Number(currentBlock - txBlock + 1n)
      : 0;
    const enoughConfirmations = confirmations >= config.minimumConfirmations;
    const bridgeStatus = enoughConfirmations
      ? await this.readPolymarketBridgeStatus(config, transfer.to)
      : null;
    if (bridgeStatus?.status === "COMPLETED") {
      return {
        sourceVenue: input.sourceVenue,
        withdrawalTxHash: input.withdrawalTxHash,
        status: "UNKNOWN",
        venueReleased: true,
        destinationReceived: false,
        completed: false,
        destinationChain: chainNameFromBridgeChainId(bridgeStatus.toChainId) ?? "POLYGON",
        token: tokenSymbolFromBridgeToken(bridgeStatus.toTokenAddress) ?? "USDC",
        amount: bridgeStatus.amount ?? transfer.amount,
        confirmations,
        ...(stringValue(transfer.observedAt) ? { observedAt: transfer.observedAt } : {}),
        recoveryReviewRequired: true,
        recoveryReason: "POLYMARKET_BRIDGE_COMPLETED_AGGREGATE_WITHOUT_EXACT_DESTINATION_SCOPE",
        bridgeAddress: transfer.to,
        bridgeStatus: bridgeStatus.status,
        ...(bridgeStatus.amount ? { bridgeAmount: bridgeStatus.amount } : {}),
        ...(bridgeStatus.txHash ? { bridgeTxHash: bridgeStatus.txHash } : {}),
        reason: "POLYMARKET_WITHDRAWAL_BRIDGE_AGGREGATE_COMPLETION_REVIEW_REQUIRED"
      };
    }
    return {
      sourceVenue: input.sourceVenue,
      withdrawalTxHash: input.withdrawalTxHash,
      status: enoughConfirmations ? "VENUE_RELEASED" : "PENDING",
      venueReleased: enoughConfirmations,
      destinationReceived: false,
      completed: false,
      destinationChain: "POLYGON",
      destinationWalletAddress: transfer.from,
      token: "USDC",
      amount: transfer.amount,
      confirmations,
      ...(stringValue(transfer.observedAt) ? { observedAt: transfer.observedAt } : {}),
      reason: enoughConfirmations
        ? bridgeStatus?.status
          ? `POLYMARKET_WITHDRAWAL_BRIDGE_STATUS_${bridgeStatus.status}`
          : "POLYMARKET_WITHDRAWAL_ONCHAIN_BRIDGE_TRANSFER_CONFIRMED"
        : "POLYMARKET_WITHDRAWAL_ONCHAIN_CONFIRMATIONS_PENDING"
    };
  }

  private async readPolymarketBridgeStatus(
    config: {
      bridgeStatusBaseUrl?: string | undefined;
      fetchImpl: typeof fetch;
    },
    bridgeAddress: string
  ): Promise<PolymarketBridgeStatusSummary | null> {
    const baseUrl = (config.bridgeStatusBaseUrl ?? POLYMARKET_BRIDGE_STATUS_BASE_URL).replace(/\/+$/, "");
    try {
      const response = await config.fetchImpl(`${baseUrl}/status/${bridgeAddress}`, { method: "GET" });
      if (!response.ok) {
        return null;
      }
      const payload = await response.json() as unknown;
      if (!isRecord(payload) || !Array.isArray(payload.transactions)) {
        return null;
      }
      return normalizeBridgeStatusTransaction(payload.transactions.filter(isRecord));
    } catch {
      return null;
    }
  }

  private async readPredictFunBscOnchainEvidence(
    input: InternalWithdrawalEvidenceReadInput,
    config: {
      bscRpcUrl: string;
      usdtTokenAddress: string;
      minimumConfirmations: number;
      fetchImpl: typeof fetch;
    }
  ): Promise<InternalWithdrawalEvidenceReadOutput> {
    const receipt = await rpcCall({
      rpcUrl: config.bscRpcUrl,
      fetchImpl: config.fetchImpl,
      chainName: "BSC"
    }, "eth_getTransactionReceipt", [input.withdrawalTxHash]);
    if (!isRecord(receipt)) {
      return {
        sourceVenue: input.sourceVenue,
        withdrawalTxHash: input.withdrawalTxHash,
        status: "PENDING",
        venueReleased: false,
        destinationReceived: false,
        completed: false,
        reason: "PREDICT_FUN_WITHDRAWAL_BSC_RECEIPT_PENDING"
      };
    }
    if (stringValue(receipt.status) !== "0x1") {
      return {
        sourceVenue: input.sourceVenue,
        withdrawalTxHash: input.withdrawalTxHash,
        status: "FAILED",
        venueReleased: false,
        destinationReceived: false,
        completed: false,
        reason: "PREDICT_FUN_WITHDRAWAL_BSC_TX_FAILED"
      };
    }
    const transfer = findErc20Transfer(receipt, config.usdtTokenAddress);
    if (!transfer) {
      return {
        sourceVenue: input.sourceVenue,
        withdrawalTxHash: input.withdrawalTxHash,
        status: "UNKNOWN",
        venueReleased: false,
        destinationReceived: false,
        completed: false,
        reason: "PREDICT_FUN_WITHDRAWAL_BSC_USDT_TRANSFER_NOT_FOUND"
      };
    }
    const currentBlockHex = await rpcCall({
      rpcUrl: config.bscRpcUrl,
      fetchImpl: config.fetchImpl,
      chainName: "BSC"
    }, "eth_blockNumber", []);
    const currentBlock = hexToBigInt(stringValue(currentBlockHex));
    const txBlock = hexToBigInt(stringValue(receipt.blockNumber));
    const confirmations = currentBlock !== null && txBlock !== null && currentBlock >= txBlock
      ? Number(currentBlock - txBlock + 1n)
      : 0;
    const enoughConfirmations = confirmations >= config.minimumConfirmations;
    return {
      sourceVenue: input.sourceVenue,
      withdrawalTxHash: input.withdrawalTxHash,
      status: enoughConfirmations ? "COMPLETED" : "DESTINATION_RECEIVED",
      venueReleased: enoughConfirmations,
      destinationReceived: true,
      completed: enoughConfirmations,
      destinationChain: "BSC",
      destinationWalletAddress: transfer.to,
      token: "USDT",
      amount: transfer.amount,
      confirmations,
      ...(stringValue(transfer.observedAt) ? { observedAt: transfer.observedAt } : {}),
      reason: enoughConfirmations
        ? "PREDICT_FUN_WITHDRAWAL_BSC_USDT_DESTINATION_CONFIRMED"
        : "PREDICT_FUN_WITHDRAWAL_BSC_CONFIRMATIONS_PENDING"
    };
  }

  private async readMyriadBscOnchainEvidence(
    input: InternalWithdrawalEvidenceReadInput,
    config: {
      bscRpcUrl: string;
      usd1TokenAddress: string;
      minimumConfirmations: number;
      fetchImpl: typeof fetch;
    }
  ): Promise<InternalWithdrawalEvidenceReadOutput> {
    const receipt = await rpcCall({
      rpcUrl: config.bscRpcUrl,
      fetchImpl: config.fetchImpl,
      chainName: "BSC"
    }, "eth_getTransactionReceipt", [input.withdrawalTxHash]);
    if (!isRecord(receipt)) {
      return {
        sourceVenue: input.sourceVenue,
        withdrawalTxHash: input.withdrawalTxHash,
        status: "PENDING",
        venueReleased: false,
        destinationReceived: false,
        completed: false,
        reason: "MYRIAD_WITHDRAWAL_BSC_RECEIPT_PENDING"
      };
    }
    if (stringValue(receipt.status) !== "0x1") {
      return {
        sourceVenue: input.sourceVenue,
        withdrawalTxHash: input.withdrawalTxHash,
        status: "FAILED",
        venueReleased: false,
        destinationReceived: false,
        completed: false,
        reason: "MYRIAD_WITHDRAWAL_BSC_TX_FAILED"
      };
    }
    const transfer = findErc20Transfer(receipt, config.usd1TokenAddress, 18);
    if (!transfer) {
      return {
        sourceVenue: input.sourceVenue,
        withdrawalTxHash: input.withdrawalTxHash,
        status: "UNKNOWN",
        venueReleased: false,
        destinationReceived: false,
        completed: false,
        reason: "MYRIAD_WITHDRAWAL_BSC_USD1_TRANSFER_NOT_FOUND"
      };
    }
    const currentBlockHex = await rpcCall({
      rpcUrl: config.bscRpcUrl,
      fetchImpl: config.fetchImpl,
      chainName: "BSC"
    }, "eth_blockNumber", []);
    const currentBlock = hexToBigInt(stringValue(currentBlockHex));
    const txBlock = hexToBigInt(stringValue(receipt.blockNumber));
    const confirmations = currentBlock !== null && txBlock !== null && currentBlock >= txBlock
      ? Number(currentBlock - txBlock + 1n)
      : 0;
    const enoughConfirmations = confirmations >= config.minimumConfirmations;
    return {
      sourceVenue: input.sourceVenue,
      withdrawalTxHash: input.withdrawalTxHash,
      status: enoughConfirmations ? "COMPLETED" : "DESTINATION_RECEIVED",
      venueReleased: enoughConfirmations,
      destinationReceived: true,
      completed: enoughConfirmations,
      destinationChain: "BSC",
      destinationWalletAddress: transfer.to,
      token: "USD1",
      amount: transfer.amount,
      confirmations,
      ...(stringValue(transfer.observedAt) ? { observedAt: transfer.observedAt } : {}),
      reason: enoughConfirmations
        ? "MYRIAD_WITHDRAWAL_BSC_USD1_DESTINATION_CONFIRMED"
        : "MYRIAD_WITHDRAWAL_BSC_CONFIRMATIONS_PENDING"
    };
  }

  private async readOpinionBscOnchainEvidence(
    input: InternalWithdrawalEvidenceReadInput,
    config: {
      bscRpcUrl: string;
      usdtTokenAddress: string;
      minimumConfirmations: number;
      fetchImpl: typeof fetch;
    }
  ): Promise<InternalWithdrawalEvidenceReadOutput> {
    const receipt = await rpcCall({
      rpcUrl: config.bscRpcUrl,
      fetchImpl: config.fetchImpl,
      chainName: "BSC"
    }, "eth_getTransactionReceipt", [input.withdrawalTxHash]);
    if (!isRecord(receipt)) {
      return {
        sourceVenue: input.sourceVenue,
        withdrawalTxHash: input.withdrawalTxHash,
        status: "PENDING",
        venueReleased: false,
        destinationReceived: false,
        completed: false,
        reason: "OPINION_WITHDRAWAL_BSC_RECEIPT_PENDING"
      };
    }
    if (stringValue(receipt.status) !== "0x1") {
      return {
        sourceVenue: input.sourceVenue,
        withdrawalTxHash: input.withdrawalTxHash,
        status: "FAILED",
        venueReleased: false,
        destinationReceived: false,
        completed: false,
        reason: "OPINION_WITHDRAWAL_BSC_TX_FAILED"
      };
    }
    const transfer = findErc20Transfer(receipt, config.usdtTokenAddress, 18);
    if (!transfer) {
      return {
        sourceVenue: input.sourceVenue,
        withdrawalTxHash: input.withdrawalTxHash,
        status: "UNKNOWN",
        venueReleased: false,
        destinationReceived: false,
        completed: false,
        reason: "OPINION_WITHDRAWAL_BSC_USDT_TRANSFER_NOT_FOUND"
      };
    }
    const currentBlockHex = await rpcCall({
      rpcUrl: config.bscRpcUrl,
      fetchImpl: config.fetchImpl,
      chainName: "BSC"
    }, "eth_blockNumber", []);
    const currentBlock = hexToBigInt(stringValue(currentBlockHex));
    const txBlock = hexToBigInt(stringValue(receipt.blockNumber));
    const confirmations = currentBlock !== null && txBlock !== null && currentBlock >= txBlock
      ? Number(currentBlock - txBlock + 1n)
      : 0;
    const enoughConfirmations = confirmations >= config.minimumConfirmations;
    return {
      sourceVenue: input.sourceVenue,
      withdrawalTxHash: input.withdrawalTxHash,
      status: enoughConfirmations ? "COMPLETED" : "DESTINATION_RECEIVED",
      venueReleased: enoughConfirmations,
      destinationReceived: true,
      completed: enoughConfirmations,
      destinationChain: "BSC",
      destinationWalletAddress: transfer.to,
      token: "USDT",
      amount: transfer.amount,
      confirmations,
      ...(stringValue(transfer.observedAt) ? { observedAt: transfer.observedAt } : {}),
      reason: enoughConfirmations
        ? "OPINION_WITHDRAWAL_BSC_USDT_DESTINATION_CONFIRMED"
        : "OPINION_WITHDRAWAL_BSC_CONFIRMATIONS_PENDING"
    };
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

const POLYGON_USDC_TOKEN_ADDRESS = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359";
const BSC_USDT_TOKEN_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";
const POLYMARKET_BRIDGE_STATUS_BASE_URL = "https://bridge.polymarket.com";
const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const readModeFromEnv = (value: string | undefined): InternalWithdrawalEvidenceReadMode =>
  value?.trim().toUpperCase() === "POLYGON_ONCHAIN"
    ? "POLYGON_ONCHAIN"
    : value?.trim().toUpperCase() === "BSC_ONCHAIN"
      ? "BSC_ONCHAIN"
      : "FIXTURE";

const positiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const rpcCall = async (
  config: {
    polygonRpcUrl?: string;
    rpcUrl?: string;
    fetchImpl: typeof fetch;
    chainName?: string;
  },
  method: string,
  params: unknown[]
): Promise<unknown> => {
  const rpcUrl = config.rpcUrl ?? config.polygonRpcUrl;
  const chainName = config.chainName ?? "Polygon";
  if (!rpcUrl) {
    throw new LimitlessWithdrawalEvidenceReadNotConfiguredError(`${chainName} RPC URL is not configured.`);
  }
  const response = await config.fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params
    })
  });
  if (!response.ok) {
    throw new LimitlessWithdrawalEvidenceNotFoundError(`${chainName} RPC evidence read failed.`);
  }
  const payload = await response.json() as unknown;
  if (!isRecord(payload)) {
    throw new LimitlessWithdrawalEvidenceMalformedError(`${chainName} RPC response is malformed.`);
  }
  if (payload.error) {
    throw new LimitlessWithdrawalEvidenceNotFoundError(`${chainName} RPC returned an error.`);
  }
  return payload.result;
};

const findUsdcTransfer = (
  receipt: Record<string, unknown>,
  usdcTokenAddress: string
): { from: string; to: string; amount: string; observedAt?: string } | null => {
  return findErc20Transfer(receipt, usdcTokenAddress);
};

const findErc20Transfer = (
  receipt: Record<string, unknown>,
  tokenAddress: string,
  tokenDecimals = 6
): { from: string; to: string; amount: string; observedAt?: string } | null => {
  const logs = Array.isArray(receipt.logs) ? receipt.logs.filter(isRecord) : [];
  for (const log of logs) {
    const topics = Array.isArray(log.topics) ? log.topics : [];
    if (!equalsIgnoreCase(stringValue(log.address), tokenAddress) ||
      !equalsIgnoreCase(typeof topics[0] === "string" ? topics[0] : undefined, ERC20_TRANSFER_TOPIC)) {
      continue;
    }
    const from = addressFromTopic(typeof topics[1] === "string" ? topics[1] : undefined);
    const to = addressFromTopic(typeof topics[2] === "string" ? topics[2] : undefined);
    const amount = amountFromErc20Data(stringValue(log.data), tokenDecimals);
    if (from && to && amount) {
      const parsed = {
        from,
        to,
        amount
      };
      const observedAt = hexTimestampToIso(stringValue(log.blockTimestamp));
      return observedAt ? { ...parsed, observedAt } : parsed;
    }
  }
  return null;
};

const addressFromTopic = (topic: string | undefined): string | null => {
  if (!topic || !/^0x[a-fA-F0-9]{64}$/.test(topic)) {
    return null;
  }
  return `0x${topic.slice(-40)}`;
};

const amountFromErc20Data = (data: string | undefined, decimals: number): string | null => {
  const value = hexToBigInt(data);
  if (value === null) {
    return null;
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    return null;
  }
  const divisor = 10n ** BigInt(decimals);
  const units = value / divisor;
  const remainder = value % divisor;
  if (remainder === 0n) {
    return units.toString();
  }
  return `${units.toString()}.${remainder.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
};

const hexToBigInt = (value: string | undefined): bigint | null => {
  if (!value || !/^0x[a-fA-F0-9]+$/.test(value)) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
};

const hexTimestampToIso = (value: string | undefined): string | undefined => {
  const timestamp = hexToBigInt(value);
  if (timestamp === null) {
    return undefined;
  }
  return new Date(Number(timestamp) * 1000).toISOString();
};

interface PolymarketBridgeStatusSummary {
  status: string;
  toChainId?: string;
  toTokenAddress?: string;
  amount?: string;
  txHash?: string;
}

const normalizeBridgeStatusTransaction = (
  transactions: Record<string, unknown>[]
): PolymarketBridgeStatusSummary | null => {
  const candidates: PolymarketBridgeStatusSummary[] = [];
  for (const transaction of transactions) {
    const status = stringValue(transaction.status)?.toUpperCase();
    if (!status) {
      continue;
    }
    candidates.push(compactBridgeStatusSummary({
      status,
      toChainId: stringValue(transaction.toChainId),
      toTokenAddress: stringValue(transaction.toTokenAddress),
      amount: amountFromUsdcBaseUnit(stringValue(transaction.fromAmountBaseUnit)),
      txHash: stringValue(transaction.txHash)
    }));
  }
  return candidates.find((transaction) => transaction.status === "COMPLETED") ??
    candidates.find((transaction) => transaction.status === "PROCESSING") ??
    candidates.find((transaction) => transaction.status === "DEPOSIT_DETECTED") ??
    null;
};

const compactBridgeStatusSummary = (input: {
  status: string;
  toChainId?: string | undefined;
  toTokenAddress?: string | undefined;
  amount?: string | undefined;
  txHash?: string | undefined;
}): PolymarketBridgeStatusSummary => ({
  status: input.status,
  ...(input.toChainId ? { toChainId: input.toChainId } : {}),
  ...(input.toTokenAddress ? { toTokenAddress: input.toTokenAddress } : {}),
  ...(input.amount ? { amount: input.amount } : {}),
  ...(input.txHash ? { txHash: input.txHash } : {})
});

const amountFromUsdcBaseUnit = (value: string | undefined): string | undefined => {
  if (!value || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = BigInt(value);
  const units = parsed / 1_000_000n;
  const remainder = parsed % 1_000_000n;
  if (remainder === 0n) {
    return units.toString();
  }
  return `${units.toString()}.${remainder.toString().padStart(6, "0").replace(/0+$/, "")}`;
};

const chainNameFromBridgeChainId = (chainId: string | undefined): string | undefined => {
  switch (chainId) {
    case "137":
      return "POLYGON";
    case "1":
      return "ETHEREUM";
    case "8453":
      return "BASE";
    case "42161":
      return "ARBITRUM";
    case "1151111081099710":
      return "SOLANA";
    default:
      return undefined;
  }
};

const tokenSymbolFromBridgeToken = (tokenAddress: string | undefined): string | undefined =>
  tokenAddress ? "USDC" : undefined;
