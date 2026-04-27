import { describe, expect, it, vi } from "vitest";
import { buildOpsReadServer } from "../src/ops-read-service.js";
import type {
  InternalWithdrawalEvidenceReadInput,
  InternalWithdrawalEvidenceReadOutput
} from "../src/core/funding/limitless-withdrawal-evidence-read-service.js";

const balanceUrl = "/lotus/polymarket/funding-balance?userId=user-1&fundingIntentId=funding-1&routeLegId=leg-1";

const evidenceQuery = new URLSearchParams({
  userId: "user-1",
  withdrawalIntentId: "withdrawal-1",
  withdrawalRouteLegId: "withdrawal-leg-1",
  sourceVenue: "OPINION",
  withdrawalTxHash: "0xb4718cf1f5bf6f1332dcc5ef4c8534668dd2765329d317b64d413b173b8bdb35"
});

const normalizedEvidence: InternalWithdrawalEvidenceReadOutput = {
  sourceVenue: "OPINION",
  withdrawalTxHash: "0xb4718cf1f5bf6f1332dcc5ef4c8534668dd2765329d317b64d413b173b8bdb35",
  status: "COMPLETED",
  venueReleased: true,
  destinationReceived: true,
  completed: true,
  destinationChain: "BSC",
  destinationWalletAddress: "0x5c2a7bf969c813dd79587b6aada5877476281072",
  token: "USDT",
  amount: "6.77",
  confirmations: 12,
  observedAt: "2026-04-27T00:00:00.000Z",
  reason: "OPINION_WITHDRAWAL_DESTINATION_CONFIRMED"
};

const expectNoSecrets = (body: string): void => {
  const lowered = body.toLowerCase();
  expect(lowered).not.toContain("authorization");
  expect(lowered).not.toContain("privatekey");
  expect(lowered).not.toContain("private_key");
  expect(lowered).not.toContain("apikey");
  expect(lowered).not.toContain("api_key");
  expect(lowered).not.toContain("database_url");
  expect(lowered).not.toContain("db_url");
  expect(lowered).not.toContain("rawprovider");
  expect(lowered).not.toContain("signer");
};

describe("ops read service", () => {
  it("returns an ops-only health response", async () => {
    const app = await buildOpsReadServer({ env: { NODE_ENV: "production" } as NodeJS.ProcessEnv });
    const response = await app.inject({ method: "GET", url: "/health" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "lotus-ops-read-service"
    });
  });

  it("requires bearer auth for funding balance reads in production", async () => {
    const app = await buildOpsReadServer({
      env: {
        NODE_ENV: "production",
        POLYMARKET_FUNDING_READ_API_KEY: "read-token"
      } as NodeJS.ProcessEnv,
      polymarketFundingBalanceReader: {
        readUsableBalance: async () => ({ usableBalance: "10" })
      }
    });

    const missing = await app.inject({ method: "GET", url: balanceUrl });
    const wrong = await app.inject({
      method: "GET",
      url: balanceUrl,
      headers: { authorization: "Bearer wrong-token" }
    });
    await app.close();

    expect(missing.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
  });

  it("serves only usableBalance for Polymarket funding balance reads", async () => {
    const app = await buildOpsReadServer({
      env: {
        NODE_ENV: "production",
        POLYMARKET_FUNDING_READ_API_KEY: "read-token"
      } as NodeJS.ProcessEnv,
      polymarketFundingBalanceReader: {
        readUsableBalance: async () => ({ usableBalance: "42.5" })
      }
    });

    const response = await app.inject({
      method: "GET",
      url: balanceUrl,
      headers: { authorization: "Bearer read-token" }
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ usableBalance: "42.5" });
    expectNoSecrets(response.body);
  });

  it("fails closed for non-Polymarket funding balance routes when upstream mode is disabled", async () => {
    const app = await buildOpsReadServer({
      env: {
        NODE_ENV: "production",
        OPINION_FUNDING_READ_API_KEY: "read-token",
        OPINION_OPS_FUNDING_BALANCE_MODE: "DISABLED"
      } as NodeJS.ProcessEnv
    });

    const response = await app.inject({
      method: "GET",
      url: "/lotus/opinion/funding-balance?userId=user-1&fundingIntentId=funding-1&routeLegId=leg-1",
      headers: { authorization: "Bearer read-token" }
    });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: "OPINION_FUNDING_BALANCE_READ_NOT_CONFIGURED"
    });
  });

  it("normalizes non-Polymarket HTTP upstream funding balances", async () => {
    const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
      expect(String(input)).toContain("targetVenue=MYRIAD");
      expect(init?.headers instanceof Headers ? init.headers.get("authorization") : null).toBe("Bearer upstream-token");
      return new Response(JSON.stringify({ availableBalance: "77.25", rawProviderPayload: "must-not-return" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    const app = await buildOpsReadServer({
      env: {
        NODE_ENV: "production",
        MYRIAD_FUNDING_READ_API_KEY: "read-token",
        MYRIAD_OPS_FUNDING_BALANCE_MODE: "HTTP_UPSTREAM",
        MYRIAD_OPS_FUNDING_BALANCE_UPSTREAM_URL: "https://ops-upstream.example/myriad/balance",
        MYRIAD_OPS_FUNDING_BALANCE_UPSTREAM_AUTH_MODE: "BEARER",
        MYRIAD_OPS_FUNDING_BALANCE_UPSTREAM_API_KEY: "upstream-token"
      } as NodeJS.ProcessEnv,
      fetchImpl
    });

    const response = await app.inject({
      method: "GET",
      url: "/lotus/myriad/funding-balance?userId=user-1&fundingIntentId=funding-1&routeLegId=leg-1",
      headers: { authorization: "Bearer read-token" }
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ usableBalance: "77.25" });
    expect(response.body).not.toContain("rawProviderPayload");
    expectNoSecrets(response.body);
  });

  it("serves normalized withdrawal evidence for supported user-action venues only", async () => {
    const withdrawalEvidenceReader = {
      readEvidence: vi.fn(async (input: InternalWithdrawalEvidenceReadInput) => ({
        ...normalizedEvidence,
        sourceVenue: input.sourceVenue
      }))
    };
    const app = await buildOpsReadServer({
      env: {
        NODE_ENV: "production",
        POLYMARKET_WITHDRAWAL_EVIDENCE_API_KEY: "evidence-token",
        OPINION_WITHDRAWAL_EVIDENCE_API_KEY: "evidence-token",
        MYRIAD_WITHDRAWAL_EVIDENCE_API_KEY: "evidence-token",
        PREDICT_FUN_WITHDRAWAL_EVIDENCE_API_KEY: "evidence-token"
      } as NodeJS.ProcessEnv,
      withdrawalEvidenceReader
    });

    const responses = [];
    for (const venuePath of ["polymarket", "opinion", "myriad", "predictfun"]) {
      const sourceVenue = venuePath === "predictfun" ? "PREDICT_FUN" : venuePath.toUpperCase();
      const query = new URLSearchParams(evidenceQuery);
      query.set("sourceVenue", sourceVenue);
      responses.push(await app.inject({
        method: "GET",
        url: `/lotus/${venuePath}/withdrawal-evidence?${query.toString()}`,
        headers: { authorization: "Bearer evidence-token" }
      }));
    }
    const unsupported = await app.inject({
      method: "GET",
      url: `/lotus/unknown/withdrawal-evidence?${evidenceQuery.toString()}`,
      headers: { authorization: "Bearer evidence-token" }
    });
    await app.close();

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200, 200]);
    expect(responses.map((response) => response.json().sourceVenue)).toEqual([
      "POLYMARKET",
      "OPINION",
      "MYRIAD",
      "PREDICT_FUN"
    ]);
    expect(unsupported.statusCode).toBe(404);
    expect(withdrawalEvidenceReader.readEvidence).toHaveBeenCalledWith({
      userId: "user-1",
      withdrawalIntentId: "withdrawal-1",
      withdrawalRouteLegId: "withdrawal-leg-1",
      sourceVenue: "POLYMARKET",
      withdrawalTxHash: "0xb4718cf1f5bf6f1332dcc5ef4c8534668dd2765329d317b64d413b173b8bdb35"
    });
    for (const response of responses) {
      expectNoSecrets(response.body);
    }
  });

  it("requires bearer auth for withdrawal evidence reads in production", async () => {
    const app = await buildOpsReadServer({
      env: {
        NODE_ENV: "production",
        OPINION_WITHDRAWAL_EVIDENCE_API_KEY: "evidence-token"
      } as NodeJS.ProcessEnv,
      withdrawalEvidenceReader: {
        readEvidence: async () => normalizedEvidence
      }
    });

    const response = await app.inject({
      method: "GET",
      url: `/lotus/opinion/withdrawal-evidence?${evidenceQuery.toString()}`
    });
    await app.close();

    expect(response.statusCode).toBe(401);
  });
});
