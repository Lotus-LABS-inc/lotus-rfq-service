import { randomUUID } from "node:crypto";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";

import type { FundingIntent, FundingRouteLeg, FundingTarget, FundingVenue } from "../../src/core/funding/types.js";
import { buildVenueCapabilityMatrix } from "../../src/core/funding/venue-capabilities.js";
import { isFundingVenueReadinessSupported } from "../../src/core/funding/venue-readiness.js";
import { FundingRepository } from "../../src/repositories/funding.repository.js";

loadDotenv();

const requestedVenue = (process.argv[2] ?? "").toUpperCase();
if (!isFundingVenueReadinessSupported(requestedVenue)) {
  throw new Error("Pass one supported venue: POLYMARKET, LIMITLESS, OPINION, MYRIAD, or PREDICT_FUN.");
}

const venue: FundingVenue = requestedVenue;
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL is required to seed a funding readiness smoke row.");
}

const capability = buildVenueCapabilityMatrix({ env: process.env })[venue];
if (capability.readinessStatus !== "READY") {
  throw new Error(`${venue} funding capability is not configured. Set ${venue}_FUNDING_DESTINATION_ADDRESS first.`);
}

const now = new Date().toISOString();
const fundingIntentId = randomUUID();
const fundingTargetId = randomUUID();
const routeLegId = randomUUID();
const userId = process.env[`FUNDING_${venue}_SMOKE_SEED_USER_ID`] ?? process.env.FUNDING_SMOKE_SEED_USER_ID ?? `smoke-${venue.toLowerCase()}-readiness-user`;
const amount = process.env[`FUNDING_${venue}_SMOKE_SEED_AMOUNT`] ?? process.env.FUNDING_SMOKE_SEED_AMOUNT ?? "100";
const txHash = `0x${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`.slice(0, 66);

const intent: FundingIntent = {
  fundingIntentId,
  userId,
  sourceChain: "SOLANA",
  sourceToken: "USDC",
  sourceAmount: amount,
  sourceWalletAddress: "smoke-test-solana-wallet",
  status: "ROUTES_SUBMITTED",
  idempotencyKey: `${venue.toLowerCase()}-readiness-smoke-${randomUUID()}`,
  aggregateRouteQuote: {
    source: "venue-readiness-smoke-seed",
    targetVenue: venue,
    readOnly: true
  },
  totalEstimatedFees: "0",
  totalEstimatedTimeSeconds: null,
  auditEventIds: [],
  createdAt: now,
  updatedAt: now
};

const target: FundingTarget = {
  fundingTargetId,
  fundingIntentId,
  targetVenue: venue,
  targetChain: capability.preferredChain,
  targetToken: capability.preferredToken,
  targetAmount: amount,
  targetPercentage: 100,
  venueCapabilitySnapshot: {
    source: "venue-readiness-smoke-seed",
    targetVenue: venue,
    readOnly: true
  },
  status: "LEG_VENUE_CREDIT_PENDING",
  createdAt: now,
  updatedAt: now
};

const leg: FundingRouteLeg = {
  routeLegId,
  fundingIntentId,
  fundingTargetId,
  targetVenue: venue,
  sourceChain: "SOLANA",
  sourceToken: "USDC",
  sourceAmount: amount,
  destinationChain: capability.preferredChain,
  destinationToken: capability.preferredToken,
  destinationAmountEstimate: amount,
  routeProvider: "LIFI",
  routeQuote: {
    provider: "LIFI",
    providerRouteId: `${venue.toLowerCase()}-readiness-smoke-seed`,
    sourceChain: "SOLANA",
    sourceToken: "USDC",
    sourceAmount: amount,
    destinationChain: capability.preferredChain,
    destinationToken: capability.preferredToken,
    destinationAmountEstimate: amount,
    estimatedFees: "0",
    estimatedTimeSeconds: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    transactionRequest: null,
    userSafeSummary: "Read-only smoke-test funding row. No transaction was broadcast by Lotus."
  },
  txHashes: [],
  providerStatus: {
    source: "venue-readiness-smoke-seed",
    targetVenue: venue,
    readOnly: true
  },
  bridgeStatus: "PENDING",
  destinationStatus: "PENDING",
  venueCreditStatus: "PENDING",
  status: "LEG_SIGNATURE_REQUIRED",
  errorReason: null,
  createdAt: now,
  updatedAt: now
};

const pool = new Pool({ connectionString: databaseUrl });
try {
  const repository = new FundingRepository(pool);
  await repository.createIntent(intent, [target]);
  await repository.appendAuditEvent({
    fundingIntentId,
    eventType: "FUNDING_INTENT_CREATED",
    payload: { source: "venue-readiness-smoke-seed", targetVenue: venue, readOnly: true }
  });
  await repository.replaceRouteLegs(fundingIntentId, [leg]);
  await repository.appendAuditEvent({
    fundingIntentId,
    eventType: "FUNDING_ROUTES_QUOTED",
    payload: { routeLegCount: 1, provider: "LIFI", targetVenue: venue, source: "venue-readiness-smoke-seed" }
  });
  await repository.updateRouteLegSubmission({
    routeLegId,
    txHash,
    status: "LEG_BRIDGE_PENDING"
  });
  await repository.appendAuditEvent({
    fundingIntentId,
    routeLegId,
    eventType: "FUNDING_LEG_SUBMITTED",
    payload: { txHash, targetVenue: venue, source: "venue-readiness-smoke-seed" }
  });
  await repository.updateRouteLegProviderStatus({
    routeLegId,
    status: "LEG_VENUE_CREDIT_PENDING",
    bridgeStatus: "DONE",
    destinationStatus: "CONFIRMED",
    venueCreditStatus: "PENDING",
    providerStatus: { source: "venue-readiness-smoke-seed", status: "DONE_COMPLETED", targetVenue: venue },
    errorReason: null
  });
  await repository.updateIntentStatus(fundingIntentId, "ROUTES_SUBMITTED");
  await repository.createReconciliationRecord({
    fundingIntentId,
    routeLegId,
    targetVenue: venue,
    destinationTxHash: txHash,
    destinationReceived: true,
    venueCreditConfirmed: false,
    readyToTrade: false,
    notes: "SMOKE_TEST_DESTINATION_CONFIRMED"
  });
  await repository.appendAuditEvent({
    fundingIntentId,
    routeLegId,
    eventType: "FUNDING_LEG_DESTINATION_RECEIVED",
    payload: { txHash, targetVenue: venue, source: "venue-readiness-smoke-seed" }
  });
  await repository.appendAuditEvent({
    fundingIntentId,
    routeLegId,
    eventType: "FUNDING_LEG_VENUE_CREDIT_PENDING",
    payload: { targetVenue: venue, source: "venue-readiness-smoke-seed" }
  });
  console.log(JSON.stringify({
    fundingIntentId,
    routeLegId,
    userId,
    targetVenue: venue,
    destinationStatus: "CONFIRMED",
    venueCreditStatus: "PENDING",
    readOnlySeed: true
  }, null, 2));
} finally {
  await pool.end();
}
