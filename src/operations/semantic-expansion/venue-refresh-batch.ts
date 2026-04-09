import { spawnSync } from "node:child_process";

import type { Pool, QueryResultRow } from "pg";

import { ensureDocsDirectory, loadSemanticExpansionInventory, writeArtifact } from "./shared.js";

export interface VenueRefreshCommandResult {
  label: string;
  command: string;
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
  errorMessage: string | null;
}

export interface VenueRefreshBatchSummary {
  observedAt: string;
  commands: readonly VenueRefreshCommandResult[];
  inventorySummary: {
    totalMarkets: number;
    countsByVenueAndCategory: Record<string, number>;
    sampleMarketIds: Record<string, readonly string[]>;
    sourceMetadataVersions: Record<string, readonly string[]>;
  };
}

interface InventoryVersionRow extends QueryResultRow {
  venue: string;
  canonical_category: string | null;
  source_metadata_version: string;
}

const COMMANDS: ReadonlyArray<{ label: string; script: string; args?: readonly string[] }> = [
  { label: "predexon-live-mappings", script: "sync:predexon:live-mappings" },
  { label: "wire-predexon-live-ids", script: "wire:predexon:live-ids" },
  { label: "limitless-targeted-seeds", script: "sync:limitless:targeted-seeds" },
  { label: "predexon-mapped-historical", script: "ingest:predexon:mapped", args: ["--venue=ALL", "--mode=incremental"] },
  { label: "opinion-curated-historical", script: "sync:predexon:opinion-curation", args: ["--artifact=all"] },
  { label: "opinion-current-state", script: "sync:opinion:current-state", args: ["--maxPages=50", "--maxPerCategory=20", "--includeClosed=true"] },
  { label: "opinion-seed-acquisition", script: "acquire:opinion:seed-candidates" },
  { label: "predict-current-state", script: "sync:predict:current-state", args: ["--environment=mainnet"] },
  { label: "predict-focused-evidence", script: "batch:predict:focused-evidence" }
];

const tail = (value: string): string =>
  value.trim().split(/\r?\n/).slice(-20).join("\n");

const runCommand = (
  repoRoot: string,
  command: { label: string; script: string; args?: readonly string[] }
): VenueRefreshCommandResult => {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const fullArgs = ["run", command.script, ...(command.args?.length ? ["--", ...command.args] : [])];
  const result = spawnSync(npmCommand, fullArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
    stdio: "pipe",
    shell: process.platform === "win32"
  });

  return {
    label: command.label,
    command: `${npmCommand} ${fullArgs.join(" ")}`,
    exitCode: result.status ?? 1,
    stdoutTail: tail(result.stdout ?? ""),
    stderrTail: tail(result.stderr ?? ""),
    errorMessage: result.error?.message ?? null
  };
};

const loadSourceMetadataVersions = async (pool: Pool): Promise<Record<string, readonly string[]>> => {
  const result = await pool.query<InventoryVersionRow>(
    `SELECT venue, canonical_category, source_metadata_version
       FROM venue_market_profiles
      WHERE venue IN ('POLYMARKET', 'LIMITLESS', 'OPINION', 'PREDICT')
      ORDER BY venue, canonical_category, source_metadata_version`
  );

  const versions: Record<string, string[]> = {};
  for (const row of result.rows) {
    const key = `${row.venue}:${row.canonical_category ?? "OTHER"}`;
    versions[key] = versions[key] ?? [];
    if (!versions[key]!.includes(row.source_metadata_version)) {
      versions[key]!.push(row.source_metadata_version);
    }
  }

  return Object.fromEntries(
    Object.entries(versions).map(([key, value]) => [key, value.sort((left, right) => left.localeCompare(right))])
  );
};

export const runVenueRefreshBatch = async (input: {
  repoRoot: string;
  pool: Pool;
}): Promise<VenueRefreshBatchSummary> => {
  const commandResults = COMMANDS.map((command) => runCommand(input.repoRoot, command));
  ensureDocsDirectory(input.repoRoot);

  const inventory = await loadSemanticExpansionInventory(input.pool);
  const countsByVenueAndCategory: Record<string, number> = {};
  const sampleMarketIds: Record<string, string[]> = {};

  for (const row of inventory) {
    const key = `${row.venue}:${row.semanticCategory}`;
    countsByVenueAndCategory[key] = (countsByVenueAndCategory[key] ?? 0) + 1;
    sampleMarketIds[key] = sampleMarketIds[key] ?? [];
    if (sampleMarketIds[key]!.length < 5) {
      sampleMarketIds[key]!.push(row.venueMarketId);
    }
  }

  const summary: VenueRefreshBatchSummary = {
    observedAt: new Date().toISOString(),
    commands: commandResults,
    inventorySummary: {
      totalMarkets: inventory.length,
      countsByVenueAndCategory,
      sampleMarketIds,
      sourceMetadataVersions: await loadSourceMetadataVersions(input.pool)
    }
  };

  writeArtifact(input.repoRoot, "docs/venue-refresh-summary.json", summary);
  return summary;
};
