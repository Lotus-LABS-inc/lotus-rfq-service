import type { Pool } from "pg";
import type { LPReliabilityProfile } from "../core/lp-reliability-engine.js";

export type LPStatsProfile = LPReliabilityProfile;

interface LPStatsRow {
  lp_id: string;
  avg_response_time_ms: string;
  quote_hit_rate: string;
  reject_rate: string;
  execution_fail_rate: string;
  competitiveness_score: string;
  total_quotes: string;
  total_executions: string;
}

export class LPStatsRepository {
  public constructor(private readonly pool: Pool) { }

  public async recordQuoteSubmission(lpId: string, responseTimeMs: number): Promise<void> {
    const safeResponseMs = Math.max(0, responseTimeMs);

    await this.pool.query(
      `INSERT INTO lp_stats (
        lp_id,
        avg_response_time_ms,
        total_quotes,
        competitiveness_score
      )
      VALUES ($1, $2, 1, 0.5)
      ON CONFLICT (lp_id) DO UPDATE
      SET
        total_quotes = lp_stats.total_quotes + 1,
        avg_response_time_ms = (
          (lp_stats.avg_response_time_ms * lp_stats.total_quotes) + EXCLUDED.avg_response_time_ms
        ) / (lp_stats.total_quotes + 1),
        updated_at = NOW(),
        quote_hit_rate = CASE 
          WHEN (lp_stats.total_quotes + 1) = 0 THEN 0 
          ELSE lp_stats.successful_quotes::numeric / (lp_stats.total_quotes + 1) 
        END,
        reject_rate = CASE 
          WHEN (lp_stats.total_quotes + 1) = 0 THEN 0 
          ELSE lp_stats.rejected_quotes::numeric / (lp_stats.total_quotes + 1) 
        END`,
      [lpId, safeResponseMs]
    );
  }

  public async recordExecutionSuccess(lpId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO lp_stats (
        lp_id,
        total_executions,
        total_quotes,
        successful_quotes,
        quote_hit_rate,
        competitiveness_score
      )
      VALUES ($1, 1, 0, 1, 1, 1)
      ON CONFLICT (lp_id) DO UPDATE
      SET
        total_executions = lp_stats.total_executions + 1,
        successful_quotes = lp_stats.successful_quotes + 1,
        quote_hit_rate = CASE
          WHEN lp_stats.total_quotes = 0 THEN 0
          ELSE (lp_stats.successful_quotes + 1)::numeric / lp_stats.total_quotes
        END,
        updated_at = NOW(),
        execution_fail_rate = CASE 
          WHEN (lp_stats.total_executions + 1) = 0 THEN 0 
          ELSE lp_stats.failed_executions::numeric / (lp_stats.total_executions + 1) 
        END`,
      [lpId]
    );
  }

  public async recordExecutionFailure(lpId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO lp_stats (
        lp_id,
        total_executions,
        failed_executions,
        execution_fail_rate,
        competitiveness_score
      )
      VALUES ($1, 1, 1, 1, 0)
      ON CONFLICT (lp_id) DO UPDATE
      SET
        total_executions = lp_stats.total_executions + 1,
        failed_executions = lp_stats.failed_executions + 1,
        execution_fail_rate = CASE
          WHEN (lp_stats.total_executions + 1) = 0 THEN 0
          ELSE (lp_stats.failed_executions + 1)::numeric / (lp_stats.total_executions + 1)
        END,
        competitiveness_score = GREATEST(0, lp_stats.competitiveness_score - 0.05),
        updated_at = NOW()`,
      [lpId]
    );
  }

  public async getProfilesByLpIds(lpIds: readonly string[]): Promise<Record<string, LPStatsProfile>> {
    if (lpIds.length === 0) {
      return {};
    }

    const result = await this.pool.query<LPStatsRow>(
      `SELECT
        lp_id,
        avg_response_time_ms::text,
        quote_hit_rate::text,
        reject_rate::text,
        execution_fail_rate::text,
        competitiveness_score::text,
        total_quotes::text,
        total_executions::text
      FROM lp_stats
      WHERE lp_id = ANY($1::text[])`,
      [lpIds]
    );

    const profiles: Record<string, LPStatsProfile> = {};
    for (const row of result.rows) {
      profiles[row.lp_id] = {
        lpId: row.lp_id,
        avgResponseTimeMs: Number.parseFloat(row.avg_response_time_ms),
        quoteHitRate: Number.parseFloat(row.quote_hit_rate),
        rejectRate: Number.parseFloat(row.reject_rate),
        executionFailRate: Number.parseFloat(row.execution_fail_rate),
        competitivenessScore: Number.parseFloat(row.competitiveness_score),
        totalQuotes: Number.parseInt(row.total_quotes, 10),
        totalExecutions: Number.parseInt(row.total_executions, 10)
      };
    }

    return profiles;
  }
}
