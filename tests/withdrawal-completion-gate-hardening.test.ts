import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  ArtifactBackedWithdrawalCompletionPersistenceGate,
  validateWithdrawalEvidenceSmokeArtifact,
  type WithdrawalEvidenceSmokeArtifact
} from "../src/core/funding/withdrawal-evidence.js";

const now = new Date("2026-04-27T00:00:00.000Z");

describe("withdrawal completion persistence gate hardening", () => {
  it("allows non-production approved localhost evidence when exact and non-synthetic", () => {
    const blockers: string[] = [];
    validateWithdrawalEvidenceSmokeArtifact(validPredictFunArtifact(), {
      venue: "PREDICT_FUN",
      approvedHosts: ["127.0.0.1:4012"],
      maxAgeHours: 24,
      production: false,
      now,
      blockers
    });

    expect(blockers).toEqual([]);
  });

  it("rejects localhost evidence hosts in production mode", () => {
    const blockers: string[] = [];
    validateWithdrawalEvidenceSmokeArtifact(validPredictFunArtifact(), {
      venue: "PREDICT_FUN",
      approvedHosts: ["127.0.0.1:4012"],
      maxAgeHours: 24,
      production: true,
      now,
      blockers
    });

    expect(blockers).toContain("Production withdrawal completion persistence must not use localhost or loopback evidence hosts.");
  });

  it("rejects fixture-backed or synthetic smoke artifacts", () => {
    const blockers: string[] = [];
    validateWithdrawalEvidenceSmokeArtifact({
      ...validPredictFunArtifact(),
      selectedWithdrawal: {
        ...validPredictFunArtifact().selectedWithdrawal,
        synthetic: true
      },
      evidenceResult: {
        ...validPredictFunArtifact().evidenceResult!,
        evidence: {
          source: "fixture"
        }
      }
    }, {
      venue: "PREDICT_FUN",
      approvedHosts: ["127.0.0.1:4012"],
      maxAgeHours: 24,
      now,
      blockers
    });

    expect(blockers).toContain("Artifact must use a real submitted withdrawal row, not synthetic fallback.");
    expect(blockers).toContain("Artifact must not be fixture-backed for withdrawal completion persistence.");
  });

  it("requires exact Predict.fun BSC USDT evidence fields", () => {
    const blockers: string[] = [];
    validateWithdrawalEvidenceSmokeArtifact({
      ...validPredictFunArtifact(),
      evidenceResult: {
        ...validPredictFunArtifact().evidenceResult!,
        destinationChain: "POLYGON",
        token: "USDC",
        amount: "1"
      }
    }, {
      venue: "PREDICT_FUN",
      approvedHosts: ["127.0.0.1:4012"],
      maxAgeHours: 24,
      now,
      blockers
    });

    expect(blockers).toContain("Artifact completion evidence destination chain must match the selected withdrawal.");
    expect(blockers).toContain("Predict.fun withdrawal evidence must be for destinationChain=BSC.");
    expect(blockers).toContain("Predict.fun withdrawal evidence must be for token=USDT.");
    expect(blockers).toContain("Predict.fun withdrawal evidence amount must be greater than or equal to the selected withdrawal amount.");
  });

  it("requires exact Myriad BSC USD1 evidence fields", () => {
    const blockers: string[] = [];
    validateWithdrawalEvidenceSmokeArtifact({
      ...validMyriadArtifact(),
      evidenceResult: {
        ...validMyriadArtifact().evidenceResult!,
        destinationChain: "ABSTRACT",
        token: "USDC.e",
        amount: "1"
      }
    }, {
      venue: "MYRIAD",
      approvedHosts: ["127.0.0.1:4012"],
      maxAgeHours: 24,
      now,
      blockers
    });

    expect(blockers).toContain("Artifact completion evidence destination chain must match the selected withdrawal.");
    expect(blockers).toContain("Myriad withdrawal evidence must be for destinationChain=BSC.");
    expect(blockers).toContain("Myriad withdrawal evidence must be for token=USD1.");
    expect(blockers).toContain("Myriad withdrawal evidence amount must be greater than or equal to the selected withdrawal amount.");
  });

  it("requires exact Opinion BSC USDT evidence fields", () => {
    const blockers: string[] = [];
    validateWithdrawalEvidenceSmokeArtifact({
      ...validOpinionArtifact(),
      evidenceResult: {
        ...validOpinionArtifact().evidenceResult!,
        destinationChain: "POLYGON",
        token: "USDC",
        amount: "1"
      }
    }, {
      venue: "OPINION",
      approvedHosts: ["127.0.0.1:4012"],
      maxAgeHours: 24,
      now,
      blockers
    });

    expect(blockers).toContain("Artifact completion evidence destination chain must match the selected withdrawal.");
    expect(blockers).toContain("Opinion withdrawal evidence must be for destinationChain=BSC.");
    expect(blockers).toContain("Opinion withdrawal evidence must be for token=USDT.");
    expect(blockers).toContain("Opinion withdrawal evidence amount must be greater than or equal to the selected withdrawal amount.");
  });


  it("rejects persistence when more than one venue is enabled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "withdrawal-gate-"));
    const artifactPath = join(dir, "predict-fun-withdrawal-evidence-smoke-test.json");
    await writeFile(artifactPath, `${JSON.stringify(validPredictFunArtifact())}\n`, "utf8");

    const gate = new ArtifactBackedWithdrawalCompletionPersistenceGate({
      enabled: true,
      persistenceEnabled: true,
      enabledVenues: ["PREDICT_FUN", "POLYMARKET"],
      maxAgeHours: 24,
      artifactPathByVenue: {
        PREDICT_FUN: artifactPath
      },
      approvedHostsByVenue: {
        PREDICT_FUN: ["127.0.0.1:4012"]
      },
      production: false,
      now: () => now
    });

    await expect(gate.assertCanPersist({
      userId: "user-1",
      intent: {} as never,
      leg: { sourceVenue: "PREDICT_FUN", txHashes: ["0xabc"] } as never,
      result: { withdrawalTxHash: "0xabc" } as never
    })).rejects.toThrow("exactly one reviewed venue");
  });
});

const validPredictFunArtifact = (): WithdrawalEvidenceSmokeArtifact => ({
  generatedAt: "2026-04-27T00:00:00.000Z",
  venue: "PREDICT_FUN",
  status: "COMPLETED",
  readOnly: true,
  persistedCompletionResult: false,
  reconciliationRecordsBefore: 0,
  reconciliationRecordsAfter: 0,
  liveLifiExecutionEnabled: false,
  fundingPreflightEnforcementEnabled: false,
  liveVenueWithdrawalExecutionEnabled: false,
  backendBroadcastedTransaction: false,
  backendSignedTransaction: false,
  config: {
    mode: "LIVE_READ",
    configured: true,
    evidenceUrlConfigured: true,
    evidenceUrlHost: "127.0.0.1:4012",
    authMode: "NONE",
    apiKeyConfigured: false,
    minimumConfirmations: 1
  },
  selectedWithdrawal: {
    synthetic: false,
    sourceVenue: "PREDICT_FUN",
    withdrawalTxHash: "0xabc",
    destinationChain: "BSC",
    destinationWalletAddress: "0x1111111111111111111111111111111111111111",
    requiredAmount: "2.99"
  },
  evidenceResult: {
    status: "COMPLETED",
    venueReleased: true,
    destinationReceived: true,
    completed: true,
    withdrawalTxHash: "0xabc",
    destinationChain: "BSC",
    destinationWalletAddress: "0x1111111111111111111111111111111111111111",
    token: "USDT",
    amount: "2.99",
    evidence: {
      confirmations: 12,
      source: "predict_fun_withdrawal_evidence"
    }
  },
  mappingObserved: "COMPLETED",
  redactionVerified: true,
  blockers: []
});

const validMyriadArtifact = (): WithdrawalEvidenceSmokeArtifact => ({
  generatedAt: "2026-04-27T00:00:00.000Z",
  venue: "MYRIAD",
  status: "COMPLETED",
  readOnly: true,
  persistedCompletionResult: false,
  reconciliationRecordsBefore: 0,
  reconciliationRecordsAfter: 0,
  liveLifiExecutionEnabled: false,
  fundingPreflightEnforcementEnabled: false,
  liveVenueWithdrawalExecutionEnabled: false,
  backendBroadcastedTransaction: false,
  backendSignedTransaction: false,
  config: {
    mode: "LIVE_READ",
    configured: true,
    evidenceUrlConfigured: true,
    evidenceUrlHost: "127.0.0.1:4012",
    authMode: "NONE",
    apiKeyConfigured: false,
    minimumConfirmations: 1
  },
  selectedWithdrawal: {
    synthetic: false,
    sourceVenue: "MYRIAD",
    withdrawalTxHash: "0xabc",
    destinationChain: "BSC",
    destinationWalletAddress: "0x1111111111111111111111111111111111111111",
    requiredAmount: "40"
  },
  evidenceResult: {
    status: "COMPLETED",
    venueReleased: true,
    destinationReceived: true,
    completed: true,
    withdrawalTxHash: "0xabc",
    destinationChain: "BSC",
    destinationWalletAddress: "0x1111111111111111111111111111111111111111",
    token: "USD1",
    amount: "40",
    evidence: {
      confirmations: 12,
      source: "myriad_withdrawal_evidence"
    }
  },
  mappingObserved: "COMPLETED",
  redactionVerified: true,
  blockers: []
});

const validOpinionArtifact = (): WithdrawalEvidenceSmokeArtifact => ({
  generatedAt: "2026-04-27T00:00:00.000Z",
  venue: "OPINION",
  status: "COMPLETED",
  readOnly: true,
  persistedCompletionResult: false,
  reconciliationRecordsBefore: 0,
  reconciliationRecordsAfter: 0,
  liveLifiExecutionEnabled: false,
  fundingPreflightEnforcementEnabled: false,
  liveVenueWithdrawalExecutionEnabled: false,
  backendBroadcastedTransaction: false,
  backendSignedTransaction: false,
  config: {
    mode: "LIVE_READ",
    configured: true,
    evidenceUrlConfigured: true,
    evidenceUrlHost: "127.0.0.1:4012",
    authMode: "NONE",
    apiKeyConfigured: false,
    minimumConfirmations: 1
  },
  selectedWithdrawal: {
    synthetic: false,
    sourceVenue: "OPINION",
    withdrawalTxHash: "0xabc",
    destinationChain: "BSC",
    destinationWalletAddress: "0x1111111111111111111111111111111111111111",
    requiredAmount: "6.77"
  },
  evidenceResult: {
    status: "COMPLETED",
    venueReleased: true,
    destinationReceived: true,
    completed: true,
    withdrawalTxHash: "0xabc",
    destinationChain: "BSC",
    destinationWalletAddress: "0x1111111111111111111111111111111111111111",
    token: "USDT",
    amount: "6.77",
    evidence: {
      confirmations: 12,
      source: "opinion_withdrawal_evidence"
    }
  },
  mappingObserved: "COMPLETED",
  redactionVerified: true,
  blockers: []
});
