import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import { describe, expect, it } from "vitest";

import {
  FundingReadinessAdminService,
  type FundingReadinessAdminRepository
} from "../src/api/admin/funding-readiness-admin-service.js";
import { registerAdminFundingReadinessRoutes } from "../src/api/admin/funding-readiness.routes.js";
import { createAdminAuthMiddleware } from "../src/api/user-auth-middleware.js";
import type { FundingAdminReadinessRecord } from "../src/repositories/funding.repository.js";

class FakeFundingReadinessRepository implements FundingReadinessAdminRepository {
  public constructor(public readonly rows: FundingAdminReadinessRecord[]) {}

  public async listAdminReadinessRows(filter: {
    fundingIntentId?: string;
    userId?: string;
    venue?: string;
    limit?: number;
  } = {}): Promise<FundingAdminReadinessRecord[]> {
    return this.rows.filter((row) => {
      if (filter.fundingIntentId && row.fundingIntentId !== filter.fundingIntentId) {
        return false;
      }
      if (filter.userId && row.userId !== filter.userId) {
        return false;
      }
      if (filter.venue && row.targetVenue !== filter.venue.toUpperCase()) {
        return false;
      }
      return true;
    });
  }
}

const baseRow = (patch: Partial<FundingAdminReadinessRecord> = {}): FundingAdminReadinessRecord => ({
  fundingIntentId: "intent-disabled",
  userId: "user-disabled",
  targetVenue: "POLYMARKET",
  sourceChain: "SOLANA",
  sourceToken: "USDC",
  sourceAmount: "100",
  targetChain: "POLYGON",
  targetToken: "USDC",
  targetAmount: "100",
  routeLegId: "leg-disabled",
  destinationChain: "POLYGON",
  destinationToken: "USDC",
  destinationAmountEstimate: "99",
  routeProvider: "LIFI",
  aggregateFundingStatus: "BRIDGING",
  routeLegStatus: "LEG_BRIDGE_PENDING",
  bridgeStatus: "PENDING",
  destinationStatus: "PENDING",
  venueCreditStatus: "PENDING",
  txHashes: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
  errorReason: null,
  destinationTxHash: null,
  destinationReceived: false,
  venueCreditConfirmed: false,
  readyToTrade: false,
  reconciliationCheckedAt: null,
  reconciliationNotes: null,
  auditEventIds: ["audit-disabled"],
  createdAt: "2026-04-25T00:00:00.000Z",
  updatedAt: "2026-04-25T00:00:00.000Z",
  ...patch
});

const rows: FundingAdminReadinessRecord[] = [
  baseRow(),
  baseRow({
    fundingIntentId: "intent-pending",
    userId: "user-pending",
    routeLegId: "leg-pending",
    aggregateFundingStatus: "PARTIALLY_READY_TO_TRADE",
    routeLegStatus: "LEG_VENUE_CREDIT_PENDING",
    bridgeStatus: "DONE",
    destinationStatus: "CONFIRMED",
    venueCreditStatus: "PENDING",
    destinationTxHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    destinationReceived: true,
    venueCreditConfirmed: false,
    readyToTrade: false,
    reconciliationCheckedAt: "2026-04-25T00:01:00.000Z",
    reconciliationNotes: "Destination received, venue credit pending.",
    auditEventIds: ["audit-pending"]
  }),
  baseRow({
    fundingIntentId: "intent-ready",
    userId: "user-ready",
    routeLegId: "leg-ready",
    aggregateFundingStatus: "READY_TO_TRADE",
    routeLegStatus: "LEG_READY_TO_TRADE",
    bridgeStatus: "DONE",
    destinationStatus: "CONFIRMED",
    venueCreditStatus: "CONFIRMED",
    destinationTxHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    destinationReceived: true,
    venueCreditConfirmed: true,
    readyToTrade: true,
    reconciliationCheckedAt: "2026-04-25T00:02:00.000Z",
    reconciliationNotes: "Ready balance confirmed.",
    auditEventIds: ["audit-ready"]
  }),
  baseRow({
    fundingIntentId: "intent-unknown",
    userId: "user-unknown",
    routeLegId: "leg-unknown",
    aggregateFundingStatus: "BRIDGING",
    routeLegStatus: "LEG_VENUE_CREDIT_PENDING",
    bridgeStatus: "DONE",
    destinationStatus: "CONFIRMED",
    venueCreditStatus: "UNKNOWN",
    destinationReceived: true,
    venueCreditConfirmed: false,
    readyToTrade: false,
    reconciliationCheckedAt: "2026-04-25T00:03:00.000Z",
    reconciliationNotes: "Malformed provider response included API_KEY server-side-secret and transactionRequest internals.",
    auditEventIds: ["audit-unknown"]
  })
];

const buildApp = async (repository = new FakeFundingReadinessRepository(rows)) => {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: "test-secret" });
  await registerAdminFundingReadinessRoutes(app, createAdminAuthMiddleware(), {
    fundingReadinessAdminService: new FundingReadinessAdminService({
      repository,
      env: {
        FUNDING_VENUE_READINESS_CHECKS_ENABLED: "false",
        POLYMARKET_FUNDING_READINESS_ENABLED: "false",
        LIFI_API_KEY: "server-side-secret"
      }
    })
  });
  return app;
};

describe("admin funding readiness routes", () => {
  it("requires admin auth", async () => {
    const app = await buildApp();
    const userToken = app.jwt.sign({ userId: "user-1", role: "USER" });
    const adminToken = app.jwt.sign({ userId: "admin-1", role: "ADMIN" });

    const unauthorized = await app.inject({ method: "GET", url: "/admin/funding/readiness" });
    expect(unauthorized.statusCode).toBe(401);

    const forbidden = await app.inject({
      method: "GET",
      url: "/admin/funding/readiness",
      headers: { authorization: `Bearer ${userToken}` }
    });
    expect(forbidden.statusCode).toBe(403);

    const ok = await app.inject({
      method: "GET",
      url: "/admin/funding/readiness",
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().readiness).toHaveLength(4);
    await app.close();
  });

  it("reports deterministic readiness statuses without mutating funding rows", async () => {
    const repository = new FakeFundingReadinessRepository(rows.map((row) => ({ ...row })));
    const before = JSON.stringify(repository.rows);
    const app = await buildApp(repository);
    const adminToken = app.jwt.sign({ userId: "admin-1", role: "ADMIN" });
    const headers = { authorization: `Bearer ${adminToken}` };

    const response = await app.inject({ method: "GET", url: "/admin/funding/readiness", headers });
    expect(response.statusCode).toBe(200);
    expect(JSON.stringify(repository.rows)).toBe(before);

    const readiness = response.json().readiness;
    expect(readiness.find((row: any) => row.fundingIntentId === "intent-disabled")).toMatchObject({
      readinessStatus: "DESTINATION_NOT_CONFIRMED",
      readyToTrade: false,
      checkerMode: "DISABLED"
    });
    expect(readiness.find((row: any) => row.fundingIntentId === "intent-pending")).toMatchObject({
      readinessStatus: "VENUE_CREDIT_PENDING",
      readyToTrade: false,
      reasonNotReady: "Destination received, venue credit pending."
    });
    expect(readiness.find((row: any) => row.fundingIntentId === "intent-ready")).toMatchObject({
      readinessStatus: "READY_TO_TRADE",
      readyToTrade: true,
      reasonNotReady: null
    });
    expect(readiness.find((row: any) => row.fundingIntentId === "intent-unknown")).toMatchObject({
      readinessStatus: "UNKNOWN",
      readyToTrade: false,
      reasonNotReady: "Sensitive provider evidence was redacted."
    });

    const serialized = response.body;
    expect(serialized).not.toContain("server-side-secret");
    expect(serialized).not.toContain("API_KEY");
    expect(serialized).not.toContain("transactionRequest");
    expect(serialized).not.toContain("privateKey");
    expect(serialized).not.toContain("authorization");
    await app.close();
  });

  it("resolves checker mode and source for newly supported funding venues", async () => {
    const repository = new FakeFundingReadinessRepository([
      baseRow({
        fundingIntentId: "intent-opinion",
        userId: "user-opinion",
        targetVenue: "OPINION"
      }),
      baseRow({
        fundingIntentId: "intent-myriad",
        userId: "user-myriad",
        targetVenue: "MYRIAD"
      }),
      baseRow({
        fundingIntentId: "intent-predict-fun",
        userId: "user-predict-fun",
        targetVenue: "PREDICT_FUN"
      })
    ]);
    const service = new FundingReadinessAdminService({
      repository,
      env: {
        FUNDING_VENUE_READINESS_CHECKS_ENABLED: "true",
        OPINION_FUNDING_READINESS_MODE: "LIVE_READ",
        OPINION_FUNDING_BALANCE_URL: "https://operator.example/opinion-readiness",
        MYRIAD_FUNDING_READINESS_MODE: "STUB",
        PREDICT_FUN_FUNDING_READINESS_MODE: "LIVE_READ"
      } as NodeJS.ProcessEnv
    });

    const readiness = await service.listReadiness();
    expect(readiness.find((row) => row.targetVenue === "OPINION")).toMatchObject({
      checkerMode: "LIVE_READ",
      checkerSource: "opinion_funding_readiness"
    });
    expect(readiness.find((row) => row.targetVenue === "MYRIAD")).toMatchObject({
      checkerMode: "STUB",
      checkerSource: "myriad_funding_readiness"
    });
    expect(readiness.find((row) => row.targetVenue === "PREDICT_FUN")).toMatchObject({
      checkerMode: "NOT_CONFIGURED",
      checkerSource: "predict_fun_funding_readiness"
    });
  });

  it("filters by intent, user, and venue and returns 404 for unknown intent", async () => {
    const app = await buildApp();
    const adminToken = app.jwt.sign({ userId: "admin-1", role: "ADMIN" });
    const headers = { authorization: `Bearer ${adminToken}` };

    const byIntent = await app.inject({
      method: "GET",
      url: "/admin/funding/readiness/intent-ready",
      headers
    });
    expect(byIntent.statusCode).toBe(200);
    expect(byIntent.json().readiness).toHaveLength(1);
    expect(byIntent.json().readiness[0].fundingIntentId).toBe("intent-ready");

    const byUser = await app.inject({
      method: "GET",
      url: "/admin/funding/readiness/user/user-ready",
      headers
    });
    expect(byUser.statusCode).toBe(200);
    expect(byUser.json().readiness.map((row: any) => row.userId)).toEqual(["user-ready"]);

    const byVenue = await app.inject({
      method: "GET",
      url: "/admin/funding/readiness/venue/polymarket",
      headers
    });
    expect(byVenue.statusCode).toBe(200);
    expect(byVenue.json().readiness).toHaveLength(4);

    const missing = await app.inject({
      method: "GET",
      url: "/admin/funding/readiness/does-not-exist",
      headers
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it("summarizes readiness counts and preserves redaction", async () => {
    const app = await buildApp();
    const adminToken = app.jwt.sign({ userId: "admin-1", role: "ADMIN" });
    const response = await app.inject({
      method: "GET",
      url: "/admin/funding/readiness/summary",
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().summary).toMatchObject({
      totalFundingIntents: 4,
      totalRouteLegs: 4,
      readyToTrade: 1,
      venueCreditPending: 1,
      destinationNotConfirmed: 1,
      failed: 0,
      unknown: 1,
      countsByVenue: { POLYMARKET: 4 },
      countsByReadinessStatus: {
        DESTINATION_NOT_CONFIRMED: 1,
        VENUE_CREDIT_PENDING: 1,
        READY_TO_TRADE: 1,
        FAILED: 0,
        UNKNOWN: 1
      },
      countsByCheckerMode: {
        DISABLED: 4
      },
      countsByRouteProvider: { LIFI: 4 }
    });
    expect(response.json().summary.blockedRows.unknown[0].reasonNotReady).toBe("Sensitive provider evidence was redacted.");
    expect(response.body).not.toContain("server-side-secret");
    expect(response.body).not.toContain("transactionRequest");
    expect(response.body).not.toContain("API_KEY");
    await app.close();
  });

  it("documents the implemented admin funding readiness surface in OpenAPI", async () => {
    const openApi = await readFile(new URL("../docs/api/openapi.yaml", import.meta.url), "utf8");
    expect(openApi).toContain("Admin Funding Readiness");
    expect(openApi).toContain("/admin/funding/readiness:");
    expect(openApi).toContain("/admin/funding/readiness/summary:");
    expect(openApi).toContain("/admin/funding/readiness/{fundingIntentId}:");
    expect(openApi).toContain("/admin/funding/readiness/user/{userId}:");
    expect(openApi).toContain("/admin/funding/readiness/venue/{venue}:");
    expect(openApi).toContain("AdminFundingReadinessRow:");
    expect(openApi).toContain("AdminFundingReadinessListResponse:");
    expect(openApi).toContain("AdminFundingReadinessSummaryResponse:");
    expect(openApi).toContain("FundingCheckerMode:");
    expect(openApi).toContain("FundingReadinessStatus:");
  });
});
