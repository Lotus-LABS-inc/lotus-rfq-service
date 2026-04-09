import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { classifyStructuredOpinionFamily } from "../../integrations/opinion/opinion-family-classifier.js";
import { inferCryptoCutoffStyle, type OpinionCryptoCutoffStyle } from "../../integrations/opinion/opinion-crypto-date-family-matrix.js";
import { LimitlessHistoricalClient } from "../../integrations/limitless/limitless-client.js";
import { PredexonHistoricalClient, type PredexonMarket } from "../../integrations/predexon/predexon-client.js";
import { parseStructuredProposition, type StructuredProposition } from "../../simulation/proposition-matching.js";

export type VenueAuditEvidenceProvenance =
  | "ingested"
  | "api_confirmed"
  | "snapshot_supported"
  | "unknown_partial";

export interface VenueAuditSourceCandidate {
  venue: "POLYMARKET" | "LIMITLESS";
  venueMarketId: string;
  title: string;
  rules: string | null;
  family: string;
  asset: string | null;
  exactDate: string | null;
  cutoffStyle: OpinionCryptoCutoffStyle;
  parsed: StructuredProposition;
  evidenceProvenance: VenueAuditEvidenceProvenance;
  reference: string | null;
}

export interface VenueAuditSourceResult {
  available: boolean;
  exactAbsenceAllowed: boolean;
  candidates: readonly VenueAuditSourceCandidate[];
  warnings: readonly string[];
}

const normalizeExactDate = (value: string | null): string | null =>
  value?.toLowerCase().replace(/\s+/g, " ").trim() ?? null;

const decodeJsonString = (value: string): string => {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
};

const toCandidate = (input: {
  venue: "POLYMARKET" | "LIMITLESS";
  venueMarketId: string;
  title: string;
  rules: string | null;
  evidenceProvenance: VenueAuditEvidenceProvenance;
  reference?: string | null;
  boundaryReferenceAt?: Date | null;
}): VenueAuditSourceCandidate => {
  const classified = classifyStructuredOpinionFamily({
    category: "CRYPTO",
    title: input.title,
    rules: input.rules,
    boundaryReferenceAt: input.boundaryReferenceAt ?? null
  });
  return {
    venue: input.venue,
    venueMarketId: input.venueMarketId,
    title: input.title,
    rules: input.rules,
    family: classified.familyBucket,
    asset: classified.subject,
    exactDate: normalizeExactDate(classified.deadlineOrSeason),
    cutoffStyle: inferCryptoCutoffStyle({
      title: input.title,
      exactDate: classified.deadlineOrSeason,
      timeBoundaryPattern: classified.timeBoundaryPattern
    }),
    parsed: classified.parsed,
    evidenceProvenance: input.evidenceProvenance,
    reference: input.reference ?? null
  };
};

export const loadPolymarketVenueAuditUniverse = async (input: {
  client: PredexonHistoricalClient;
  searchTerm?: string;
  pageSize?: number;
  maxPages?: number;
}): Promise<VenueAuditSourceResult> => {
  const searchTerm = input.searchTerm ?? "Bitcoin";
  const pageSize = input.pageSize ?? 100;
  const maxPages = input.maxPages ?? 10;
  const warnings: string[] = [];
  const candidates = new Map<string, VenueAuditSourceCandidate>();

  try {
    for (let page = 0; page < maxPages; page += 1) {
      const rows = await input.client.listMarkets({
        search: searchTerm,
        limit: pageSize,
        offset: page * pageSize
      });
      if (rows.length === 0) {
        break;
      }
      for (const row of rows) {
        const candidate = toPolymarketCandidate(row);
        if (!candidate) {
          continue;
        }
        candidates.set(candidate.venueMarketId, candidate);
      }
      if (rows.length < pageSize) {
        break;
      }
    }

    return {
      available: true,
      exactAbsenceAllowed: true,
      candidates: [...candidates.values()],
      warnings
    };
  } catch (error) {
    warnings.push(`polymarket_live_audit_unavailable:${error instanceof Error ? error.message : String(error)}`);
    return {
      available: false,
      exactAbsenceAllowed: false,
      candidates: [],
      warnings
    };
  }
};

const toPolymarketCandidate = (row: PredexonMarket): VenueAuditSourceCandidate | null => {
  const title = row.title;
  const text = `${title} ${row.event_slug ?? ""}`.toLowerCase();
  if (!/\b(bitcoin|btc)\b/.test(text)) {
    return null;
  }
  return toCandidate({
    venue: "POLYMARKET",
    venueMarketId: row.condition_id,
    title,
    rules: null,
    evidenceProvenance: "api_confirmed",
    reference: row.market_slug ?? row.event_slug ?? row.market_id ?? row.condition_id
  });
};

const LIMITLESS_MARKET_PATTERN =
  /"description":"((?:\\.|[^"\\])*)".*?"title":"((?:\\.|[^"\\])*)".*?"expirationTimestamp":(\d+).*?"slug":"((?:\\.|[^"\\])*)"/gs;

const parseLimitlessSnapshotCandidates = (repoRoot: string): VenueAuditSourceCandidate[] => {
  const repoEntries = readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(".tmp-limitless") && entry.name.endsWith(".html"));
  const candidates = new Map<string, VenueAuditSourceCandidate>();

  for (const entry of repoEntries) {
    const absolutePath = path.resolve(repoRoot, entry.name);
    const html = readFileSync(absolutePath, "utf8");
    for (const match of html.matchAll(LIMITLESS_MARKET_PATTERN)) {
      const description = decodeJsonString(match[1] ?? "");
      const title = decodeJsonString(match[2] ?? "");
      const expirationTimestamp = Number.parseInt(match[3] ?? "", 10);
      const slug = decodeJsonString(match[4] ?? "");
      if (!title || !slug) {
        continue;
      }
      if (!/\b(bitcoin|btc)\b/i.test(`${title} ${description}`)) {
        continue;
      }
      const candidate = toCandidate({
        venue: "LIMITLESS",
        venueMarketId: slug,
        title,
        rules: description,
        evidenceProvenance: "snapshot_supported",
        reference: entry.name,
        boundaryReferenceAt: Number.isFinite(expirationTimestamp) ? new Date(expirationTimestamp) : null
      });
      candidates.set(candidate.venueMarketId, candidate);
    }
  }

  return [...candidates.values()];
};

export const loadLimitlessVenueAuditUniverse = async (input: {
  repoRoot: string;
  client?: LimitlessHistoricalClient | null;
}): Promise<VenueAuditSourceResult> => {
  const warnings: string[] = [];
  const snapshotCandidates = parseLimitlessSnapshotCandidates(input.repoRoot);

  if (!input.client) {
    if (snapshotCandidates.length === 0) {
      warnings.push("limitless_live_api_unavailable_and_no_snapshot_positive_evidence");
    } else {
      warnings.push("limitless_live_api_unavailable_using_snapshot_positive_evidence_only");
    }
    return {
      available: snapshotCandidates.length > 0,
      exactAbsenceAllowed: false,
      candidates: snapshotCandidates,
      warnings
    };
  }

  const enriched = new Map<string, VenueAuditSourceCandidate>();
  for (const candidate of snapshotCandidates) {
    try {
      const detail = await input.client.getMarketDetail(candidate.venueMarketId);
      enriched.set(
        candidate.venueMarketId,
        toCandidate({
          venue: "LIMITLESS",
          venueMarketId: candidate.venueMarketId,
          title: detail.title,
          rules: typeof detail.description === "string" ? detail.description : candidate.rules,
          evidenceProvenance: "api_confirmed",
          reference: candidate.reference,
          boundaryReferenceAt:
            typeof detail.expirationTimestamp === "number"
              ? new Date(detail.expirationTimestamp)
              : candidate.exactDate !== null
                ? new Date(candidate.exactDate)
                : null
        })
      );
    } catch {
      enriched.set(candidate.venueMarketId, candidate);
    }
  }

  if (enriched.size === 0) {
    warnings.push("limitless_live_audit_has_no_positive_candidates");
  }

  return {
    available: enriched.size > 0,
    exactAbsenceAllowed: false,
    candidates: [...enriched.values()],
    warnings
  };
};
