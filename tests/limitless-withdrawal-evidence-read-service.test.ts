import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerInternalLimitlessWithdrawalEvidenceRoute } from "../src/api/routes/internal-limitless-withdrawal-evidence.js";
import {
  InternalWithdrawalEvidenceReadService,
  LimitlessWithdrawalEvidenceReadService,
  buildLimitlessWithdrawalEvidenceReadConfigFromEnv
} from "../src/core/funding/limitless-withdrawal-evidence-read-service.js";
import {
  ArtifactBackedWithdrawalCompletionPersistenceGate,
  validateWithdrawalEvidenceSmokeArtifact
} from "../src/core/funding/withdrawal-evidence.js";

const query = new URLSearchParams({
  userId: "user-1",
  withdrawalIntentId: "withdrawal-1",
  withdrawalRouteLegId: "leg-1",
  sourceVenue: "LIMITLESS",
  withdrawalTxHash: "0x1111111111111111111111111111111111111111111111111111111111111111"
});
const requestUrl = `/internal/funding/limitless/withdrawal-evidence?${query.toString()}`;

const writeFixture = async (record: Record<string, unknown>): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "lotus-limitless-withdrawal-evidence-"));
  const fixturePath = join(dir, "fixture.json");
  await writeFile(fixturePath, `${JSON.stringify({ records: [record] }, null, 2)}\n`, "utf8");
  return fixturePath;
};

describe("Limitless internal withdrawal evidence read service", () => {
  it("stays disabled unless explicit internal evidence-read config is enabled", () => {
    expect(buildLimitlessWithdrawalEvidenceReadConfigFromEnv({} as NodeJS.ProcessEnv)).toMatchObject({
      enabled: false,
      fixturePath: undefined
    });
  });

  it("serves only the normalized evidence contract over a local internal route", async () => {
    const fixturePath = await writeFixture({
      userId: "user-1",
      withdrawalIntentId: "withdrawal-1",
      withdrawalRouteLegId: "leg-1",
      sourceVenue: "LIMITLESS",
      withdrawalTxHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      status: "COMPLETED",
      venueReleased: true,
      destinationReceived: true,
      completed: true,
      destinationChain: "BASE",
      destinationWalletAddress: "0x2222222222222222222222222222222222222222",
      token: "USDC",
      amount: "40",
      confirmations: 1,
      observedAt: "2026-04-26T00:00:00.000Z",
      reason: "LIMITLESS_WITHDRAWAL_DESTINATION_CONFIRMED",
      apiKey: "server-side-key",
      authorization: "Bearer secret"
    });
    const app = Fastify();
    const service = new LimitlessWithdrawalEvidenceReadService({
      enabled: true,
      fixturePath
    });
    await registerInternalLimitlessWithdrawalEvidenceRoute(app, service, { nodeEnv: "development" });

    const response = await app.inject({ method: "GET", url: requestUrl });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      sourceVenue: "LIMITLESS",
      withdrawalTxHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      status: "COMPLETED",
      venueReleased: true,
      destinationReceived: true,
      completed: true,
      destinationChain: "BASE",
      destinationWalletAddress: "0x2222222222222222222222222222222222222222",
      token: "USDC",
      amount: "40",
      confirmations: 1,
      observedAt: "2026-04-26T00:00:00.000Z",
      reason: "LIMITLESS_WITHDRAWAL_DESTINATION_CONFIRMED"
    });
    expect(response.body).not.toContain("server-side-key");
    expect(response.body).not.toContain("authorization");
  });

  it("requires bearer auth when an internal read token is configured", async () => {
    const fixturePath = await writeFixture({
      sourceVenue: "LIMITLESS",
      withdrawalTxHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      status: "PENDING",
      venueReleased: false,
      destinationReceived: false,
      completed: false,
      reason: "LIMITLESS_WITHDRAWAL_PENDING"
    });
    const app = Fastify();
    const service = new LimitlessWithdrawalEvidenceReadService({
      enabled: true,
      fixturePath
    });
    await registerInternalLimitlessWithdrawalEvidenceRoute(app, service, {
      bearerToken: "internal-read-token",
      nodeEnv: "production"
    });

    const unauthorized = await app.inject({ method: "GET", url: requestUrl });
    expect(unauthorized.statusCode).toBe(401);

    const authorized = await app.inject({
      method: "GET",
      url: requestUrl,
      headers: { authorization: "Bearer internal-read-token" }
    });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json()).toMatchObject({
      sourceVenue: "LIMITLESS",
      status: "PENDING",
      venueReleased: false,
      destinationReceived: false,
      completed: false
    });
  });

  it("serves the same normalized route contract for other configured venues", async () => {
    const fixturePath = await writeFixture({
      userId: "user-1",
      withdrawalIntentId: "withdrawal-1",
      withdrawalRouteLegId: "leg-1",
      sourceVenue: "OPINION",
      withdrawalTxHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      status: "COMPLETED",
      venueReleased: true,
      destinationReceived: true,
      completed: true,
      destinationChain: "POLYGON",
      destinationWalletAddress: "0x3333333333333333333333333333333333333333",
      token: "USDC",
      amount: "40",
      confirmations: 1,
      reason: "OPINION_WITHDRAWAL_DESTINATION_CONFIRMED"
    });
    const app = Fastify();
    const service = new InternalWithdrawalEvidenceReadService({
      env: {
        OPINION_INTERNAL_WITHDRAWAL_EVIDENCE_READ_ENABLED: "true",
        OPINION_INTERNAL_WITHDRAWAL_EVIDENCE_FIXTURE_PATH: fixturePath
      } as NodeJS.ProcessEnv
    });
    await registerInternalLimitlessWithdrawalEvidenceRoute(app, service, {
      bearerTokenByVenue: { OPINION: "opinion-read-token" },
      nodeEnv: "production"
    });

    const opinionQuery = new URLSearchParams({
      ...Object.fromEntries(query.entries()),
      sourceVenue: "OPINION"
    });
    const response = await app.inject({
      method: "GET",
      url: `/internal/funding/opinion/withdrawal-evidence?${opinionQuery.toString()}`,
      headers: { authorization: "Bearer opinion-read-token" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sourceVenue: "OPINION",
      status: "COMPLETED",
      venueReleased: true,
      destinationReceived: true,
      completed: true,
      reason: "OPINION_WITHDRAWAL_DESTINATION_CONFIRMED"
    });
  });

  it("requires fresh non-synthetic read-only smoke evidence before completion persistence", () => {
    const blockers: string[] = [];
    validateWithdrawalEvidenceSmokeArtifact({
      generatedAt: "2026-04-26T00:00:00.000Z",
      venue: "LIMITLESS",
      status: "COMPLETED",
      readOnly: true,
      persistedCompletionResult: false,
      reconciliationRecordsBefore: 2,
      reconciliationRecordsAfter: 2,
      liveLifiExecutionEnabled: false,
      fundingPreflightEnforcementEnabled: false,
      liveVenueWithdrawalExecutionEnabled: false,
      backendBroadcastedTransaction: false,
      backendSignedTransaction: false,
      config: {
        mode: "LIVE_READ",
        configured: true,
        evidenceUrlConfigured: true,
        evidenceUrlHost: "evidence.lotus.internal",
        authMode: "BEARER",
        apiKeyConfigured: true
      },
      selectedWithdrawal: {
        synthetic: false,
        sourceVenue: "LIMITLESS",
        withdrawalTxHash: "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      evidenceResult: {
        status: "COMPLETED",
        venueReleased: true,
        destinationReceived: true,
        completed: true,
        withdrawalTxHash: "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      mappingObserved: "COMPLETED",
      redactionVerified: true,
      blockers: []
    }, {
      venue: "LIMITLESS",
      approvedHosts: ["evidence.lotus.internal"],
      maxAgeHours: 24,
      now: new Date("2026-04-26T01:00:00.000Z"),
      blockers
    });

    expect(blockers).toEqual([]);
  });

  it("blocks runtime completion persistence until a venue is explicitly enabled", async () => {
    const gate = new ArtifactBackedWithdrawalCompletionPersistenceGate({
      enabled: true,
      persistenceEnabled: false,
      enabledVenues: ["LIMITLESS"],
      maxAgeHours: 24,
      approvedHostsByVenue: { LIMITLESS: ["evidence.lotus.internal"] },
      now: () => new Date("2026-04-26T01:00:00.000Z")
    });

    await expect(gate.assertCanPersist({
      userId: "user-1",
      intent: {
        withdrawalIntentId: "withdrawal-1",
        userId: "user-1",
        token: "USDC",
        amount: "40",
        destinationChain: "POLYGON",
        destinationWalletAddress: "0x1111111111111111111111111111111111111111",
        status: "WITHDRAWING",
        idempotencyKey: "withdrawal-idem",
        aggregateRouteQuote: {},
        totalEstimatedFees: "0",
        totalEstimatedTimeSeconds: null,
        auditEventIds: [],
        createdAt: "2026-04-26T00:00:00.000Z",
        updatedAt: "2026-04-26T00:00:00.000Z"
      },
      leg: {
        withdrawalRouteLegId: "leg-1",
        withdrawalIntentId: "withdrawal-1",
        withdrawalSourceId: "source-1",
        sourceVenue: "LIMITLESS",
        sourceToken: "USDC",
        sourceAmount: "40",
        destinationChain: "POLYGON",
        destinationWalletAddress: "0x1111111111111111111111111111111111111111",
        destinationAmountEstimate: "40",
        routeProvider: "LOTUS_WITHDRAWAL_V0",
        routeQuote: {
          provider: "LOTUS_WITHDRAWAL_V0",
          providerRouteId: null,
          sourceVenue: "LIMITLESS",
          sourceToken: "USDC",
          sourceAmount: "40",
          destinationChain: "POLYGON",
          destinationWalletAddress: "0x1111111111111111111111111111111111111111",
          destinationAmountEstimate: "40",
          estimatedFees: "0",
          estimatedTimeSeconds: null,
          expiresAt: "2026-04-26T01:00:00.000Z",
          transactionRequest: null,
          userSafeSummary: "sandbox"
        },
        status: "VENUE_RELEASE_PENDING",
        txHashes: ["0x1111111111111111111111111111111111111111111111111111111111111111"],
        providerStatus: {},
        venueReleaseStatus: "PENDING",
        destinationStatus: "NOT_CONFIRMED",
        errorReason: null,
        createdAt: "2026-04-26T00:00:00.000Z",
        updatedAt: "2026-04-26T00:00:00.000Z"
      },
      result: {
        status: "COMPLETED",
        venueReleased: true,
        destinationReceived: true,
        completed: true,
        withdrawalTxHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
        reason: "LIMITLESS_WITHDRAWAL_DESTINATION_CONFIRMED"
      }
    })).rejects.toMatchObject({ code: "WITHDRAWAL_COMPLETION_PERSISTENCE_BLOCKED" });
  });
});
