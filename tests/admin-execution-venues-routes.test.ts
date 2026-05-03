import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type preHandlerHookHandler } from "fastify";
import { describe, expect, it } from "vitest";

import { ExecutionVenuesAdminService } from "../src/api/admin/execution-venues-admin-service.js";
import { registerAdminExecutionVenuesRoutes } from "../src/api/admin/execution-venues.routes.js";

const adminMiddleware: preHandlerHookHandler = async (request) => {
  (request as typeof request & { user: { userId: string; role: string } }).user = {
    userId: "admin-user",
    role: "ADMIN"
  };
};

const liveReadyEnv: NodeJS.ProcessEnv = {
  POLYMARKET_EXECUTION_MODE: "v2",
  POLYMARKET_LIVE_EXECUTION_ENABLED: "true",
  POLYMARKET_CLOB_HOST: "https://clob.polymarket.com",
  POLYMARKET_CHAIN_ID: "137",
  POLYMARKET_API_KEY: "server-side-key",
  POLYMARKET_API_SECRET: "server-side-secret",
  POLYMARKET_API_PASSPHRASE: "server-side-passphrase",
  POLYMARKET_BUILDER_CODE: "0x6c4b67c64d2acb6381b5c8a5016495aece3d922799553ef2989254777f21c15c",
  POLYMARKET_PRIVATE_KEY: "0x59c6995e998f97a5a004497e5daae82f0e6d4d6e773f8f5a11a95d2218e14e4f",
  LIMITLESS_EXECUTION_MODE: "backend_signer",
  LIMITLESS_LIVE_EXECUTION_ENABLED: "false",
  LIMITLESS_BASE_URL: "https://api.limitless.exchange",
  LIMITLESS_API_KEY: "server-side-limitless-key",
  LIMITLESS_EXECUTION_PRIVATE_KEY: "0x59c6995e998f97a5a004497e5daae82f0e6d4d6e773f8f5a11a95d2218e14e4f",
  OPINION_CLOB_BASE_URL: "https://proxy.opinion.trade:8443/openapi",
  OPINION_API_KEY: "server-side-opinion-key",
  PREDICT_MAINNET_BASE_URL: "https://api.predict.fun/",
  PREDICT_API_KEY: "server-side-predict-key"
};

const buildService = async (): Promise<ExecutionVenuesAdminService> => {
  const repoRoot = await mkdtemp(join(tmpdir(), "lotus-execution-venues-"));
  const artifactDir = join(repoRoot, "artifacts", "execution");
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    join(artifactDir, "polymarket-live-submit-checklist.json"),
    `${JSON.stringify({
      generatedAt: "2026-04-25T00:00:00.000Z",
      submitted: false,
      plan: {
        mode: "LIVE_SUBMIT_READY",
        blockers: [],
        warnings: ["Polygon mainnet detected; use the smallest possible operator-approved order."]
      },
      error: {
        code: "POLYMARKET_V2_UNAUTHORIZED",
        message: "Unauthorized/Invalid api key",
        status: 401
      }
    })}\n`,
    "utf8"
  );
  return new ExecutionVenuesAdminService({ repoRoot, env: liveReadyEnv });
};

const buildServiceWithVenueAccounts = async (): Promise<ExecutionVenuesAdminService> => {
  const repoRoot = await mkdtemp(join(tmpdir(), "lotus-execution-venues-"));
  return new ExecutionVenuesAdminService({
    repoRoot,
    env: liveReadyEnv,
    venueAccountRepository: {
      async countActiveAccountsByVenue() {
        return { POLYMARKET: 1, OPINION: 2 };
      }
    }
  });
};

describe("admin execution venue readiness routes", () => {
  it("lists Polymarket as structurally ready but externally blocked by venue auth without exposing secrets", async () => {
    const app = Fastify({ logger: false });
    await registerAdminExecutionVenuesRoutes(app, adminMiddleware, {
      executionVenuesAdminService: await buildService()
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/admin/execution-venues"
    });
    expect(listResponse.statusCode).toBe(200);
    const body = listResponse.json();
    expect(body.venues).toHaveLength(5);
    expect(body.venues[0]).toMatchObject({
      venue: "POLYMARKET",
      adapter: "PolymarketExecutionAdapterV2",
      executionSigningModel: "BACKEND_SIGNER",
      structuralReadiness: "LIVE_READY",
      operationalStatus: "EXTERNALLY_BLOCKED",
      marketRoutingCoverage: "COVERED_BY_MATCHING",
      liveSubmissionSupported: true,
      liveExecutionEnabled: true,
      venueAccountRequired: true,
      venueAccountConfigured: false,
      requiredEnvPresent: true,
      lastHarnessAttempt: {
        artifactPresent: true,
        submitted: false,
        errorCode: "POLYMARKET_V2_UNAUTHORIZED",
        errorStatus: 401
      }
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("server-side-key");
    expect(serialized).not.toContain("server-side-secret");
    expect(serialized).not.toContain("server-side-passphrase");
    expect(serialized).not.toContain("server-side-limitless-key");
    expect(serialized).not.toContain("server-side-opinion-key");
    expect(serialized).not.toContain("server-side-predict-key");
    expect(serialized).not.toContain(liveReadyEnv.LIMITLESS_EXECUTION_PRIVATE_KEY);
    expect(serialized).not.toContain(liveReadyEnv.POLYMARKET_PRIVATE_KEY);
    expect(body.venues.find((venue: { venue: string }) => venue.venue === "LIMITLESS")).toMatchObject({
      venue: "LIMITLESS",
      adapter: "LimitlessExecutionAdapter",
      executionSigningModel: "BACKEND_SIGNER",
      structuralReadiness: "LIVE_DISABLED",
      operationalStatus: "LIVE_DISABLED",
      marketRoutingCoverage: "COVERED_BY_MATCHING",
      liveSubmissionSupported: true,
      liveExecutionEnabled: false
    });
    expect(body.venues.find((entry: { venue: string }) => entry.venue === "OPINION")).toMatchObject({
      venue: "OPINION",
      adapter: "OpinionExecutionAdapter",
      executionSigningModel: "USER_SIGNED_BACKEND_RELAY",
      structuralReadiness: "NOT_CONFIGURED",
      liveSubmissionSupported: false,
      liveExecutionEnabled: false,
      venueAccountRequired: true,
      venueAccountConfigured: false,
      activeLinkedAccounts: 0
    });
    expect(body.venues.find((entry: { venue: string }) => entry.venue === "PREDICT_FUN")).toMatchObject({
      venue: "PREDICT_FUN",
      adapter: "PredictFunExecutionAdapter",
      executionSigningModel: "USER_SIGNED_BACKEND_RELAY",
      structuralReadiness: "NOT_CONFIGURED",
      liveSubmissionSupported: true,
      liveExecutionEnabled: false
    });
    expect(body.venues.find((entry: { venue: string }) => entry.venue === "MYRIAD")).toMatchObject({
      venue: "MYRIAD",
      adapter: "NOT_IMPLEMENTED",
      executionSigningModel: "USER_SIGNED",
      liveSubmissionSupported: false,
      liveExecutionEnabled: false
    });

    const detailResponse = await app.inject({
      method: "GET",
      url: "/admin/execution-venues/polymarket"
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json().venue.operatorMessage).toContain("structurally ready");

    const nonPolymarketResponse = await app.inject({
      method: "GET",
      url: "/admin/execution-venues/limitless"
    });
    expect(nonPolymarketResponse.statusCode).toBe(200);
    expect(nonPolymarketResponse.json().venue.operatorMessage).toContain("live execution is disabled");

    const missingResponse = await app.inject({
      method: "GET",
      url: "/admin/execution-venues/kalshi"
    });
    expect(missingResponse.statusCode).toBe(404);

    await app.close();
  });

  it("reports active linked venue accounts without exposing account internals", async () => {
    const app = Fastify({ logger: false });
    await registerAdminExecutionVenuesRoutes(app, adminMiddleware, {
      executionVenuesAdminService: await buildServiceWithVenueAccounts()
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/execution-venues"
    });
    expect(response.statusCode).toBe(200);
    const polymarket = response.json().venues.find((entry: { venue: string }) => entry.venue === "POLYMARKET");
    expect(polymarket).toMatchObject({
      venueAccountRequired: true,
      venueAccountConfigured: true,
      activeLinkedAccounts: 1,
      accountSetupBlockers: []
    });
    const opinion = response.json().venues.find((entry: { venue: string }) => entry.venue === "OPINION");
    expect(opinion).toMatchObject({
      venueAccountRequired: true,
      venueAccountConfigured: true,
      activeLinkedAccounts: 2,
      accountSetupBlockers: []
    });
    expect(response.body).not.toContain("providerSubOrgId");
    expect(response.body).not.toContain("providerWalletAccountId");
    expect(response.body).not.toContain("privateKey");
    await app.close();
  });
});
