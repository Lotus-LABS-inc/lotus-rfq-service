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

export interface PolymarketFundingBalanceReadInput {
  userId: string;
  fundingIntentId: string;
  routeLegId: string;
}

export interface PolymarketFundingBalanceReadOutput {
  usableBalance: string;
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
}

export interface PolymarketBalanceAllowanceClient {
  getBalanceAllowance(params: { asset_type: AssetType }): Promise<BalanceAllowanceResponse>;
}

export type PolymarketBalanceAllowanceClientFactory = (
  config: PolymarketFundingBalanceReadServiceConfig
) => PolymarketBalanceAllowanceClient;

export class PolymarketFundingBalanceReadNotConfiguredError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PolymarketFundingBalanceReadNotConfiguredError";
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

const decimalToPlainString = (value: ReturnType<typeof toDecimal>): string =>
  value.toDecimalPlaces(COLLATERAL_TOKEN_DECIMALS, Decimal.ROUND_DOWN).toFixed();

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
  funderAddress: env.POLYMARKET_FUNDER_ADDRESS ?? env.POLY_FUNDER_ADDRESS
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
    private readonly clientFactory: PolymarketBalanceAllowanceClientFactory = createPolymarketBalanceAllowanceClient
  ) {}

  public getStatus(): PolymarketFundingBalanceReadStatus {
    return getPolymarketFundingBalanceReadStatus(this.config);
  }

  public async readUsableBalance(_input: PolymarketFundingBalanceReadInput): Promise<PolymarketFundingBalanceReadOutput> {
    const status = this.getStatus();
    if (!status.configured) {
      throw new PolymarketFundingBalanceReadNotConfiguredError("Polymarket balance read is disabled or incomplete.");
    }

    const client = this.clientFactory(this.config);
    const response = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    const balance = collateralAtomicUnitsToUsdc(response.balance);
    const allowance = collateralAtomicUnitsToUsdc(response.allowance);
    const usableBalance = Decimal.min(balance, allowance);
    return { usableBalance: decimalToPlainString(usableBalance) };
  }
}
