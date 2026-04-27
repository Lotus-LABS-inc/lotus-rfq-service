import { describe, expect, it } from "vitest";

import {
  buildPredictFunWithdrawalProdReadiness,
  buildWithdrawalRolloutStatus
} from "../src/core/funding/withdrawal-operator-reports.js";
import type { WithdrawalEvidenceSmokeArtifact } from "../src/core/funding/withdrawal-evidence.js";

const now = new Date("2026-04-27T00:00:00.000Z");

describe("withdrawal operator reports", () => {
  it("passes Predict.fun production readiness with fresh exact artifacts", () => {
    const artifact = buildPredictFunWithdrawalProdReadiness({
      now,
      env: {
        PREDICT_FUN_WITHDRAWAL_EVIDENCE_APPROVED_HOSTS: "evidence.lotus.internal",
        FUNDING_WITHDRAWAL_COMPLETION_PERSISTENCE_ENABLED: "false"
      } as NodeJS.ProcessEnv,
      smokeArtifactPath: "artifacts/funding/predict-fun-withdrawal-evidence-smoke-test.json",
      smokeArtifact: validSmoke(),
      completionGateArtifactPath: "artifacts/funding/predict-fun-withdrawal-completion-persistence-gate.json",
      completionGateArtifact: {
        status: "PASSED",
        venue: "PREDICT_FUN"
      },
      controlledPersistenceArtifactPath: "artifacts/funding/withdrawal-completion-controlled-persistence-test.json",
      controlledPersistenceArtifact: null
    });

    expect(artifact.status).toBe("PASSED");
    expect(artifact.checks.exactBscUsdtEvidence).toBe(true);
    expect(artifact.safety.persistenceChanged).toBe(false);
  });

  it("fails Predict.fun production readiness for stale, synthetic, fixture, or unapproved artifacts", () => {
    const artifact = buildPredictFunWithdrawalProdReadiness({
      now,
      env: {
        PREDICT_FUN_WITHDRAWAL_EVIDENCE_APPROVED_HOSTS: "evidence.lotus.internal"
      } as NodeJS.ProcessEnv,
      smokeArtifactPath: "smoke.json",
      smokeArtifact: {
        ...validSmoke(),
        generatedAt: "2026-04-25T00:00:00.000Z",
        selectedWithdrawal: {
          ...validSmoke().selectedWithdrawal!,
          synthetic: true
        },
        config: {
          ...validSmoke().config!,
          evidenceUrlHost: "localhost:4001"
        },
        evidenceResult: {
          ...validSmoke().evidenceResult!,
          evidence: {
            source: "fixture",
            confirmations: 12
          }
        }
      },
      completionGateArtifactPath: "gate.json",
      completionGateArtifact: {
        status: "FAILED",
        venue: "PREDICT_FUN"
      },
      controlledPersistenceArtifactPath: "persistence.json",
      controlledPersistenceArtifact: {
        status: "COMPLETED",
        venue: "POLYMARKET",
        gatePassed: true
      }
    });

    expect(artifact.status).toBe("FAILED");
    expect(artifact.blockers).toContain("Artifact must use a real submitted withdrawal row, not synthetic fallback.");
    expect(artifact.blockers).toContain("Artifact must not be fixture-backed for withdrawal completion persistence.");
    expect(artifact.blockers).toContain("Controlled persistence artifact, if present, must be scoped to PREDICT_FUN only.");
    expect(artifact.blockers.some((blocker) => blocker.includes("older than"))).toBe(true);
  });

  it("summarizes all venue withdrawal rollout classifications without enabling execution", () => {
    const artifact = buildWithdrawalRolloutStatus(now);

    expect(artifact.venues.map((row) => row.venue)).toEqual([
      "POLYMARKET",
      "PREDICT_FUN",
      "LIMITLESS",
      "OPINION",
      "MYRIAD"
    ]);
    expect(artifact.venues.find((row) => row.venue === "LIMITLESS")).toMatchObject({
      classification: "SERVER_INITIATED_WITHDRAWAL",
      executionAllowed: false
    });
    expect(artifact.venues.find((row) => row.venue === "PREDICT_FUN")).toMatchObject({
      classification: "USER_WALLET_AUTHORIZED_ACTION_CANDIDATE",
      executionAllowed: false
    });
    expect(JSON.stringify(artifact)).not.toMatch(/authorization|privateKey|seed phrase|rawProviderPayload/i);
  });
});

const validSmoke = (): WithdrawalEvidenceSmokeArtifact => ({
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
    evidenceUrlHost: "evidence.lotus.internal",
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
