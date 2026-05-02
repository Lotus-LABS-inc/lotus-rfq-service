import type { FundingIntentResponse, WithdrawalIntentResponse, WithdrawalRouteLegResponse } from "./types";

const API_PREFIX = "/lotus-api";
const LIFI_PREFIX = "/lifi-api";

export const normalizeJwtInput = (value: string): string =>
  value
    .trim()
    .replace(/^JWT:\s*/i, "")
    .replace(/^Bearer\s+/i, "")
    .trim();

const parseApiError = async (response: Response): Promise<string> => {
  const text = await response.text();
  if (!text) {
    return `${response.status} ${response.statusText}`;
  }
  try {
    const parsed = JSON.parse(text) as { message?: string; code?: string };
    return parsed.message ?? parsed.code ?? text;
  } catch {
    return text;
  }
};

const toBaseUnits = (amount: string, decimals: number): string => {
  const [whole = "0", fraction = ""] = amount.trim().split(".");
  const normalizedWhole = whole.replace(/[^\d]/g, "") || "0";
  const normalizedFraction = fraction.replace(/[^\d]/g, "").padEnd(decimals, "0").slice(0, decimals);
  return BigInt(`${normalizedWhole}${normalizedFraction}`.replace(/^0+(?=\d)/, "") || "0").toString();
};

const fromBaseUnits = (amount: string | undefined, decimals: number): string => {
  const raw = BigInt((amount ?? "0").replace(/[^\d]/g, "") || "0").toString().padStart(decimals + 1, "0");
  const whole = raw.slice(0, -decimals) || "0";
  const fraction = raw.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
};

const chainToLifiId = (chain: string): string => {
  const normalized = chain.trim().toUpperCase();
  if (normalized === "BSC" || normalized === "BNB" || normalized === "BINANCE") {
    return "56";
  }
  if (normalized === "SOLANA" || normalized === "SOL") {
    return "SOL";
  }
  return chain.trim();
};

interface StandaloneBridgeQuoteInput {
  sourceChain: string;
  destinationChain: string;
  sourceTokenAddress: string;
  destinationTokenAddress: string;
  sourceTokenSymbol: string;
  destinationTokenSymbol: string;
  sourceAmount: string;
  sourceDecimals: number;
  destinationDecimals: number;
  sourceWalletAddress: string;
  destinationWalletAddress: string;
}

interface LifiQuoteResponse {
  id?: string;
  tool?: string;
  action?: {
    fromAmount?: string;
    fromChainId?: number | string;
    fromToken?: { symbol?: string; address?: string };
    toToken?: { symbol?: string; address?: string };
  };
  estimate?: {
    toAmount?: string;
    executionDuration?: number;
    feeCosts?: unknown[];
    gasCosts?: unknown[];
  };
  transactionRequest?: {
    data?: string;
    from?: string;
    to?: string;
    chainId?: number;
    value?: string;
  };
}

export const quoteStandaloneBridge = async (input: StandaloneBridgeQuoteInput): Promise<FundingIntentResponse> => {
  const params = new URLSearchParams({
    fromChain: chainToLifiId(input.sourceChain),
    toChain: chainToLifiId(input.destinationChain),
    fromToken: input.sourceTokenAddress,
    toToken: input.destinationTokenAddress,
    fromAmount: toBaseUnits(input.sourceAmount, input.sourceDecimals),
    fromAddress: input.sourceWalletAddress,
    toAddress: input.destinationWalletAddress
  });
  const response = await fetch(`${LIFI_PREFIX}/v1/quote?${params.toString()}`, {
    headers: { accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }
  const quote = await response.json() as LifiQuoteResponse;
  if (!quote.transactionRequest?.data || !quote.transactionRequest.to) {
    throw new Error("LI.FI quote did not include a signable transaction request.");
  }
  const now = new Date();
  const routeLegId = `standalone-bridge-${now.getTime()}`;
  const destinationAmountEstimate = fromBaseUnits(quote.estimate?.toAmount, input.destinationDecimals);
  return {
    fundingIntentId: `standalone-bridge-${now.toISOString()}`,
    currentStatus: "USER_SIGNATURE_REQUIRED",
    sourceChain: input.sourceChain,
    sourceToken: input.sourceTokenAddress,
    sourceAmount: input.sourceAmount,
    sourceWalletId: null,
    sourceWalletAddress: input.sourceWalletAddress,
    userSafeMessage: "Standalone bridge route loaded. Lotus will not submit this to backend accounting.",
    routeLegs: [{
      routeLegId,
      targetVenue: "OPINION_BRIDGE_BACK",
      sourceChain: input.sourceChain,
      sourceToken: input.sourceTokenAddress,
      sourceAmount: input.sourceAmount,
      destinationChain: input.destinationChain,
      destinationToken: input.destinationTokenSymbol,
      destinationAmountEstimate,
      routeProvider: "LIFI_STANDALONE_BRIDGE",
      status: "USER_SIGNATURE_REQUIRED",
      routeQuote: {
        provider: "LI.FI",
        providerRouteId: quote.id ?? quote.tool ?? null,
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
        transactionRequest: {
          ...quote.transactionRequest,
          from: quote.transactionRequest.from ?? input.sourceWalletAddress
        },
        userSafeSummary: `${input.sourceAmount} ${input.sourceTokenSymbol} on ${input.sourceChain} -> ${destinationAmountEstimate} ${input.destinationTokenSymbol} on ${input.destinationChain}`
      }
    }]
  };
};

export const getFundingIntent = async (jwt: string, fundingIntentId: string): Promise<FundingIntentResponse> => {
  const response = await fetch(`${API_PREFIX}/funding/intents/${encodeURIComponent(fundingIntentId)}`, {
    headers: {
      Authorization: `Bearer ${normalizeJwtInput(jwt)}`
    }
  });
  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }
  return await response.json() as FundingIntentResponse;
};

export const quoteFundingIntent = async (jwt: string, fundingIntentId: string): Promise<FundingIntentResponse> => {
  const response = await fetch(`${API_PREFIX}/funding/intents/${encodeURIComponent(fundingIntentId)}/quote`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${normalizeJwtInput(jwt)}`,
      "Content-Type": "application/json"
    },
    body: "{}"
  });
  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }
  return await response.json() as FundingIntentResponse;
};

export const submitFundingTxHash = async (
  jwt: string,
  fundingIntentId: string,
  routeLegId: string,
  txHash: string
): Promise<FundingIntentResponse> => {
  const response = await fetch(`${API_PREFIX}/funding/intents/${encodeURIComponent(fundingIntentId)}/submit`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${normalizeJwtInput(jwt)}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ routeLegId, txHash })
  });
  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }
  return await response.json() as FundingIntentResponse;
};

const normalizeWithdrawalResponse = (response: WithdrawalIntentResponse): FundingIntentResponse => {
  const firstLeg = response.routeLegs[0];
  const sourceWalletAddress = firstLeg?.providerStatus?.sourceWalletAddress ?? firstLeg?.routeQuote.transactionRequest?.from ?? "";
  return {
    fundingIntentId: response.withdrawalIntentId,
    currentStatus: response.currentStatus,
    sourceChain: firstLeg?.providerStatus?.sourceChain ?? firstLeg?.routeQuote.transactionRequest?.chainId?.toString() ?? "",
    sourceToken: firstLeg?.providerStatus?.sourceToken ?? response.token,
    sourceAmount: response.amount,
    sourceWalletId: null,
    sourceWalletAddress,
    routeLegs: response.routeLegs.map(normalizeWithdrawalLeg),
    userSafeMessage: response.userSafeMessage
  };
};

const normalizeWithdrawalLeg = (leg: WithdrawalRouteLegResponse) => ({
  routeLegId: leg.withdrawalRouteLegId,
  targetVenue: leg.sourceVenue,
  sourceChain: leg.providerStatus?.sourceChain ?? leg.routeQuote.transactionRequest?.chainId?.toString() ?? "",
  sourceToken: leg.providerStatus?.sourceToken ?? leg.sourceToken,
  sourceAmount: leg.sourceAmount,
  destinationChain: leg.destinationChain,
  destinationToken: leg.providerStatus?.destinationToken ?? leg.sourceToken,
  destinationAmountEstimate: leg.destinationAmountEstimate,
  routeProvider: leg.routeProvider,
  status: leg.status,
  routeQuote: leg.routeQuote
});

export const getWithdrawalIntent = async (jwt: string, withdrawalIntentId: string): Promise<FundingIntentResponse> => {
  const response = await fetch(`${API_PREFIX}/funding/withdrawals/${encodeURIComponent(withdrawalIntentId)}`, {
    headers: {
      Authorization: `Bearer ${normalizeJwtInput(jwt)}`
    }
  });
  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }
  return normalizeWithdrawalResponse(await response.json() as WithdrawalIntentResponse);
};

export const quoteWithdrawalIntent = async (jwt: string, withdrawalIntentId: string): Promise<FundingIntentResponse> => {
  const response = await fetch(`${API_PREFIX}/funding/withdrawals/${encodeURIComponent(withdrawalIntentId)}/quote`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${normalizeJwtInput(jwt)}`,
      "Content-Type": "application/json"
    },
    body: "{}"
  });
  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }
  return normalizeWithdrawalResponse(await response.json() as WithdrawalIntentResponse);
};

export const submitWithdrawalTxHash = async (
  jwt: string,
  withdrawalIntentId: string,
  withdrawalRouteLegId: string,
  txHash: string
): Promise<FundingIntentResponse> => {
  const response = await fetch(`${API_PREFIX}/funding/withdrawals/${encodeURIComponent(withdrawalIntentId)}/submit`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${normalizeJwtInput(jwt)}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ withdrawalRouteLegId, txHash })
  });
  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }
  return normalizeWithdrawalResponse(await response.json() as WithdrawalIntentResponse);
};
