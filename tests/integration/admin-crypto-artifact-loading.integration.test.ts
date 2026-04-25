import { existsSync } from "node:fs";
import path from "node:path";

import type { Pool, QueryResult } from "pg";
import { describe, expect, it } from "vitest";

import { CryptoAdminService } from "../../src/api/admin/crypto-admin-service.js";

const expectedLaneIds = [
  "CRYPTO_BTC_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET",
  "CRYPTO_ETH_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET",
  "CRYPTO_SOL_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET",
  "CRYPTO_XRP_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET",
  "CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT",
  "CRYPTO_ETH_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT",
  "CRYPTO_SOL_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT",
  "CRYPTO_BNB_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT",
  "CRYPTO_BTC_FIRST_TO_THRESHOLD_BY_DATE_PAIR_POLYMARKET_PREDICT",
  "CRYPTO_ETH_FIRST_TO_THRESHOLD_BY_DATE_PAIR_POLYMARKET_PREDICT",
  "CRYPTO_SOL_FIRST_TO_THRESHOLD_BY_DATE_PAIR_POLYMARKET_PREDICT",
  "CRYPTO_EXTENDED_FDV_ONE_DAY_AFTER_LAUNCH_PAIR_POLYMARKET_PREDICT",
  "CRYPTO_METAMASK_FDV_ONE_DAY_AFTER_LAUNCH_PAIR_POLYMARKET_PREDICT",
  "CRYPTO_OPENSEA_FDV_ONE_DAY_AFTER_LAUNCH_PAIR_POLYMARKET_PREDICT",
  "CRYPTO_REYA_FDV_ONE_DAY_AFTER_LAUNCH_PAIR_POLYMARKET_PREDICT",
  "CRYPTO_METAMASK_TOKEN_LAUNCH_BY_DATE_PAIR_POLYMARKET_PREDICT",
  "CRYPTO_BASE_TOKEN_LAUNCH_BY_DATE_PAIR_POLYMARKET_PREDICT"
] as const;

const stubPool = {
  query: async (): Promise<QueryResult> => ({
    command: "SELECT",
    rowCount: 0,
    oid: 0,
    fields: [],
    rows: []
  })
} as unknown as Pool;

describe("crypto admin artifact loading", () => {
  it("loads every pushed crypto lane artifact without env or live DB dependencies", async () => {
    const repoRoot = path.resolve(process.cwd());
    const service = new CryptoAdminService({ pool: stubPool, repoRoot });

    const lanes = await service.listLanes();
    expect(lanes.map((lane) => lane.laneId).sort()).toEqual([...expectedLaneIds].sort());

    for (const laneId of expectedLaneIds) {
      const lane = await service.getLane(laneId);
      const readiness = await service.getReadiness(laneId);
      const rollbackPlan = await service.getRollbackPlan(laneId);
      const authorityState = await service.getLaneAuthorityState(laneId);

      expect(lane.candidateSet.length).toBeGreaterThan(0);
      expect(readiness.candidateSet.length).toBeGreaterThan(0);
      expect(readiness.exactSafeTopics.length).toBeGreaterThan(0);
      expect(rollbackPlan.rollbackTarget).toBe("LANE_HOLD");
      expect(authorityState.operatorApprovedToOffer).toBe(false);

      for (const sourceArtifactRef of lane.sourceArtifactRefs) {
        expect(existsSync(path.resolve(repoRoot, sourceArtifactRef)), sourceArtifactRef).toBe(true);
      }
    }
  });
});
