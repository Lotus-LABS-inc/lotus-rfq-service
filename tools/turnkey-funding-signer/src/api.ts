import type { FundingIntentResponse, WithdrawalIntentResponse, WithdrawalRouteLegResponse } from "./types";

const API_PREFIX = "/lotus-api";

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
