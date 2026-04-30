import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";

loadDotenv();

const databaseUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("SUPABASE_DB_URL, DATABASE_URL, or TEST_DATABASE_URL is required to generate the monetization shadow report.");
}

interface LedgerRow {
  fee_policy_version: string;
  status: string;
  amount: string;
  currency: string;
  capture_mode: string | null;
  revenue_source: string | null;
  actual_builder_fee_collected: string;
  shadow_improvement_fee: string;
  uncollected_improvement_opportunity: string;
  venue: string | null;
  lane_id: string | null;
  metadata: Record<string, unknown> | null;
}

const artifactDir = join(process.cwd(), "artifacts", "monetization");
const pool = new Pool({ connectionString: databaseUrl });

const numberFromMetadata = (metadata: Record<string, unknown> | null, key: string): number | null => {
  const summary = metadata?.feeSummary;
  if (typeof summary !== "object" || summary === null) {
    return null;
  }
  const value = (summary as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const booleanFromMetadata = (metadata: Record<string, unknown> | null, key: string): boolean =>
  metadata?.[key] === true || (
    typeof metadata?.feeSummary === "object" &&
    metadata.feeSummary !== null &&
    (metadata.feeSummary as Record<string, unknown>)[key] === true
  );

const add = (record: Record<string, number>, key: string, value: number): void => {
  record[key] = (record[key] ?? 0) + value;
};

const renderRecord = (record: Record<string, number>, formatter: (value: number) => string = String): string[] => {
  const entries = Object.entries(record).sort(([left], [right]) => left.localeCompare(right));
  return entries.length > 0 ? entries.map(([key, value]) => `- ${key}: ${formatter(value)}`) : ["- none: 0"];
};

const csvCell = (value: unknown): string => {
  const raw = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, "\"\"")}"` : raw;
};

try {
  const result = await pool.query<LedgerRow>(
    `SELECT
        fee_policy_version,
        status,
        amount::text,
        currency,
        capture_mode,
        revenue_source,
        actual_builder_fee_collected::text,
        shadow_improvement_fee::text,
        uncollected_improvement_opportunity::text,
        venue,
        lane_id,
        metadata
       FROM execution_fee_ledger
      ORDER BY created_at ASC`
  );
  const rows = result.rows;
  const shadowRows = rows.filter((row) => row.status === "SHADOW_ONLY" || row.status === "REALIZED_SHADOW");
  const builderFeeRows = rows.filter((row) => row.status === "COLLECTED_BUILDER_FEE");
  const authorized = rows.filter((row) => row.status === "AUTHORIZED");
  const actualBuilderFeesCollected = builderFeeRows.reduce((sum, row) => sum + Number(row.actual_builder_fee_collected || row.amount), 0);
  const shadowImprovementFees = shadowRows.reduce((sum, row) => sum + Number(row.shadow_improvement_fee || row.amount), 0);
  const uncollectedImprovementOpportunity = shadowRows.reduce((sum, row) => sum + Number(row.uncollected_improvement_opportunity || row.amount), 0);
  const capAppliedCount = shadowRows.filter((row) => booleanFromMetadata(row.metadata, "capApplied")).length;
  const notionalSum = shadowRows.reduce((sum, row) => sum + (numberFromMetadata(row.metadata, "notionalCap") ?? 0), 0);
  const maxFeeBps = shadowRows
    .map((row) => numberFromMetadata(row.metadata, "notionalCap"))
    .filter((value): value is number => typeof value === "number" && value > 0);
  const averageFeeBps = notionalSum > 0 && maxFeeBps.length > 0
    ? (shadowImprovementFees / (notionalSum / 0.0075)) * 10_000
    : 0;
  const actualBuilderFeesByVenue: Record<string, number> = {};
  const shadowOpportunityByVenue: Record<string, number> = {};
  const shadowOpportunityByLane: Record<string, number> = {};
  for (const row of builderFeeRows) {
    add(actualBuilderFeesByVenue, row.venue ?? "UNKNOWN", Number(row.actual_builder_fee_collected || row.amount));
  }
  for (const row of shadowRows) {
    const amount = Number(row.uncollected_improvement_opportunity || row.amount);
    add(shadowOpportunityByVenue, row.venue ?? "UNKNOWN", amount);
    add(shadowOpportunityByLane, row.lane_id ?? "UNKNOWN", amount);
  }
  const policyVersions = [...new Set(rows.map((row) => row.fee_policy_version))].sort();
  const currencies = [...new Set(rows.map((row) => row.currency))].sort();
  const captureModes = [...new Set(rows.map((row) => row.capture_mode).filter((value): value is string => Boolean(value)))].sort();
  const revenueSources = [...new Set(rows.map((row) => row.revenue_source).filter((value): value is string => Boolean(value)))].sort();
  const summary = {
    generatedAt: new Date().toISOString(),
    mode: "PRIVATE_BETA_MONETIZATION",
    policyVersions,
    currencies,
    captureModes,
    revenueSources,
    ledgerRows: rows.length,
    previewedRows: rows.filter((row) => row.status === "PREVIEWED").length,
    authorizedRows: authorized.length,
    shadowOnlyRows: shadowRows.length,
    collectedBuilderFeeRows: builderFeeRows.length,
    failedOrNoChargeExecutions: Math.max(0, authorized.length - shadowRows.length - builderFeeRows.length),
    actualBuilderFeesCollected,
    shadowImprovementFees,
    uncollectedImprovementOpportunity,
    capAppliedCount,
    averageFeeBps,
    actualBuilderFeesByVenue,
    shadowOpportunityByVenue,
    shadowOpportunityByLane,
    safety: {
      shadowIsNotCollectedRevenue: true,
      smartFeeRouterLive: false,
      noSecretsIncluded: true,
      noSettlementDeduction: true,
      noWalletMovement: true
    }
  };

  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    join(artifactDir, "monetization-shadow-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    join(artifactDir, "monetization-shadow-summary.md"),
    [
      "# Monetization Shadow Summary",
      "",
      `Generated: ${summary.generatedAt}`,
      "",
      "## Totals",
      "",
      `- Policy versions: ${policyVersions.join(", ") || "none"}`,
      `- Currencies: ${currencies.join(", ") || "none"}`,
      `- Capture modes: ${captureModes.join(", ") || "none"}`,
      `- Revenue sources: ${revenueSources.join(", ") || "none"}`,
      `- Ledger rows: ${summary.ledgerRows}`,
      `- Previewed rows: ${summary.previewedRows}`,
      `- Authorized rows: ${summary.authorizedRows}`,
      `- Shadow-only rows: ${summary.shadowOnlyRows}`,
      `- Collected builder-fee rows: ${summary.collectedBuilderFeeRows}`,
      `- Failed/no-charge executions: ${summary.failedOrNoChargeExecutions}`,
      `- Actual builder fees collected: ${summary.actualBuilderFeesCollected.toFixed(8)}`,
      `- Shadow improvement fees: ${summary.shadowImprovementFees.toFixed(8)}`,
      `- Uncollected improvement opportunity: ${summary.uncollectedImprovementOpportunity.toFixed(8)}`,
      `- Cap-applied count: ${summary.capAppliedCount}`,
      `- Average fee bps: ${summary.averageFeeBps.toFixed(4)}`,
      "",
      "## Actual Builder Fees By Venue",
      "",
      ...renderRecord(actualBuilderFeesByVenue, (value) => value.toFixed(8)),
      "",
      "## Shadow Opportunity By Venue",
      "",
      ...renderRecord(shadowOpportunityByVenue, (value) => value.toFixed(8)),
      "",
      "## Shadow Opportunity By Lane",
      "",
      ...renderRecord(shadowOpportunityByLane, (value) => value.toFixed(8)),
      "",
      "## Safety",
      "",
      "- Polymarket builder fees are counted only when venue settlement evidence confirms the amount or rate.",
      "- Shadow improvement fees are uncollected opportunity, not actual revenue.",
      "- Report is read-only.",
      "- No API keys, private keys, auth headers, wallet secrets, settlement internals, or user credentials are included.",
      "- No smart fee router, invoice capture, settlement deduction, or wallet movement is performed.",
      ""
    ].join("\n"),
    "utf8"
  );
  const csvRows = [
    [
      "actualBuilderFeesCollected",
      "shadowImprovementFees",
      "uncollectedImprovementOpportunity",
      "captureMode",
      "revenueSource",
      "venue",
      "lane",
      "policyVersion",
      "status",
      "currency"
    ],
    ...rows.map((row) => [
      row.actual_builder_fee_collected,
      row.shadow_improvement_fee,
      row.uncollected_improvement_opportunity,
      row.capture_mode ?? "",
      row.revenue_source ?? "",
      row.venue ?? "",
      row.lane_id ?? "",
      row.fee_policy_version,
      row.status,
      row.currency
    ])
  ];
  await writeFile(
    join(artifactDir, "monetization-private-beta-ledger.csv"),
    `${csvRows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`,
    "utf8"
  );
  console.log(`Monetization shadow report written to ${artifactDir}`);
} finally {
  await pool.end();
}
