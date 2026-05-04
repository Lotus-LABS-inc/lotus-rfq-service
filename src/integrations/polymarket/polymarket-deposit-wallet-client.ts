import {
  buildDepositWalletCreateRequest,
  deriveDepositWallet,
  RelayClient,
  TransactionType,
  type DepositWalletBatchRequest,
  type DepositWalletCall,
  type DepositWalletCreateRequest
} from "@polymarket/builder-relayer-client";
import { BuilderConfig } from "@polymarket/builder-signing-sdk";

export interface PolymarketDepositWalletClientConfig {
  enabled: boolean;
  relayerUrl: string | null;
  chainId: number;
  factoryAddress: string | null;
  implementationAddress: string | null;
  builderApiKey: string | null;
  builderApiSecret: string | null;
  builderApiPassphrase: string | null;
  deployEnabled: boolean;
  rpcUrl: string | null;
  pUsdAddress: string | null;
  usdcAddress: string | null;
  collateralOnrampAddress: string | null;
  ctfSpenderAddress: string | null;
  negRiskSpenderAddress: string | null;
}

export interface PolymarketDerivedDepositWallet {
  walletAddress: string;
  deploymentStatus: "DERIVED_NOT_DEPLOYED" | "DEPLOY_SUBMITTED" | "DEPLOY_CONFIRMED" | "ALREADY_DEPLOYED";
  relayerTransactionId?: string | undefined;
  relayerState?: string | undefined;
  transactionHash?: string | null | undefined;
}

export interface PolymarketDepositWalletActivationTypedData {
  domain: {
    name: "DepositWallet";
    version: "1";
    chainId: number;
    verifyingContract: string;
  };
  types: {
    Call: Array<{ name: "target" | "value" | "data"; type: "address" | "uint256" | "bytes" }>;
    Batch: Array<{ name: "wallet" | "nonce" | "deadline" | "calls"; type: "address" | "uint256" | "Call[]" }>;
  };
  primaryType: "Batch";
  message: {
    wallet: string;
    nonce: string;
    deadline: string;
    calls: DepositWalletCall[];
  };
}

export interface PolymarketDepositWalletActivationPreparation {
  ownerAddress: string;
  depositWalletAddress: string;
  chainId: number;
  nonce: string;
  deadline: string;
  calls: DepositWalletCall[];
  typedData: PolymarketDepositWalletActivationTypedData;
  wrapsUsdc: boolean;
  usdcBalance: string;
  approvalSpenders: string[];
  instructions: string[];
}

export interface PolymarketDepositWalletActivationSubmission {
  relayerTransactionId?: string | undefined;
  relayerState?: string | undefined;
  transactionHash?: string | null | undefined;
}

export const buildPolymarketDepositWalletClientConfigFromEnv = (
  env: NodeJS.ProcessEnv
): PolymarketDepositWalletClientConfig => ({
  enabled: env.POLYMARKET_DEPOSIT_WALLET_AUTOMATION_ENABLED === "true",
  relayerUrl: nonEmpty(env.POLYMARKET_RELAYER_URL) ?? nonEmpty(env.POLYMARKET_RELAYER_HOST) ?? nonEmpty(env.POLY_RELAYER_HOST),
  chainId: parseChainId(env.POLYMARKET_CHAIN_ID ?? env.POLY_CHAIN_ID),
  factoryAddress: nonEmpty(env.POLYMARKET_DEPOSIT_WALLET_FACTORY_ADDRESS) ?? defaultFactoryAddress(env.POLYMARKET_CHAIN_ID ?? env.POLY_CHAIN_ID),
  implementationAddress: nonEmpty(env.POLYMARKET_DEPOSIT_WALLET_IMPLEMENTATION_ADDRESS) ?? defaultImplementationAddress(env.POLYMARKET_CHAIN_ID ?? env.POLY_CHAIN_ID),
  builderApiKey: nonEmpty(env.POLYMARKET_BUILDER_API_KEY) ?? nonEmpty(env.BUILDER_API_KEY),
  builderApiSecret: nonEmpty(env.POLYMARKET_BUILDER_API_SECRET) ?? nonEmpty(env.BUILDER_SECRET),
  builderApiPassphrase: nonEmpty(env.POLYMARKET_BUILDER_API_PASSPHRASE) ?? nonEmpty(env.BUILDER_PASS_PHRASE),
  deployEnabled: env.POLYMARKET_DEPOSIT_WALLET_DEPLOY_ENABLED !== "false",
  rpcUrl: nonEmpty(env.POLYMARKET_DEPOSIT_WALLET_RPC_URL) ??
    nonEmpty(env.POLYMARKET_INTERNAL_WITHDRAWAL_EVIDENCE_POLYGON_RPC_URL) ??
    nonEmpty(env.POLYGON_RPC_URL) ??
    "https://polygon.drpc.org",
  pUsdAddress: nonEmpty(env.POLYMARKET_BALANCE_ACTIVATION_TOKEN_ADDRESS) ?? "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB",
  usdcAddress: nonEmpty(env.POLYMARKET_USDCE_ADDRESS) ?? "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  collateralOnrampAddress: nonEmpty(env.POLYMARKET_COLLATERAL_ONRAMP_ADDRESS) ?? "0x93070a847efEf7F70739046A929D47a521F5B8ee",
  ctfSpenderAddress: nonEmpty(env.POLYMARKET_BALANCE_ACTIVATION_SPENDER_ADDRESS) ?? null,
  negRiskSpenderAddress: nonEmpty(env.POLYMARKET_NEG_RISK_BALANCE_ACTIVATION_SPENDER_ADDRESS) ?? null
});

export class PolymarketDepositWalletClient {
  public constructor(private readonly config: PolymarketDepositWalletClientConfig) {}

  public configured(): boolean {
    return this.config.enabled && isEvmAddress(this.config.factoryAddress) && isEvmAddress(this.config.implementationAddress);
  }

  public async deriveOrCreateDepositWallet(input: {
    ownerAddress: string;
    allowDeploy?: boolean;
  }): Promise<PolymarketDerivedDepositWallet> {
    if (!this.configured()) {
      throw new Error("Polymarket deposit-wallet automation is not configured.");
    }
    if (!isEvmAddress(input.ownerAddress)) {
      throw new Error("Polymarket deposit-wallet owner address is invalid.");
    }
    const walletAddress = deriveDepositWallet(
      input.ownerAddress,
      this.config.factoryAddress!,
      this.config.implementationAddress!
    );
    if (!isEvmAddress(walletAddress)) {
      throw new Error("Polymarket deposit-wallet derivation returned an invalid address.");
    }
    if (!this.deploymentConfigured()) {
      return {
        walletAddress,
        deploymentStatus: "DERIVED_NOT_DEPLOYED"
      };
    }
    const relayer = this.buildRelayerClient();
    const deployed = await relayer.getDeployed(walletAddress, TransactionType.WALLET_CREATE);
    if (deployed || await hasContractCode(this.config.rpcUrl, walletAddress)) {
      return {
        walletAddress,
        deploymentStatus: "ALREADY_DEPLOYED"
      };
    }
    if (!this.config.deployEnabled || input.allowDeploy === false) {
      return {
        walletAddress,
        deploymentStatus: "DERIVED_NOT_DEPLOYED"
      };
    }
    const request = buildDepositWalletCreateRequest(input.ownerAddress, {
      DepositWalletFactory: this.config.factoryAddress!,
      DepositWalletImplementation: this.config.implementationAddress!
    });
    const response = await submitDepositWalletCreate(relayer, request);
    const state = typeof response.state === "string" ? response.state : undefined;
    return {
      walletAddress,
      deploymentStatus: isConfirmedRelayerState(state) ? "DEPLOY_CONFIRMED" : "DEPLOY_SUBMITTED",
      relayerTransactionId: typeof response.transactionID === "string" ? response.transactionID : undefined,
      relayerState: state,
      transactionHash: typeof response.transactionHash === "string"
        ? response.transactionHash
        : typeof response.hash === "string"
          ? response.hash
          : null
    };
  }

  public async prepareActivation(input: {
    ownerAddress: string;
    depositWalletAddress: string;
    deadlineSeconds?: number | undefined;
  }): Promise<PolymarketDepositWalletActivationPreparation> {
    this.assertActivationConfigured();
    this.assertOwnerAndWallet(input.ownerAddress, input.depositWalletAddress);

    const relayer = this.buildRelayerClient();
    const noncePayload = await relayer.getNonce(input.ownerAddress, TransactionType.WALLET);
    const nonce = `${noncePayload.nonce}`;
    const deadline = `${Math.floor(Date.now() / 1000) + (input.deadlineSeconds ?? 1800)}`;
    const usdcBalance = await readErc20Balance(this.config.rpcUrl, this.config.usdcAddress!, input.depositWalletAddress);
    const calls = buildActivationCalls({
      depositWalletAddress: input.depositWalletAddress,
      pUsdAddress: this.config.pUsdAddress!,
      usdcAddress: this.config.usdcAddress!,
      collateralOnrampAddress: this.config.collateralOnrampAddress!,
      ctfSpenderAddress: this.config.ctfSpenderAddress!,
      negRiskSpenderAddress: this.config.negRiskSpenderAddress,
      usdcBalance
    });
    if (calls.length === 0) {
      throw new Error("Polymarket deposit-wallet activation has no safe calls to submit.");
    }
    return {
      ownerAddress: input.ownerAddress,
      depositWalletAddress: input.depositWalletAddress,
      chainId: this.config.chainId,
      nonce,
      deadline,
      calls,
      typedData: buildActivationTypedData({
        chainId: this.config.chainId,
        depositWalletAddress: input.depositWalletAddress,
        nonce,
        deadline,
        calls
      }),
      wrapsUsdc: BigInt(usdcBalance) > 0n,
      usdcBalance,
      approvalSpenders: [
        this.config.ctfSpenderAddress!,
        ...(this.config.negRiskSpenderAddress ? [this.config.negRiskSpenderAddress] : [])
      ],
      instructions: [
        BigInt(usdcBalance) > 0n
          ? "Sign once to wrap the deposit wallet USDC.e into pUSD and approve Polymarket trading spenders."
          : "Sign once to approve Polymarket pUSD trading spenders from the deposit wallet."
      ]
    };
  }

  public async submitActivation(input: {
    ownerAddress: string;
    depositWalletAddress: string;
    nonce: string;
    deadline: string;
    calls: DepositWalletCall[];
    signature: string;
  }): Promise<PolymarketDepositWalletActivationSubmission> {
    this.assertActivationConfigured();
    this.assertOwnerAndWallet(input.ownerAddress, input.depositWalletAddress);
    validateActivationCalls({
      calls: input.calls,
      depositWalletAddress: input.depositWalletAddress,
      pUsdAddress: this.config.pUsdAddress!,
      usdcAddress: this.config.usdcAddress!,
      collateralOnrampAddress: this.config.collateralOnrampAddress!,
      ctfSpenderAddress: this.config.ctfSpenderAddress!,
      negRiskSpenderAddress: this.config.negRiskSpenderAddress
    });
    if (!/^\d+$/.test(input.nonce) || !/^\d+$/.test(input.deadline)) {
      throw new Error("Polymarket activation nonce/deadline is malformed.");
    }
    if (!/^0x[a-fA-F0-9]{130}$/.test(input.signature.trim())) {
      throw new Error("Polymarket activation signature must be a 65-byte hex signature.");
    }
    const request: DepositWalletBatchRequest = {
      type: TransactionType.WALLET,
      from: input.ownerAddress,
      to: this.config.factoryAddress!,
      nonce: input.nonce,
      signature: input.signature.trim(),
      depositWalletParams: {
        depositWallet: input.depositWalletAddress,
        deadline: input.deadline,
        calls: input.calls
      }
    };
    const response = await submitDepositWalletBatch(this.buildRelayerClient(), request);
    return {
      relayerTransactionId: typeof response.transactionID === "string" ? response.transactionID : undefined,
      relayerState: typeof response.state === "string" ? response.state : undefined,
      transactionHash: typeof response.transactionHash === "string"
        ? response.transactionHash
        : typeof response.hash === "string"
          ? response.hash
          : null
    };
  }

  private assertActivationConfigured(): void {
    if (!this.configured() || !this.deploymentConfigured()) {
      throw new Error("Polymarket deposit-wallet relayer is not configured.");
    }
    const missing = [
      !isEvmAddress(this.config.pUsdAddress) ? "POLYMARKET_BALANCE_ACTIVATION_TOKEN_ADDRESS" : null,
      !isEvmAddress(this.config.usdcAddress) ? "POLYMARKET_USDCE_ADDRESS" : null,
      !isEvmAddress(this.config.collateralOnrampAddress) ? "POLYMARKET_COLLATERAL_ONRAMP_ADDRESS" : null,
      !isEvmAddress(this.config.ctfSpenderAddress) ? "POLYMARKET_BALANCE_ACTIVATION_SPENDER_ADDRESS" : null
    ].filter((value): value is string => value !== null);
    if (missing.length > 0) {
      throw new Error(`Polymarket activation is not configured: ${missing.join(", ")}.`);
    }
  }

  private assertOwnerAndWallet(ownerAddress: string, depositWalletAddress: string): void {
    if (!isEvmAddress(ownerAddress) || !isEvmAddress(depositWalletAddress)) {
      throw new Error("Polymarket activation owner or deposit wallet address is invalid.");
    }
    const expected = deriveDepositWallet(ownerAddress, this.config.factoryAddress!, this.config.implementationAddress!);
    if (expected.toLowerCase() !== depositWalletAddress.toLowerCase()) {
      throw new Error("Polymarket activation deposit wallet does not match the owner address.");
    }
  }

  private deploymentConfigured(): boolean {
    return Boolean(
      nonEmpty(this.config.relayerUrl ?? undefined) &&
      nonEmpty(this.config.builderApiKey ?? undefined) &&
      nonEmpty(this.config.builderApiSecret ?? undefined) &&
      nonEmpty(this.config.builderApiPassphrase ?? undefined)
    );
  }

  private buildRelayerClient(): RelayClient {
    return new RelayClient(
      this.config.relayerUrl!,
      this.config.chainId,
      undefined,
      new BuilderConfig({
        localBuilderCreds: {
          key: this.config.builderApiKey!,
          secret: this.config.builderApiSecret!,
          passphrase: this.config.builderApiPassphrase!
        }
      })
    );
  }
}

interface RelayerSubmitResponse {
  transactionID?: unknown;
  state?: unknown;
  hash?: unknown;
  transactionHash?: unknown;
}

const submitDepositWalletCreate = async (
  relayer: RelayClient,
  request: DepositWalletCreateRequest
): Promise<RelayerSubmitResponse> => {
  const submitter = relayer as unknown as {
    sendAuthedRequest(method: "POST", path: "/submit", body: string): Promise<RelayerSubmitResponse>;
  };
  return submitter.sendAuthedRequest("POST", "/submit", JSON.stringify(request));
};

const submitDepositWalletBatch = async (
  relayer: RelayClient,
  request: DepositWalletBatchRequest
): Promise<RelayerSubmitResponse> => {
  const submitter = relayer as unknown as {
    sendAuthedRequest(method: "POST", path: "/submit", body: string): Promise<RelayerSubmitResponse>;
  };
  return submitter.sendAuthedRequest("POST", "/submit", JSON.stringify(request));
};

const maxUint256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
const depositWalletTypes: PolymarketDepositWalletActivationTypedData["types"] = {
  Call: [
    { name: "target", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" }
  ],
  Batch: [
    { name: "wallet", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "calls", type: "Call[]" }
  ]
};

const buildActivationTypedData = (input: {
  chainId: number;
  depositWalletAddress: string;
  nonce: string;
  deadline: string;
  calls: DepositWalletCall[];
}): PolymarketDepositWalletActivationTypedData => ({
  domain: {
    name: "DepositWallet",
    version: "1",
    chainId: input.chainId,
    verifyingContract: input.depositWalletAddress
  },
  types: depositWalletTypes,
  primaryType: "Batch",
  message: {
    wallet: input.depositWalletAddress,
    nonce: input.nonce,
    deadline: input.deadline,
    calls: input.calls
  }
});

const buildActivationCalls = (input: {
  depositWalletAddress: string;
  pUsdAddress: string;
  usdcAddress: string;
  collateralOnrampAddress: string;
  ctfSpenderAddress: string;
  negRiskSpenderAddress: string | null;
  usdcBalance: string;
}): DepositWalletCall[] => {
  const calls: DepositWalletCall[] = [];
  if (BigInt(input.usdcBalance) > 0n) {
    calls.push({
      target: input.usdcAddress,
      value: "0",
      data: encodeApprove(input.collateralOnrampAddress, input.usdcBalance)
    });
    calls.push({
      target: input.collateralOnrampAddress,
      value: "0",
      data: encodeWrap(input.usdcAddress, input.depositWalletAddress, input.usdcBalance)
    });
  }
  calls.push({
    target: input.pUsdAddress,
    value: "0",
    data: encodeApprove(input.ctfSpenderAddress, maxUint256)
  });
  if (input.negRiskSpenderAddress) {
    calls.push({
      target: input.pUsdAddress,
      value: "0",
      data: encodeApprove(input.negRiskSpenderAddress, maxUint256)
    });
  }
  return calls;
};

const validateActivationCalls = (input: {
  calls: DepositWalletCall[];
  depositWalletAddress: string;
  pUsdAddress: string;
  usdcAddress: string;
  collateralOnrampAddress: string;
  ctfSpenderAddress: string;
  negRiskSpenderAddress: string | null;
}): void => {
  if (!Array.isArray(input.calls) || input.calls.length === 0 || input.calls.length > 4) {
    throw new Error("Polymarket activation calls are malformed.");
  }
  const allowedSpenders = new Set([
    input.ctfSpenderAddress.toLowerCase(),
    ...(input.negRiskSpenderAddress ? [input.negRiskSpenderAddress.toLowerCase()] : [])
  ]);
  let wrappedAmount: string | null = null;
  for (const call of input.calls) {
    if (call.value !== "0" || !isEvmAddress(call.target) || typeof call.data !== "string") {
      throw new Error("Polymarket activation call is malformed.");
    }
    const target = call.target.toLowerCase();
    if (target === input.usdcAddress.toLowerCase()) {
      const decoded = decodeApprove(call.data);
      if (decoded.spender.toLowerCase() !== input.collateralOnrampAddress.toLowerCase() || BigInt(decoded.amount) <= 0n) {
        throw new Error("Polymarket activation USDC approval is not allowed.");
      }
      wrappedAmount = decoded.amount;
      continue;
    }
    if (target === input.collateralOnrampAddress.toLowerCase()) {
      const decoded = decodeWrap(call.data);
      if (
        decoded.asset.toLowerCase() !== input.usdcAddress.toLowerCase() ||
        decoded.to.toLowerCase() !== input.depositWalletAddress.toLowerCase() ||
        BigInt(decoded.amount) <= 0n ||
        (wrappedAmount !== null && decoded.amount !== wrappedAmount)
      ) {
        throw new Error("Polymarket activation wrap call is not allowed.");
      }
      continue;
    }
    if (target === input.pUsdAddress.toLowerCase()) {
      const decoded = decodeApprove(call.data);
      if (!allowedSpenders.has(decoded.spender.toLowerCase()) || decoded.amount !== maxUint256) {
        throw new Error("Polymarket activation pUSD approval is not allowed.");
      }
      continue;
    }
    throw new Error("Polymarket activation includes an unsupported call target.");
  }
};

const encodeApprove = (spender: string, amount: string): string =>
  `0x095ea7b3${encodeAddress(spender)}${encodeUint(amount)}`;

const encodeWrap = (asset: string, to: string, amount: string): string =>
  `0x62355638${encodeAddress(asset)}${encodeAddress(to)}${encodeUint(amount)}`;

const decodeApprove = (data: string): { spender: string; amount: string } => {
  const clean = cleanHexData(data, "095ea7b3", 2);
  return {
    spender: decodeAddress(clean.slice(0, 64)),
    amount: BigInt(`0x${clean.slice(64, 128)}`).toString()
  };
};

const decodeWrap = (data: string): { asset: string; to: string; amount: string } => {
  const clean = cleanHexData(data, "62355638", 3);
  return {
    asset: decodeAddress(clean.slice(0, 64)),
    to: decodeAddress(clean.slice(64, 128)),
    amount: BigInt(`0x${clean.slice(128, 192)}`).toString()
  };
};

const cleanHexData = (data: string, selector: string, argCount: number): string => {
  const expectedLength = 8 + (argCount * 64);
  const clean = data.trim().replace(/^0x/, "");
  if (!new RegExp(`^${selector}[a-fA-F0-9]{${argCount * 64}}$`).test(clean) || clean.length !== expectedLength) {
    throw new Error("Polymarket activation calldata is malformed.");
  }
  return clean.slice(8);
};

const encodeAddress = (address: string): string => {
  if (!isEvmAddress(address)) {
    throw new Error("Invalid EVM address.");
  }
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
};

const decodeAddress = (word: string): string => `0x${word.slice(24)}`;

const encodeUint = (value: string): string => {
  const parsed = BigInt(value);
  if (parsed < 0n) {
    throw new Error("Invalid unsigned integer.");
  }
  return parsed.toString(16).padStart(64, "0");
};

const readErc20Balance = async (rpcUrl: string | null, tokenAddress: string, ownerAddress: string): Promise<string> => {
  if (!nonEmpty(rpcUrl ?? undefined)) {
    return "0";
  }
  const response = await fetch(rpcUrl!, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{
        to: tokenAddress,
        data: `0x70a08231${encodeAddress(ownerAddress)}`
      }, "latest"]
    })
  });
  if (!response.ok) {
    throw new Error("Polymarket activation balance read failed.");
  }
  const payload = await response.json() as { result?: unknown; error?: unknown };
  if (typeof payload.result !== "string" || !/^0x[a-fA-F0-9]+$/.test(payload.result)) {
    throw new Error("Polymarket activation balance response was malformed.");
  }
  return BigInt(payload.result).toString();
};

const isConfirmedRelayerState = (state: string | undefined): boolean =>
  state === "STATE_CONFIRMED" ||
  state === "STATE_MINED" ||
  state === "STATE_EXECUTED";

const hasContractCode = async (rpcUrl: string | null, address: string): Promise<boolean> => {
  if (!nonEmpty(rpcUrl ?? undefined)) {
    return false;
  }
  try {
    const response = await fetch(rpcUrl!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getCode",
        params: [address, "latest"]
      })
    });
    if (!response.ok) {
      return false;
    }
    const payload = await response.json() as { result?: unknown };
    return typeof payload.result === "string" && payload.result !== "0x" && payload.result.length > 2;
  } catch {
    return false;
  }
};

const parseChainId = (value: string | undefined): number => {
  const parsed = Number(value ?? "137");
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 137;
};

const defaultFactoryAddress = (chainId: string | undefined): string | null => {
  const normalized = `${chainId ?? "137"}`.trim();
  if (normalized === "137" || normalized === "80002") {
    return "0x00000000000Fb5C9ADea0298D729A0CB3823Cc07";
  }
  return null;
};

const defaultImplementationAddress = (chainId: string | undefined): string | null => {
  const normalized = `${chainId ?? "137"}`.trim();
  if (normalized === "137") {
    return "0x58CA52ebe0DadfdF531Cde7062e76746de4Db1eB";
  }
  if (normalized === "80002") {
    return "0x50a88fE9a441cB4c9c2aD6A2207CE2795C7D7Fbd";
  }
  return null;
};

const nonEmpty = (value: string | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isEvmAddress = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim());
