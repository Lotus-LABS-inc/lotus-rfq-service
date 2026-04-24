#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool, type PoolClient } from "pg";

import {
  BROKEN_CANONICAL_MARKET_IDS,
  CANONICAL_MARKET_REWRITE_SPEC,
  EXACT_OVERLAP_ASSESSMENTS,
  type RewriteVenue
} from "../../src/simulation/canonical-market-rewrite-spec.js";

const envCandidates = [path.resolve(process.cwd(), "..", ".env"), path.resolve(process.cwd(), ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const resolveProfileId = async (
  client: PoolClient,
  canonicalEventId: string,
  canonicalMarketId: string,
  venue: RewriteVenue
): Promise<string> => {
  const result = await client.query<{ id: string }>(
    `SELECT id
       FROM resolution_profiles
      WHERE canonical_event_id = $1
        AND canonical_market_id = $2
        AND venue = $3
      LIMIT 1`,
    [canonicalEventId, canonicalMarketId, venue]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Missing resolution profile for ${canonicalEventId}:${canonicalMarketId}:${venue}.`);
  }

  return row.id;
};

const sortProfileIds = (left: string, right: string): readonly [string, string] =>
  left.localeCompare(right) <= 0 ? [left, right] : [right, left];

const main = async (): Promise<void> => {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
    application_name: "rewrite-canonical-exact-markets"
  });

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const rewrittenStates: Array<{ from: string; to: string; rowCount: number }> = [];
    const rewrittenProfiles: Array<{ venue: string; from: string; to: string }> = [];

    for (const definition of CANONICAL_MARKET_REWRITE_SPEC) {
      const stateUpdate = await client.query(
        `UPDATE historical_market_states
            SET canonical_market_id = $3
          WHERE canonical_event_id = $1
            AND canonical_market_id = $2`,
        [
          definition.canonicalEventId,
          definition.oldCanonicalMarketId,
          definition.legacyCanonicalMarketId
        ]
      );

      rewrittenStates.push({
        from: definition.oldCanonicalMarketId,
        to: definition.legacyCanonicalMarketId,
        rowCount: stateUpdate.rowCount ?? 0
      });

      for (const target of definition.targets) {
        const profileUpdate = await client.query(
          `UPDATE resolution_profiles
              SET canonical_market_id = $4,
                  primary_resolution_text = $5,
                  updated_at = NOW()
            WHERE canonical_event_id = $1
              AND canonical_market_id = $2
              AND venue = $3`,
          [
            definition.canonicalEventId,
            definition.oldCanonicalMarketId,
            target.venue,
            target.canonicalMarketId,
            target.primaryResolutionText
          ]
        );

        if (profileUpdate.rowCount !== 1) {
          throw new Error(
            `Expected exactly one resolution_profiles row for ${definition.oldCanonicalMarketId}:${target.venue}; updated ${profileUpdate.rowCount ?? 0}.`
          );
        }

        rewrittenProfiles.push({
          venue: target.venue,
          from: definition.oldCanonicalMarketId,
          to: target.canonicalMarketId
        });
      }
    }

    const deletedAssessments = await client.query(
      `DELETE FROM resolution_risk_assessments
        WHERE canonical_market_id = ANY($1::text[])`,
      [BROKEN_CANONICAL_MARKET_IDS]
    );

    const insertedAssessments: string[] = [];
    for (const assessment of EXACT_OVERLAP_ASSESSMENTS) {
      const marketAProfileId = await resolveProfileId(
        client,
        assessment.canonicalEventId,
        assessment.canonicalMarketId,
        assessment.marketA.venue
      );
      const marketBProfileId = await resolveProfileId(
        client,
        assessment.canonicalEventId,
        assessment.canonicalMarketId,
        assessment.marketB.venue
      );
      const [orderedMarketAProfileId, orderedMarketBProfileId] = sortProfileIds(marketAProfileId, marketBProfileId);

      const insertResult = await client.query(
        `INSERT INTO resolution_risk_assessments
            (canonical_event_id, canonical_market_id, market_a_profile_id, market_b_profile_id, risk_score, confidence_score, equivalence_class, factor_breakdown, reasons, version, computed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, NOW())
         ON CONFLICT (canonical_event_id, canonical_market_id, market_a_profile_id, market_b_profile_id, version)
         DO UPDATE
             SET risk_score = EXCLUDED.risk_score,
                 confidence_score = EXCLUDED.confidence_score,
                 equivalence_class = EXCLUDED.equivalence_class,
                 factor_breakdown = EXCLUDED.factor_breakdown,
                 reasons = EXCLUDED.reasons,
                 computed_at = NOW()`,
        [
          assessment.canonicalEventId,
          assessment.canonicalMarketId,
          orderedMarketAProfileId,
          orderedMarketBProfileId,
          assessment.riskScore,
          assessment.confidenceScore,
          assessment.equivalenceClass,
          JSON.stringify(assessment.factorBreakdown),
          JSON.stringify(assessment.reasons),
          assessment.version
        ]
      );

      if ((insertResult.rowCount ?? 0) !== 1) {
        throw new Error(`Failed to insert exact overlap assessment for ${assessment.canonicalMarketId}.`);
      }

      insertedAssessments.push(assessment.canonicalMarketId);
    }

    const legacyCountsResult = await client.query<{ canonical_market_id: string; row_count: string }>(
      `SELECT canonical_market_id, COUNT(*)::text AS row_count
         FROM historical_market_states
        WHERE canonical_market_id = ANY($1::text[])
        GROUP BY canonical_market_id
        ORDER BY canonical_market_id ASC`,
      [CANONICAL_MARKET_REWRITE_SPEC.map((definition) => definition.legacyCanonicalMarketId)]
    );

    const remainingBrokenProfiles = await client.query<{ row_count: string }>(
      `SELECT COUNT(*)::text AS row_count
         FROM resolution_profiles
        WHERE canonical_market_id = ANY($1::text[])`,
      [BROKEN_CANONICAL_MARKET_IDS]
    );

    const remainingBrokenAssessments = await client.query<{ row_count: string }>(
      `SELECT COUNT(*)::text AS row_count
         FROM resolution_risk_assessments
        WHERE canonical_market_id = ANY($1::text[])`,
      [BROKEN_CANONICAL_MARKET_IDS]
    );

    await client.query("COMMIT");

    console.log(
      JSON.stringify({
        rewrittenStates,
        rewrittenProfiles,
        deletedAssessmentRows: deletedAssessments.rowCount ?? 0,
        insertedAssessments,
        legacyHistoricalCounts: legacyCountsResult.rows,
        remainingBrokenProfileRows: Number.parseInt(remainingBrokenProfiles.rows[0]?.row_count ?? "0", 10),
        remainingBrokenAssessmentRows: Number.parseInt(remainingBrokenAssessments.rows[0]?.row_count ?? "0", 10)
      })
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
};

main().catch((error: unknown) => {
  console.error("Failed to rewrite canonical markets into exact proposition markets.");
  console.error(error);
  process.exit(1);
});
