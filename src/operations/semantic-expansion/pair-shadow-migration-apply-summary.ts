import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Pool } from "pg";

import type { PairRouteAdminService } from "../../api/admin/pair-route-admin-service.js";
import { PairPromotionDecisionRepository } from "../../rollout/pair-promotion-decision-repository.js";
import { PairShadowObservationRepository } from "../../shadow/pair-shadow-observation-repository.js";
import { writeArtifact, writeMarkdownArtifact } from "./shared.js";

export interface PairShadowMigrationApplySummary {
  observedAt: string;
  authoritativeStore: "SUPABASE_DB_URL";
  localStore: "DATABASE_URL";
  authoritative: {
    tables: readonly string[];
    writeVerification: {
      observationId: string | null;
      promotionDecisionId: string | null;
      success: boolean;
    };
  };
  local: {
    tables: readonly string[];
  };
  readPathVerification: {
    pairShadowEvidenceLoads: boolean;
    pairCanaryReadinessLoads: boolean;
    pairRouteAdminLoads: boolean;
  };
}

const loadTableNames = async (pool: Pool): Promise<readonly string[]> => {
  const result = await pool.query<{ table_name: string }>(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in ('pair_shadow_observations', 'pair_promotion_decisions')
    order by table_name
  `);
  return result.rows.map((row) => row.table_name);
};

const markdown = (summary: PairShadowMigrationApplySummary): string => `# Pair Shadow Migration Apply Summary

- Observed at: ${summary.observedAt}
- Authoritative store: ${summary.authoritativeStore}
- Local store: ${summary.localStore}
- Supabase tables present: ${summary.authoritative.tables.join(", ") || "none"}
- Local tables present: ${summary.local.tables.join(", ") || "none"}
- Authoritative write verification: ${summary.authoritative.writeVerification.success}
- Pair shadow evidence loads: ${summary.readPathVerification.pairShadowEvidenceLoads}
- Pair canary readiness loads: ${summary.readPathVerification.pairCanaryReadinessLoads}
- Pair route admin loads: ${summary.readPathVerification.pairRouteAdminLoads}

Supabase is authoritative for pair shadow evidence and canary truth in this pass. Local DB parity is diagnostic only.
`;

export const buildPairShadowMigrationApplySummary = async (input: {
  authoritativePool: Pool;
  localPool: Pool;
  pairRouteAdminService: Pick<PairRouteAdminService, "getShadowEvidence" | "getCanaryReadiness" | "listPairRoutes">;
}): Promise<PairShadowMigrationApplySummary> => {
  const authoritativeRepo = new PairShadowObservationRepository(input.authoritativePool);
  const decisionRepo = new PairPromotionDecisionRepository(authoritativeRepo);
  const authoritativeTables = await loadTableNames(input.authoritativePool);
  const localTables = await loadTableNames(input.localPool);

  let observationId: string | null = null;
  let promotionDecisionId: string | null = null;
  let evidenceLoads = false;
  let readinessLoads = false;
  let adminLoads = false;

  const verificationObservation = await authoritativeRepo.createObservation({
    routeClass: "PAIR_PM_OPINION",
    routeMode: "POLYMARKET_OPINION",
    sourceKind: "RUNTIME_OBSERVATION",
    scopeKind: "SAFE_EXACT_SUBSET",
    scopeKey: "verification:btc-mar-21",
    routeFamily: "CRYPTO:SAME_DAY_DIRECTIONAL",
    canonicalEventId: "verification:evt",
    canonicalMarketId: "verification:mkt",
    basisMode: "LIVE_ONLY",
    decisionTimestamp: new Date().toISOString(),
    candidateVenues: ["POLYMARKET", "OPINION"],
    chosenShadowRoute: "POLYMARKET_OPINION",
    baselineComparator: "verification",
    confidenceState: "HIGH",
    compatibilityState: "EXACT",
    exactnessClass: "semantic_exact_live_only",
    expectedNetPrice: 1,
    expectedEffectiveCost: 0.99,
    expectedSlippage: 0,
    expectedFillability: 1,
    blockedReason: null,
    staleData: false,
    mixedBasis: false,
    insufficientBasis: false,
    insufficientEvidence: false,
    liveDataClean: true,
    executionBoundaryHealthy: true,
    venueHealthHealthy: true,
    reproducibilityHash: PairShadowObservationRepository.buildReproducibilityHash({ verification: true, observedAt: Date.now() }),
    replayEnvelopeId: null,
    metadata: {
      verification: true,
      authoritativeStore: "SUPABASE_DB_URL"
    }
  });
  observationId = verificationObservation.id;

  const verificationDecision = await decisionRepo.create({
    routeClass: "PAIR_PM_OPINION",
    scopePromoted: "verification_only",
    evidenceWindowStart: new Date().toISOString(),
    evidenceWindowEnd: new Date().toISOString(),
    metricsSnapshot: { verification: true },
    thresholdsEvaluated: { verification: true },
    pass: false,
    operatorIdentity: "migration-verify",
    previousRolloutState: "INTERNAL_ONLY",
    newRolloutState: "INTERNAL_ONLY",
    rollbackReference: null,
    metadata: {
      verification: true,
      authoritativeStore: "SUPABASE_DB_URL"
    }
  });
  promotionDecisionId = verificationDecision.id;

  await input.pairRouteAdminService.listPairRoutes();
  adminLoads = true;
  await input.pairRouteAdminService.getShadowEvidence("PAIR_PM_LIMITLESS");
  evidenceLoads = true;
  await input.pairRouteAdminService.getCanaryReadiness("PAIR_PM_LIMITLESS");
  readinessLoads = true;

  return {
    observedAt: new Date().toISOString(),
    authoritativeStore: "SUPABASE_DB_URL",
    localStore: "DATABASE_URL",
    authoritative: {
      tables: authoritativeTables,
      writeVerification: {
        observationId,
        promotionDecisionId,
        success: Boolean(observationId && promotionDecisionId)
      }
    },
    local: {
      tables: localTables
    },
    readPathVerification: {
      pairShadowEvidenceLoads: evidenceLoads,
      pairCanaryReadinessLoads: readinessLoads,
      pairRouteAdminLoads: adminLoads
    }
  };
};

export const writePairShadowMigrationApplySummary = async (
  repoRoot: string,
  input: {
    authoritativePool: Pool;
    localPool: Pool;
    pairRouteAdminService: Pick<PairRouteAdminService, "getShadowEvidence" | "getCanaryReadiness" | "listPairRoutes">;
  }
): Promise<PairShadowMigrationApplySummary> => {
  const summary = await buildPairShadowMigrationApplySummary(input);
  mkdirSync(path.resolve(repoRoot, "docs"), { recursive: true });
  writeArtifact(repoRoot, "docs/pair-shadow-migration-apply-summary.json", summary);
  writeMarkdownArtifact(repoRoot, "docs/pair-shadow-migration-apply-summary.md", markdown(summary));
  return summary;
};
