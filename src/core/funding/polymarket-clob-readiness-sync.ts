import Decimal from "decimal.js";
import { verifyTypedData } from "ethers";
import {
  AssetType,
  Chain,
  ClobClient,
  COLLATERAL_TOKEN_DECIMALS,
  SignatureTypeV2,
  type ApiKeyCreds,
  type BalanceAllowanceResponse,
  type ClobClientOptions
} from "@polymarket/clob-client-v2";

type DecimalValue = InstanceType<typeof Decimal>;

export interface PolymarketClobReadinessSyncConfig {
  clobHost?: string | undefined;
  chainId?: string | undefined;
  builderCode?: string | undefined;
}

export interface PolymarketClobReadinessAccount {
  signerAddress: string;
  depositWalletAddress: string;
}

export interface PolymarketClobReadinessPreparation {
  signer: string;
  account: string;
  expiresAt: string;
  typedData: Record<string, unknown>;
  signedPayloadHint: Record<string, unknown>;
}

export interface PolymarketClobReadinessSignedPayload {
  signer?: string | undefined;
  account?: string | undefined;
  signature?: string | undefined;
  typedData?: Record<string, unknown> | undefined;
  data?: Record<string, unknown> | undefined;
}

export interface PolymarketClobReadinessSyncResult {
  status: "READY" | "SYNC_PENDING";
  readinessReason: "POLYMARKET_CLOB_COLLATERAL_CONFIRMED" | "POLYMARKET_CLOB_SYNC_PENDING";
  clobCollateralBalance: string;
  clobCollateralAllowance: string;
  clobAllowanceSpenders: Array<{ spenderAddress: string; allowance: string }>;
  readyAmount: string;
  ownerAddress: string;
  signerAddress: string;
}

class PolymarketClobReadinessSyncError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "PolymarketClobReadinessSyncError";
  }
}

export const buildPolymarketClobReadinessSyncConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): PolymarketClobReadinessSyncConfig => ({
  clobHost: env.POLYMARKET_CLOB_HOST ?? env.POLY_CLOB_HOST ?? "https://clob.polymarket.com",
  chainId: env.POLYMARKET_CHAIN_ID ?? env.POLY_CHAIN_ID,
  builderCode: env.POLYMARKET_BUILDER_CODE ?? env.POLY_BUILDER_CODE
});

export const buildPolymarketClobReadinessPreparation = (
  account: PolymarketClobReadinessAccount,
  config: PolymarketClobReadinessSyncConfig,
  now: Date = new Date()
): PolymarketClobReadinessPreparation => {
  assertAddress(account.signerAddress, "signerAddress");
  assertAddress(account.depositWalletAddress, "depositWalletAddress");
  const chainId = Number(parseChainId(config.chainId));
  const timestamp = Math.floor(now.getTime() / 1_000);
  const nonce = 0;
  const typedData = {
    domain: {
      name: "ClobAuthDomain",
      version: "1",
      chainId
    },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" }
      ],
      ClobAuth: [
        { name: "address", type: "address" },
        { name: "timestamp", type: "string" },
        { name: "nonce", type: "uint256" },
        { name: "message", type: "string" }
      ]
    },
    primaryType: "ClobAuth",
    message: {
      address: account.signerAddress,
      timestamp: String(timestamp),
      nonce,
      message: "This message attests that I control the given wallet"
    }
  };

  return {
    signer: account.signerAddress,
    account: account.depositWalletAddress,
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    typedData,
    signedPayloadHint: {
      purpose: "POLYMARKET_CLOB_AUTH",
      signer: account.signerAddress,
      account: account.depositWalletAddress,
      data: {
        address: account.signerAddress,
        timestamp,
        nonce,
        chainId,
        funderAddress: account.depositWalletAddress
      },
      typedData
    }
  };
};

export class PolymarketClobReadinessSyncService {
  private readonly config: PolymarketClobReadinessSyncConfig;
  private readonly clientFactory: (input: {
      auth: ParsedClobAuthPayload;
      creds: ApiKeyCreds;
    }) => PolymarketBalanceAllowanceClient;
  private readonly fetchImpl: typeof fetch;

  public constructor(
    config: PolymarketClobReadinessSyncConfig,
    clientFactory?: (input: {
      auth: ParsedClobAuthPayload;
      creds: ApiKeyCreds;
    }) => PolymarketBalanceAllowanceClient,
    fetchImpl: typeof fetch = fetch
  ) {
    this.config = config;
    this.clientFactory = clientFactory ?? ((input) => createUserScopedPolymarketClobClient(this.config, input));
    this.fetchImpl = fetchImpl;
  }

  public async sync(input: {
    account: PolymarketClobReadinessAccount;
    signedPayload: PolymarketClobReadinessSignedPayload;
  }): Promise<PolymarketClobReadinessSyncResult> {
    const auth = parseAndVerifyClobAuthPayload(input.account, input.signedPayload);
    const creds = await this.createOrDeriveApiKey(auth);
    const client = this.clientFactory({ auth, creds });
    const params = {
      asset_type: AssetType.COLLATERAL,
      signature_type: SignatureTypeV2.POLY_1271
    };
    await client.updateBalanceAllowance?.(params);
    const response = await client.getBalanceAllowance(params);
    const balance = collateralAtomicUnitsToUsdc(response.balance);
    const spenderRows = clobAllowanceSpendersFromResponse(response);
    const allowance = collateralAtomicUnitsToUsdc(collateralAllowanceAtomicUnits(response));
    const readyAmount = Decimal.min(balance, allowance);
    return {
      status: readyAmount.greaterThan(0) ? "READY" : "SYNC_PENDING",
      readinessReason: readyAmount.greaterThan(0)
        ? "POLYMARKET_CLOB_COLLATERAL_CONFIRMED"
        : "POLYMARKET_CLOB_SYNC_PENDING",
      clobCollateralBalance: decimalToPlainString(balance),
      clobCollateralAllowance: decimalToPlainString(allowance),
      clobAllowanceSpenders: spenderRows.map((spender) => ({
        spenderAddress: spender.spenderAddress,
        allowance: decimalToPlainString(spender.allowance)
      })),
      readyAmount: decimalToPlainString(readyAmount),
      ownerAddress: input.account.depositWalletAddress,
      signerAddress: input.account.signerAddress
    };
  }

  private async createOrDeriveApiKey(auth: ParsedClobAuthPayload): Promise<ApiKeyCreds> {
    let deriveError: unknown = null;
    try {
      const derived = await this.requestApiKey(auth, "derive");
      if (nonEmpty(derived.key) && nonEmpty(derived.secret) && nonEmpty(derived.passphrase)) {
        return derived;
      }
    } catch (error) {
      deriveError = error;
    }
    const created = await this.requestApiKey(auth, "create").catch((createError: unknown) => {
      const message = createError instanceof Error
        ? createError.message
        : deriveError instanceof Error
          ? deriveError.message
          : "Polymarket CLOB API-key creation failed.";
      throw new PolymarketClobReadinessSyncError("POLYMARKET_USER_CLOB_API_KEY_UNAVAILABLE", message);
    });
    if (!nonEmpty(created.key) || !nonEmpty(created.secret) || !nonEmpty(created.passphrase)) {
      throw new PolymarketClobReadinessSyncError(
        "POLYMARKET_USER_CLOB_API_KEY_INVALID",
        "Polymarket did not return usable user-scoped CLOB API credentials."
      );
    }
    return created;
  }

  private async requestApiKey(auth: ParsedClobAuthPayload, mode: "create" | "derive"): Promise<ApiKeyCreds> {
    const host = this.config.clobHost?.replace(/\/+$/, "");
    if (!host) {
      throw new PolymarketClobReadinessSyncError(
        "POLYMARKET_CLOB_HOST_MISSING",
        "Polymarket CLOB host is required before user CLOB credentials can be derived."
      );
    }
    const path = mode === "create" ? "/auth/api-key" : "/auth/derive-api-key";
    const response = await this.fetchImpl(`${host}${path}`, {
      method: mode === "create" ? "POST" : "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        POLY_ADDRESS: auth.address,
        POLY_SIGNATURE: auth.signature,
        POLY_TIMESTAMP: String(auth.timestamp),
        POLY_NONCE: String(auth.nonce)
      }
    });
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const message = isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : isRecord(payload) && typeof payload.message === "string"
          ? payload.message
          : `Polymarket CLOB API-key ${mode} failed with status ${response.status}.`;
      throw new PolymarketClobReadinessSyncError(
        response.status === 401 || response.status === 403
          ? "POLYMARKET_USER_CLOB_API_KEY_UNAUTHORIZED"
          : "POLYMARKET_USER_CLOB_API_KEY_ERROR",
        message
      );
    }
    const record = isRecord(payload) ? payload : {};
    const key = typeof record.apiKey === "string" ? record.apiKey : typeof record.key === "string" ? record.key : "";
    const secret = typeof record.secret === "string" ? record.secret : "";
    const passphrase = typeof record.passphrase === "string" ? record.passphrase : "";
    return { key, secret, passphrase };
  }
}

interface ParsedClobAuthPayload {
  address: string;
  signature: string;
  timestamp: number;
  nonce: number;
  funderAddress: string;
}

export interface PolymarketBalanceAllowanceClient {
  getBalanceAllowance(params: {
    asset_type: AssetType;
    token_id?: string;
    signature_type?: SignatureTypeV2;
  }): Promise<BalanceAllowanceResponse>;
  updateBalanceAllowance?(params: {
    asset_type: AssetType;
    token_id?: string;
    signature_type?: SignatureTypeV2;
  }): Promise<unknown>;
}

const createUserScopedPolymarketClobClient = (
  config: PolymarketClobReadinessSyncConfig,
  input: {
  auth: ParsedClobAuthPayload;
  creds: ApiKeyCreds;
  }
): PolymarketBalanceAllowanceClient => {
  if (!config.clobHost) {
    throw new PolymarketClobReadinessSyncError("POLYMARKET_CLOB_HOST_MISSING", "Polymarket CLOB host is required.");
  }
  const options: ClobClientOptions = {
    host: config.clobHost,
    chain: parseChain(config.chainId),
    signer: addressOnlySigner(input.auth.address),
    creds: input.creds,
    signatureType: SignatureTypeV2.POLY_1271,
    funderAddress: input.auth.funderAddress,
    retryOnError: false,
    throwOnError: true
  };
  if (nonEmpty(config.builderCode)) {
    options.builderConfig = { builderCode: config.builderCode! };
  }
  return new ClobClient(options);
};

const parseAndVerifyClobAuthPayload = (
  expected: PolymarketClobReadinessAccount,
  signedPayload: PolymarketClobReadinessSignedPayload
): ParsedClobAuthPayload => {
  const signer = signedPayload.signer;
  const account = signedPayload.account;
  const signature = signedPayload.signature;
  const typedData = signedPayload.typedData;
  const data = signedPayload.data ?? {};
  if (!sameAddress(signer, expected.signerAddress)) {
    throw new PolymarketClobReadinessSyncError(
      "POLYMARKET_CLOB_AUTH_SIGNER_MISMATCH",
      "Polymarket CLOB sync signature signer does not match the linked Turnkey wallet."
    );
  }
  if (!sameAddress(account, expected.depositWalletAddress)) {
    throw new PolymarketClobReadinessSyncError(
      "POLYMARKET_CLOB_AUTH_ACCOUNT_MISMATCH",
      "Polymarket CLOB sync account does not match the linked deposit wallet."
    );
  }
  if (!signature || !/^0x[a-fA-F0-9]{130}$/.test(signature) || !typedData) {
    throw new PolymarketClobReadinessSyncError(
      "POLYMARKET_CLOB_AUTH_SIGNATURE_INVALID",
      "Polymarket CLOB sync payload is missing a valid EIP-712 signature."
    );
  }
  const message = recordField(typedData, "message") ?? {};
  if (!sameAddress(stringField(message, "address"), expected.signerAddress)) {
    throw new PolymarketClobReadinessSyncError(
      "POLYMARKET_CLOB_AUTH_ADDRESS_MISMATCH",
      "Polymarket CLOB sync auth message must target the linked Turnkey wallet."
    );
  }
  const recovered = verifyTypedData(
    recordField(typedData, "domain") ?? {},
    stripEip712Domain(recordField(typedData, "types") ?? {}) as never,
    message,
    signature
  ).toLowerCase();
  if (recovered !== expected.signerAddress.toLowerCase()) {
    throw new PolymarketClobReadinessSyncError(
      "POLYMARKET_CLOB_AUTH_SIGNATURE_MISMATCH",
      "Polymarket CLOB sync signature does not recover to the linked Turnkey wallet."
    );
  }
  const timestamp = typeof data.timestamp === "number" ? data.timestamp : Number(data.timestamp);
  const nonce = typeof data.nonce === "number" ? data.nonce : Number(data.nonce ?? 0);
  if (!Number.isInteger(timestamp) || timestamp <= 0 || !Number.isInteger(nonce) || nonce < 0) {
    throw new PolymarketClobReadinessSyncError(
      "POLYMARKET_CLOB_AUTH_PAYLOAD_INVALID",
      "Polymarket CLOB sync signature payload is malformed."
    );
  }
  return {
    address: expected.signerAddress,
    signature,
    timestamp,
    nonce,
    funderAddress: expected.depositWalletAddress
  };
};

const addressOnlySigner = (address: string): {
  getAddress(): Promise<string>;
  _signTypedData(): Promise<string>;
} => ({
  async getAddress() {
    return address;
  },
  async _signTypedData() {
    throw new PolymarketClobReadinessSyncError(
      "POLYMARKET_ADDRESS_ONLY_SIGNER_CANNOT_SIGN",
      "Polymarket address-only signer is only valid for L2 HMAC balance requests."
    );
  }
});

const parseChain = (value: string | undefined): Chain => {
  if (value === String(Chain.AMOY)) {
    return Chain.AMOY;
  }
  return Chain.POLYGON;
};

const parseChainId = (value: string | undefined): number => {
  if (value === String(Chain.AMOY)) {
    return Chain.AMOY;
  }
  return Chain.POLYGON;
};

const collateralAtomicUnitsToUsdc = (value: string) =>
  toDecimal(value).div(new Decimal(10).pow(COLLATERAL_TOKEN_DECIMALS));

const collateralAllowanceAtomicUnits = (response: BalanceAllowanceResponse): string => {
  if (nonEmpty(response.allowance)) {
    return response.allowance!;
  }
  const allowanceSpenders = clobAllowanceSpendersFromResponse(response);
  if (allowanceSpenders.length === 0) {
    return "0";
  }
  return Decimal.min(...allowanceSpenders.map((spender) => toDecimal(spender.allowanceAtomic))).toFixed();
};

const clobAllowanceSpendersFromResponse = (
  response: BalanceAllowanceResponse
): Array<{ spenderAddress: string; allowanceAtomic: string; allowance: DecimalValue }> => {
  const allowances = (response as unknown as { allowances?: unknown }).allowances;
  if (!allowances || typeof allowances !== "object" || Array.isArray(allowances)) {
    return [];
  }
  return Object.entries(allowances).map(([spenderAddress, value]) => {
    if (!isHexAddress(spenderAddress) || typeof value !== "string" || value.trim().length === 0) {
      throw new PolymarketClobReadinessSyncError(
        "POLYMARKET_CLOB_ALLOWANCE_PAYLOAD_INVALID",
        "Polymarket CLOB allowance response included a malformed spender."
      );
    }
    const allowanceAtomic = toDecimal(value.trim()).toFixed();
    return {
      spenderAddress,
      allowanceAtomic,
      allowance: collateralAtomicUnitsToUsdc(allowanceAtomic)
    };
  });
};

const decimalToPlainString = (value: DecimalValue): string =>
  value.toDecimalPlaces(COLLATERAL_TOKEN_DECIMALS, Decimal.ROUND_DOWN).toFixed();

const toDecimal = (value: string): DecimalValue => {
  const parsed = new Decimal(value);
  if (!parsed.isFinite() || parsed.isNegative()) {
    throw new PolymarketClobReadinessSyncError(
      "POLYMARKET_CLOB_BALANCE_PAYLOAD_INVALID",
      "Polymarket CLOB balance response was not a finite non-negative amount."
    );
  }
  return parsed;
};

const recordField = (record: Record<string, unknown>, field: string): Record<string, unknown> | null => {
  const value = record[field];
  return isRecord(value) ? value : null;
};

const stringField = (record: Record<string, unknown>, field: string): string | null => {
  const value = record[field];
  return typeof value === "string" ? value : null;
};

const stripEip712Domain = (types: Record<string, unknown>): Record<string, unknown> => {
  const next = { ...types };
  delete next.EIP712Domain;
  return next;
};

const assertAddress = (value: string, label: string): void => {
  if (!isHexAddress(value)) {
    throw new PolymarketClobReadinessSyncError(
      "POLYMARKET_CLOB_SYNC_ADDRESS_INVALID",
      `Polymarket CLOB sync ${label} is invalid.`
    );
  }
};

const sameAddress = (left: string | undefined | null, right: string | undefined | null): boolean =>
  isHexAddress(left ?? undefined) && isHexAddress(right ?? undefined) && left!.toLowerCase() === right!.toLowerCase();

const isHexAddress = (value: string | undefined): value is string =>
  typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim());

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nonEmpty = (value: string | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;
