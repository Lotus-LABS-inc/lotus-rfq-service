import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const polymarketRelayHeaders = {
  timestamp: "x-lotus-relay-timestamp",
  nonce: "x-lotus-relay-nonce",
  signature: "x-lotus-relay-signature"
} as const;

export interface PolymarketRelaySignatureInput {
  method: string;
  path: string;
  body: unknown;
  timestamp: string;
  nonce: string;
}

export const createPolymarketRelayNonce = (): string => randomUUID();

export const stableJsonStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJsonStringify(entry)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJsonStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

export const buildPolymarketRelaySigningPayload = (input: PolymarketRelaySignatureInput): string =>
  [
    input.timestamp,
    input.nonce,
    input.method.toUpperCase(),
    input.path,
    stableJsonStringify(input.body)
  ].join(".");

export const signPolymarketRelayRequest = (
  secret: string,
  input: PolymarketRelaySignatureInput
): string =>
  createHmac("sha256", secret)
    .update(buildPolymarketRelaySigningPayload(input))
    .digest("hex");

export const verifyPolymarketRelayRequest = (
  secret: string,
  input: PolymarketRelaySignatureInput & {
    signature: string;
    now?: Date | undefined;
    maxSkewMs?: number | undefined;
  }
): boolean => {
  const parsedTimestamp = Date.parse(input.timestamp);
  if (!Number.isFinite(parsedTimestamp)) {
    return false;
  }
  const nowMs = input.now?.getTime() ?? Date.now();
  if (Math.abs(nowMs - parsedTimestamp) > (input.maxSkewMs ?? 30_000)) {
    return false;
  }
  const expected = signPolymarketRelayRequest(secret, input);
  const actualBuffer = Buffer.from(input.signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
};
