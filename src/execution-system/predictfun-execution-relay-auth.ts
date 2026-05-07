import {
  buildPolymarketRelaySigningPayload,
  createPolymarketRelayNonce,
  signPolymarketRelayRequest,
  stableJsonStringify,
  verifyPolymarketRelayRequest,
  type PolymarketRelaySignatureInput
} from "./polymarket-execution-relay-auth.js";

export const predictfunRelayHeaders = {
  timestamp: "x-lotus-relay-timestamp",
  nonce: "x-lotus-relay-nonce",
  signature: "x-lotus-relay-signature"
} as const;

export type PredictfunRelaySignatureInput = PolymarketRelaySignatureInput;

export const createPredictfunRelayNonce = createPolymarketRelayNonce;
export const stablePredictfunRelayJsonStringify = stableJsonStringify;
export const buildPredictfunRelaySigningPayload = buildPolymarketRelaySigningPayload;
export const signPredictfunRelayRequest = signPolymarketRelayRequest;
export const verifyPredictfunRelayRequest = verifyPolymarketRelayRequest;
