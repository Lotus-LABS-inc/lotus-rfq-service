import Decimal from "decimal.js";
import { Wallet } from "@ethersproject/wallet";
import {
  AssetType,
  COLLATERAL_TOKEN_DECIMALS,
  Chain,
  ClobClient,
  SignatureTypeV2,
  type ApiKeyCreds,
  type BalanceAllowanceResponse,
  type ClobClientOptions
} from "@polymarket/clob-client-v2";

type DecimalValue = InstanceType<typeof Decimal>;

export interface PolymarketFundingBalanceReadInput {
  userId: string;
  fundingIntentId: string;
  routeLegId: string;
}

export interface PolymarketFundingBalanceReadOutput {
  usableBalance: string;
  collateralBalance: string;
  collateralAllowance: string;
  clobAllowanceSpenders: PolymarketClobAllowanceSpender[];
  approvalSpenderSource: "CLOB_ALLOWANCE_MAP" | "CONFIG_FALLBACK" | "UNAVAILABLE";
  onchainPusdBalance: string | null;
  onchainPusdAllowance: string | null;
  bridgedUsdcBalance: string | null;
  usableBalanceSource: "CLOB_COLLATERAL_ALLOWANCE" | "ONCHAIN_PUSD_ALLOWANCE" | "ONCHAIN_PUSD" | "ONCHAIN_BRIDGED_USDC";
}

export interface PolymarketClobAllowanceSpender {
  spenderAddress: string;
  allowance: string;
}

export interface PolymarketFundingBalanceReadStatus {
  enabled: boolean;
  configured: boolean;
  missingEnv: readonly string[];
  hostConfigured: boolean;
  credentialsServerSideOnly: true;
}

export interface PolymarketFundingBalanceReadServiceConfig {
  enabled: boolean;
  clobHost?: string | undefined;
  chainId?: string | undefined;
  apiKey?: string | undefined;
  apiSecret?: string | undefined;
  apiPassphrase?: string | undefined;
  privateKey?: string | undefined;
  signatureType?: string | undefined;
  funderAddress?: string | undefined;
  onchainFallbackEnabled?: boolean | undefined;
  polygonRpcUrl?: string | undefined;
  pusdTokenAddress?: string | undefined;
  pusdApprovalSpenderAddress?: string | undefined;
  negRiskPusdApprovalSpenderAddress?: string | undefined;
  bridgedUsdcTokenAddress?: string | undefined;
  recognizeBridgedUsdcAsUsable?: boolean | undefined;
  requireUserDepositWallet?: boolean | undefined;
}

export interface PolymarketBalanceAllowanceClient {
  getBalanceAllowance(params: { asset_type: AssetType; token_id?: string }): Promise<BalanceAllowanceResponse>;
  updateBalanceAllowance?(params: { asset_type: AssetType; token_id?: string }): Promise<unknown>;
}

export type PolymarketBalanceAllowanceClientFactory = (
  config: PolymarketFundingBalanceReadServiceConfig
) => PolymarketBalanceAllowanceClient;

export interface PolymarketFundingVenueAccountReader {
  findAccount(input: { userId: string; venue: "POLYMARKET" }): Promise<{
    status: string;
    venueAccountAddress: string | null;
  } | null>;
}

export class PolymarketFundingBalanceReadNotConfiguredError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PolymarketFundingBalanceReadNotConfiguredError";
  }
}

export class PolymarketFundingBalanceReadAccountUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PolymarketFundingBalanceReadAccountUnavailableError";
  }
}

const requiredEnvKeys = [
  "POLYMARKET_CLOB_HOST",
  "POLYMARKET_CHAIN_ID",
  "POLYMARKET_API_KEY",
  "POLYMARKET_API_SECRET",
  "POLYMARKET_API_PASSPHRASE",
  "POLYMARKET_PRIVATE_KEY"
] as const;

const legacyEnvAliases = {
  POLYMARKET_CLOB_HOST: "POLY_CLOB_HOST",
  POLYMARKET_CHAIN_ID: "POLY_CHAIN_ID",
  POLYMARKET_API_KEY: "POLY_API_KEY",
  POLYMARKET_API_SECRET: "POLY_API_SECRET",
  POLYMARKET_API_PASSPHRASE: "POLY_API_PASSPHRASE",
  POLYMARKET_PRIVATE_KEY: "POLY_PRIVATE_KEY"
} as const;

const nonEmpty = (value: string | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;

const firstNonEmpty = (...values: Array<string | undefined>): string | undefined =>
  values.find((value) => nonEmpty(value))?.trim();

const readPolymarketEnv = (
  env: NodeJS.ProcessEnv,
  key: (typeof requiredEnvKeys)[number]
): string | undefined =>
  env[key] ?? env[legacyEnvAliases[key]];

const parseChain = (value: string | undefined): Chain => {
  if (value === String(Chain.AMOY)) {
    return Chain.AMOY;
  }
  return Chain.POLYGON;
};

const parseSignatureType = (value: string | undefined): SignatureTypeV2 => {
  const normalized = `${value ?? "POLY_PROXY"}`.trim().toUpperCase();
  if (normalized === "EOA" || normalized === "0") {
    return SignatureTypeV2.EOA;
  }
  if (normalized === "POLY_GNOSIS_SAFE" || normalized === "GNOSIS_SAFE" || normalized === "2") {
    return SignatureTypeV2.POLY_GNOSIS_SAFE;
  }
  if (normalized === "POLY_1271" || normalized === "1271" || normalized === "3") {
    return SignatureTypeV2.POLY_1271;
  }
  return SignatureTypeV2.POLY_PROXY;
};

const toDecimal = (value: string) => {
  const parsed = new Decimal(value);
  if (!parsed.isFinite() || parsed.isNegative()) {
    throw new Error("Polymarket collateral balance response was not a finite non-negative amount.");
  }
  return parsed;
};

const collateralAtomicUnitsToUsdc = (value: string) =>
  toDecimal(value).div(new Decimal(10).pow(COLLATERAL_TOKEN_DECIMALS));

const clobAllowanceSpendersFromResponse = (
  response: BalanceAllowanceResponse
): Array<{ spenderAddress: string; allowanceAtomic: string; allowance: DecimalValue }> => {
  const allowances = (response as unknown as { allowances?: unknown }).allowances;
  if (!allowances || typeof allowances !== "object" || Array.isArray(allowances)) {
    return [];
  }
  return Object.entries(allowances).map(([spenderAddress, value]) => {
    if (!isHexAddress(spenderAddress) || typeof value !== "string" || value.trim().length === 0) {
      throw new Error("Polymarket collateral allowance response included a malformed allowance spender.");
    }
    const allowanceAtomic = toDecimal(value.trim()).toFixed();
    return {
      spenderAddress,
      allowanceAtomic,
      allowance: collateralAtomicUnitsToUsdc(allowanceAtomic)
    };
  });
};

const collateralAllowanceAtomicUnits = (response: BalanceAllowanceResponse): string => {
  if (nonEmpty(response.allowance)) {
    return response.allowance!;
  }

  const allowanceSpenders = clobAllowanceSpendersFromResponse(response);
  if (allowanceSpenders.length === 0) {
    throw new Error("Polymarket collateral balance response did not include an allowance.");
  }
  return Decimal.min(...allowanceSpenders.map((spender) => toDecimal(spender.allowanceAtomic))).toFixed();
};

const decimalToPlainString = (value: ReturnType<typeof toDecimal>): string =>
  value.toDecimalPlaces(COLLATERAL_TOKEN_DECIMALS, Decimal.ROUND_DOWN).toFixed();

const defaultPusdTokenAddress = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB";
const defaultPolygonBridgedUsdcTokenAddress = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";

const configuredApprovalSpenders = (config: PolymarketFundingBalanceReadServiceConfig): string[] =>
  uniqueHexAddresses([
    config.pusdApprovalSpenderAddress,
    config.negRiskPusdApprovalSpenderAddress
  ]);

const uniqueHexAddresses = (addresses: Array<string | undefined | null>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const address of addresses) {
    const candidate = address ?? undefined;
    if (!isHexAddress(candidate)) {
      continue;
    }
    const normalized = candidate.trim();
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }
  return result;
};

export const buildPolymarketFundingBalanceReadConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): PolymarketFundingBalanceReadServiceConfig => ({
  enabled: env.POLYMARKET_INTERNAL_BALANCE_READ_ENABLED === "true",
  clobHost: readPolymarketEnv(env, "POLYMARKET_CLOB_HOST"),
  chainId: readPolymarketEnv(env, "POLYMARKET_CHAIN_ID"),
  apiKey: readPolymarketEnv(env, "POLYMARKET_API_KEY"),
  apiSecret: readPolymarketEnv(env, "POLYMARKET_API_SECRET"),
  apiPassphrase: readPolymarketEnv(env, "POLYMARKET_API_PASSPHRASE"),
  privateKey: readPolymarketEnv(env, "POLYMARKET_PRIVATE_KEY"),
  signatureType: env.POLYMARKET_SIGNATURE_TYPE ?? env.POLY_SIGNATURE_TYPE,
  funderAddress: firstNonEmpty(env.POLYMARKET_FUNDER_ADDRESS, env.POLY_FUNDER_ADDRESS),
  onchainFallbackEnabled: env.POLYMARKET_FUNDING_READ_ONCHAIN_FALLBACK_ENABLED !== "false",
  polygonRpcUrl: firstNonEmpty(env.POLYMARKET_POLYGON_RPC_URL, env.POLYGON_RPC_URL) ?? "https://polygon-bor-rpc.publicnode.com",
  pusdTokenAddress: firstNonEmpty(env.POLYMARKET_BALANCE_ACTIVATION_TOKEN_ADDRESS) ?? defaultPusdTokenAddress,
  pusdApprovalSpenderAddress: firstNonEmpty(env.POLYMARKET_BALANCE_ACTIVATION_SPENDER_ADDRESS),
  negRiskPusdApprovalSpenderAddress: firstNonEmpty(env.POLYMARKET_NEG_RISK_BALANCE_ACTIVATION_SPENDER_ADDRESS),
  bridgedUsdcTokenAddress: firstNonEmpty(env.POLYMARKET_BRIDGED_USDC_TOKEN_ADDRESS, env.POLYGON_USDC_TOKEN_ADDRESS) ?? defaultPolygonBridgedUsdcTokenAddress,
  recognizeBridgedUsdcAsUsable: env.POLYMARKET_RECOGNIZE_BRIDGED_USDC_AS_USABLE !== "false",
  requireUserDepositWallet: env.POLYMARKET_DEPOSIT_WALLET_AUTOMATION_ENABLED === "true" ||
    env.POLYMARKET_FUNDING_DESTINATION_MODE === "USER_VENUE_DEPOSIT_WALLET"
});

export const getPolymarketFundingBalanceReadStatus = (
  config: PolymarketFundingBalanceReadServiceConfig
): PolymarketFundingBalanceReadStatus => {
  const missingEnv = [
    !nonEmpty(config.clobHost) ? "POLYMARKET_CLOB_HOST" : null,
    !nonEmpty(config.chainId) ? "POLYMARKET_CHAIN_ID" : null,
    !nonEmpty(config.apiKey) ? "POLYMARKET_API_KEY" : null,
    !nonEmpty(config.apiSecret) ? "POLYMARKET_API_SECRET" : null,
    !nonEmpty(config.apiPassphrase) ? "POLYMARKET_API_PASSPHRASE" : null,
    !nonEmpty(config.privateKey) ? "POLYMARKET_PRIVATE_KEY" : null
  ].filter((value): value is string => value !== null);

  return {
    enabled: config.enabled,
    configured: config.enabled && missingEnv.length === 0,
    missingEnv,
    hostConfigured: nonEmpty(config.clobHost),
    credentialsServerSideOnly: true
  };
};

export const createPolymarketBalanceAllowanceClient: PolymarketBalanceAllowanceClientFactory = (config) => {
  const status = getPolymarketFundingBalanceReadStatus(config);
  if (!status.configured) {
    throw new PolymarketFundingBalanceReadNotConfiguredError(
      `Polymarket balance read is not configured: ${status.missingEnv.join(", ")}.`
    );
  }

  const creds: ApiKeyCreds = {
    key: config.apiKey!,
    secret: config.apiSecret!,
    passphrase: config.apiPassphrase!
  };
  const options: ClobClientOptions = {
    host: config.clobHost!,
    chain: parseChain(config.chainId),
    signer: new Wallet(config.privateKey!),
    creds,
    signatureType: parseSignatureType(config.signatureType),
    retryOnError: false,
    throwOnError: true
  };
  if (nonEmpty(config.funderAddress)) {
    options.funderAddress = config.funderAddress!;
  }
  return new ClobClient(options);
};

export class PolymarketFundingBalanceReadService {
  public constructor(
    private readonly config: PolymarketFundingBalanceReadServiceConfig,
    private readonly clientFactory: PolymarketBalanceAllowanceClientFactory = createPolymarketBalanceAllowanceClient,
    private readonly venueAccountReader?: PolymarketFundingVenueAccountReader,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  public getStatus(): PolymarketFundingBalanceReadStatus {
    return getPolymarketFundingBalanceReadStatus(this.config);
  }

  public async readUsableBalance(input: PolymarketFundingBalanceReadInput): Promise<PolymarketFundingBalanceReadOutput> {
    const status = this.getStatus();
    if (!status.configured) {
      throw new PolymarketFundingBalanceReadNotConfiguredError("Polymarket balance read is disabled or incomplete.");
    }

    const funderAddress = await this.resolveUserDepositWalletAddress(input);
    const client = this.clientFactory(funderAddress ? { ...this.config, funderAddress } : this.config);
    await client.updateBalanceAllowance?.({ asset_type: AssetType.COLLATERAL });
    const response = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    const balance = collateralAtomicUnitsToUsdc(response.balance);
    const clobAllowanceSpenders = clobAllowanceSpendersFromResponse(response);
    const allowance = collateralAtomicUnitsToUsdc(collateralAllowanceAtomicUnits(response));
    const clobApprovalSpenders = clobAllowanceSpenders.map((spender) => spender.spenderAddress);
    const fallbackApprovalSpenders = configuredApprovalSpenders(this.config);
    const allowanceReadSpenders = clobApprovalSpenders.length > 0 ? clobApprovalSpenders : fallbackApprovalSpenders;
    const approvalSpenderSource: PolymarketFundingBalanceReadOutput["approvalSpenderSource"] =
      clobApprovalSpenders.length > 0
        ? "CLOB_ALLOWANCE_MAP"
        : fallbackApprovalSpenders.length > 0
          ? "CONFIG_FALLBACK"
          : "UNAVAILABLE";
    let usableBalance = Decimal.min(balance, allowance);
    let usableBalanceSource: PolymarketFundingBalanceReadOutput["usableBalanceSource"] = "CLOB_COLLATERAL_ALLOWANCE";
    let onchainPusdBalance: DecimalValue | null = null;
    let onchainPusdAllowance: DecimalValue | null = null;
    let bridgedUsdcBalance: DecimalValue | null = null;
    if (funderAddress && this.config.onchainFallbackEnabled !== false && usableBalance.isZero()) {
      onchainPusdBalance = await this.readOnchainErc20Balance(funderAddress, this.config.pusdTokenAddress ?? defaultPusdTokenAddress);
      onchainPusdAllowance = await this.readOnchainPusdAllowance(
        funderAddress,
        this.config.pusdTokenAddress ?? defaultPusdTokenAddress,
        allowanceReadSpenders
      );
      if (onchainPusdBalance.greaterThan(0) && onchainPusdAllowance && onchainPusdAllowance.greaterThan(0)) {
        usableBalance = Decimal.min(onchainPusdBalance, onchainPusdAllowance);
        usableBalanceSource = "ONCHAIN_PUSD_ALLOWANCE";
      }
      if (this.config.recognizeBridgedUsdcAsUsable !== false) {
        bridgedUsdcBalance = await this.readOnchainErc20Balance(funderAddress, this.config.bridgedUsdcTokenAddress ?? defaultPolygonBridgedUsdcTokenAddress);
      }
    }
    return {
      usableBalance: decimalToPlainString(usableBalance),
      collateralBalance: decimalToPlainString(balance),
      collateralAllowance: decimalToPlainString(allowance),
      clobAllowanceSpenders: clobAllowanceSpenders.map((spender) => ({
        spenderAddress: spender.spenderAddress,
        allowance: decimalToPlainString(spender.allowance)
      })),
      approvalSpenderSource,
      onchainPusdBalance: onchainPusdBalance ? decimalToPlainString(onchainPusdBalance) : null,
      onchainPusdAllowance: onchainPusdAllowance ? decimalToPlainString(onchainPusdAllowance) : null,
      bridgedUsdcBalance: bridgedUsdcBalance ? decimalToPlainString(bridgedUsdcBalance) : null,
      usableBalanceSource
    };
  }

  public async readConditionalTokenApproval(input: PolymarketFundingBalanceReadInput & {
    tokenId: string;
  }): Promise<{
    tokenId: string;
    tokenBalance: string;
    tokenAllowance: string;
    clobAllowanceSpenders: PolymarketClobAllowanceSpender[];
  }> {
    const status = this.getStatus();
    if (!status.configured) {
      throw new PolymarketFundingBalanceReadNotConfiguredError("Polymarket balance read is disabled or incomplete.");
    }
    if (!/^\d+$/.test(input.tokenId)) {
      throw new PolymarketFundingBalanceReadNotConfiguredError("Polymarket conditional token id is invalid.");
    }
    const funderAddress = await this.resolveUserDepositWalletAddress(input);
    const client = this.clientFactory(funderAddress ? { ...this.config, funderAddress } : this.config);
    await client.updateBalanceAllowance?.({ asset_type: AssetType.CONDITIONAL, token_id: input.tokenId });
    const response = await client.getBalanceAllowance({ asset_type: AssetType.CONDITIONAL, token_id: input.tokenId });
    const allowanceSpenders = clobAllowanceSpendersFromResponse(response);
    return {
      tokenId: input.tokenId,
      tokenBalance: collateralAtomicUnitsToUsdc(response.balance).toFixed(),
      tokenAllowance: collateralAtomicUnitsToUsdc(collateralAllowanceAtomicUnits(response)).toFixed(),
      clobAllowanceSpenders: allowanceSpenders.map((spender) => ({
        spenderAddress: spender.spenderAddress,
        allowance: decimalToPlainString(spender.allowance)
      }))
    };
  }

  private async resolveUserDepositWalletAddress(input: PolymarketFundingBalanceReadInput): Promise<string | null> {
    if (!this.venueAccountReader) {
      if (this.config.requireUserDepositWallet) {
        throw new PolymarketFundingBalanceReadAccountUnavailableError(
          "Active Polymarket deposit wallet account is required for user-scoped funding readiness."
        );
      }
      return null;
    }
    const account = await this.venueAccountReader.findAccount({
      userId: input.userId,
      venue: "POLYMARKET"
    });
    if (account?.status === "ACTIVE" && nonEmpty(account.venueAccountAddress ?? undefined)) {
      return account.venueAccountAddress!;
    }
    throw new PolymarketFundingBalanceReadAccountUnavailableError(
      "Active Polymarket deposit wallet account is required for user-scoped funding readiness."
    );
  }

  private async readOnchainErc20Balance(ownerAddress: string, tokenAddress: string): Promise<ReturnType<typeof toDecimal>> {
    const rpcUrl = this.config.polygonRpcUrl;
    if (!nonEmpty(rpcUrl) || !isHexAddress(ownerAddress) || !isHexAddress(tokenAddress)) {
      return new Decimal(0);
    }
    const data = `0x70a08231${ownerAddress.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
    const response = await this.fetchImpl(rpcUrl!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: tokenAddress, data }, "latest"]
      })
    });
    if (!response.ok) {
      return new Decimal(0);
    }
    const raw = await response.json() as { result?: unknown };
    if (typeof raw.result !== "string" || !/^0x[a-fA-F0-9]+$/.test(raw.result)) {
      return new Decimal(0);
    }
    const atomic = BigInt(raw.result);
    return new Decimal(atomic.toString()).div(new Decimal(10).pow(COLLATERAL_TOKEN_DECIMALS));
  }

  private async readOnchainPusdAllowance(
    ownerAddress: string,
    tokenAddress: string,
    spenderAddresses: string[]
  ): Promise<ReturnType<typeof toDecimal> | null> {
    if (spenderAddresses.length === 0) {
      return null;
    }
    const allowances = await Promise.all(spenderAddresses.map((spenderAddress) =>
      this.readOnchainErc20Allowance(ownerAddress, spenderAddress, tokenAddress)
    ));
    return Decimal.min(...allowances);
  }

  private async readOnchainErc20Allowance(
    ownerAddress: string,
    spenderAddress: string,
    tokenAddress: string
  ): Promise<ReturnType<typeof toDecimal>> {
    const rpcUrl = this.config.polygonRpcUrl;
    if (!nonEmpty(rpcUrl) || !isHexAddress(ownerAddress) || !isHexAddress(spenderAddress) || !isHexAddress(tokenAddress)) {
      return new Decimal(0);
    }
    const cleanOwner = ownerAddress.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    const cleanSpender = spenderAddress.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    const data = `0xdd62ed3e${cleanOwner}${cleanSpender}`;
    const response = await this.fetchImpl(rpcUrl!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: tokenAddress, data }, "latest"]
      })
    });
    if (!response.ok) {
      return new Decimal(0);
    }
    const raw = await response.json() as { result?: unknown };
    if (typeof raw.result !== "string" || !/^0x[a-fA-F0-9]+$/.test(raw.result)) {
      return new Decimal(0);
    }
    const atomic = BigInt(raw.result);
    return new Decimal(atomic.toString()).div(new Decimal(10).pow(COLLATERAL_TOKEN_DECIMALS));
  }
}

const isHexAddress = (value: string | undefined): value is string =>
  typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim());
