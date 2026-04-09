import type { BtcAuditData, BtcSourceHygieneSummary } from "./btc-audit-types.js";
import { listBtcSourceHygieneRejectedRows } from "./btc-audit-shared.js";

const increment = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

export const buildBtcSourceHygieneSummary = (data: BtcAuditData): BtcSourceHygieneSummary => {
  const rejected = listBtcSourceHygieneRejectedRows(data.localMarkets.map((entry) => entry.row));
  const reasons: Record<string, number> = {};
  for (const row of rejected) {
    for (const reason of row.sourceHygieneReasons) {
      increment(reasons, reason);
    }
  }
  return {
    observedAt: new Date().toISOString(),
    rejectedRowCount: rejected.length,
    reasons,
    examples: rejected.slice(0, 9).map((row) => ({
      venue: row.venue,
      venueMarketId: row.venueMarketId,
      title: row.title,
      reasons: row.sourceHygieneReasons
    }))
  };
};

