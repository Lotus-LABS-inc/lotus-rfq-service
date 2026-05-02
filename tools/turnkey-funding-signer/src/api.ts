import type { FundingIntentResponse } from "./types";

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
