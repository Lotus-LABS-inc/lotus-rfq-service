import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { isFundingVenueReadinessSupported } from "../../src/core/funding/venue-readiness.js";
import type { FundingVenue } from "../../src/core/funding/types.js";

type RouteGateStatus = "PASSED" | "FAILED";

interface RehearsalArtifact {
  generatedAt?: string;
  status?: string;
  persistedReadinessRows?: number;
  adminReadinessVisible?: boolean;
  executionPreflight?: { ok?: boolean };
  sandboxLane?: { laneId?: string; venuePath?: string[] };
  routeLegs?: Array<{
    targetVenue?: string | null;
    routeLegStatus?: string | null;
    destinationStatus?: string | null;
    venueCreditStatus?: string | null;
  }>;
  venueEvidence?: Array<{ targetVenue?: string; readyToTrade?: boolean }>;
  safety?: {
    defaultFundingPreflightEnforcementEnabled?: boolean;
    scriptScopedFundingPreflightEnforcementOnly?: boolean;
    liveLifiExecutionEnabled?: boolean;
    backendBroadcastedTransaction?: boolean;
    liveVenueSubmissionEnabled?: boolean;
  };
  redactionVerified?: boolean;
}

interface VenueSummaryRow {
  venue?: string;
  status?: string;
  artifactPath?: string | null;
  generatedAt?: string | null;
  ageHours?: number | null;
  blockers?: string[];
}

interface VenueGateSummary {
  generatedAt?: string;
  status?: string;
  rows?: VenueSummaryRow[];
  safety?: {
    liveLifiExecutionEnabled?: boolean;
    fundingPreflightEnforcementChanged?: boolean;
    backendBroadcastedTransaction?: boolean;
    liveVenueSubmissionEnabled?: boolean;
  };
}

interface RouteReadinessReport {
  generatedAt: string;
  status: RouteGateStatus;
  routeOrLaneId: string;
  requiredVenues: FundingVenue[];
  maxAgeHours: number;
  allVenueGateSummaryPath: string;
  routeRehearsalArtifactPath: string | null;
  blockers: string[];
  allVenueGate: {
    status: string | null;
    generatedAt: string | null;
    fresh: boolean;
    requiredVenueRows: VenueSummaryRow[];
  };
  routeRehearsal: {
    status: string | null;
    generatedAt: string | null;
    fresh: boolean;
    executionPreflightOk: boolean;
    persistedReadinessRows: number;
    adminReadinessVisible: boolean;
    redactionVerified: boolean;
    safetyOk: boolean;
  };
  safety: {
    readOnlyValidator: true;
    liveLifiExecutionEnabled: false;
    fundingPreflightEnforcementChanged: false;
    backendBroadcastedTransaction: false;
    liveVenueSubmissionEnabled: false;
  };
}

const supportedVenues = ["POLYMARKET", "LIMITLESS", "OPINION", "MYRIAD", "PREDICT_FUN"] as const;
const routeOrLaneId = process.argv[2];
if (!routeOrLaneId) {
  throw new Error("Usage: npm run funding:route-enforcement-ready -- <ROUTE_OR_LANE_ID>");
}

const artifactDir = join(process.cwd(), "artifacts", "funding");
const maxAgeHours = Number.parseInt(process.env.FUNDING_ROUTE_ENFORCEMENT_MAX_AGE_HOURS ?? "24", 10);
const allVenueGateSummaryPath = process.env.FUNDING_VENUE_GATE_SUMMARY_ARTIFACT_PATH ??
  join(artifactDir, "all-venue-readiness-gate-summary.json");
const routeArtifactOverride = process.env.FUNDING_ROUTE_REHEARSAL_ARTIFACT_PATH;
const outputSlug = routeOrLaneId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const outputJsonPath = join(artifactDir, `route-enforcement-readiness-${outputSlug}.json`);
const outputMarkdownPath = join(artifactDir, `route-enforcement-readiness-${outputSlug}.md`);
const blockers: string[] = [];

const readJson = async <T>(path: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
};

const ageHours = (generatedAt: string | null | undefined): number | null => {
  if (!generatedAt) {
    return null;
  }
  const generatedAtMs = Date.parse(generatedAt);
  if (!Number.isFinite(generatedAtMs)) {
    return null;
  }
  return Math.max(0, Date.now() - generatedAtMs) / 3_600_000;
};

const isFresh = (generatedAt: string | null | undefined): boolean => {
  const resolvedAgeHours = ageHours(generatedAt);
  return resolvedAgeHours !== null && resolvedAgeHours <= Math.max(maxAgeHours, 1);
};

const normalizeVenueList = (rawVenues: readonly string[]): FundingVenue[] => {
  const normalized = [...new Set(rawVenues.map((venue) => venue.trim().toUpperCase()).filter(Boolean))];
  const invalid = normalized.filter((venue) => !isFundingVenueReadinessSupported(venue));
  if (invalid.length > 0) {
    blockers.push(`Unsupported funding venue(s): ${invalid.join(", ")}.`);
  }
  return normalized.filter((venue): venue is FundingVenue => isFundingVenueReadinessSupported(venue));
};

const inferVenues = (): FundingVenue[] => {
  const explicit = process.env.FUNDING_ROUTE_REQUIRED_VENUES;
  if (explicit) {
    return normalizeVenueList(explicit.split(","));
  }

  const normalizedRoute = routeOrLaneId.toUpperCase().replaceAll("-", "_");
  if (normalizedRoute.includes("PREDICT") && !normalizedRoute.includes("PREDICT_FUN") && !normalizedRoute.includes("PREDICTFUN")) {
    blockers.push("Route mentions PREDICT but not PREDICT_FUN. Set FUNDING_ROUTE_REQUIRED_VENUES explicitly to avoid confusing Predict.fun with other Predict venues.");
  }

  const venues = supportedVenues.filter((venue) => {
    if (venue === "PREDICT_FUN") {
      return normalizedRoute.includes("PREDICT_FUN") || normalizedRoute.includes("PREDICTFUN");
    }
    return normalizedRoute.includes(venue);
  });

  if (venues.length === 0) {
    blockers.push("Could not infer required venues from route/lane id. Set FUNDING_ROUTE_REQUIRED_VENUES=POLYMARKET,LIMITLESS,...");
  }
  return venues;
};

const sameVenueSet = (actual: readonly string[] | undefined, expected: readonly FundingVenue[]): boolean => {
  const actualSorted = [...(actual ?? [])].sort();
  const expectedSorted = [...expected].sort();
  return JSON.stringify(actualSorted) === JSON.stringify(expectedSorted);
};

const routeArtifactPathFor = (requiredVenues: readonly FundingVenue[]): string | null => {
  if (routeArtifactOverride) {
    return routeArtifactOverride;
  }
  const genericRoutePath = join(
    artifactDir,
    `route-${routeOrLaneId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-funding-readiness-sandbox-preflight.json`
  );
  if (requiredVenues.length === 1) {
    return join(artifactDir, `${requiredVenues[0].toLowerCase().replaceAll("_", "-")}-funding-readiness-sandbox-preflight.json`);
  }
  if (sameVenueSet(requiredVenues, ["LIMITLESS", "POLYMARKET"])) {
    return join(artifactDir, "pair-funding-readiness-sandbox-preflight.json");
  }
  return genericRoutePath;
};

const validateSummary = (summary: VenueGateSummary | null, requiredVenues: readonly FundingVenue[]): VenueSummaryRow[] => {
  if (!summary) {
    blockers.push(`All-venue gate summary is missing or unreadable at ${allVenueGateSummaryPath}. Run npm run funding:venue-gate-summary first.`);
    return [];
  }
  if (summary.status !== "PASSED") {
    blockers.push(`All-venue gate summary status is ${summary.status ?? "missing"}, expected PASSED.`);
  }
  if (!isFresh(summary.generatedAt)) {
    blockers.push("All-venue gate summary is missing, invalid, or stale.");
  }
  if (summary.safety?.liveLifiExecutionEnabled !== false ||
    summary.safety?.fundingPreflightEnforcementChanged !== false ||
    summary.safety?.backendBroadcastedTransaction !== false ||
    summary.safety?.liveVenueSubmissionEnabled !== false) {
    blockers.push("All-venue gate summary safety flags are not acceptable.");
  }

  const rows = requiredVenues.map((venue) => summary.rows?.find((row) => row.venue === venue) ?? { venue, status: "MISSING" });
  for (const row of rows) {
    if (row.status !== "PASSED") {
      blockers.push(`${row.venue ?? "unknown"} venue gate status is ${row.status ?? "missing"}, expected PASSED.`);
    }
    if (!isFresh(row.generatedAt)) {
      blockers.push(`${row.venue ?? "unknown"} venue gate artifact is missing, invalid, or stale.`);
    }
    if (row.blockers && row.blockers.length > 0) {
      blockers.push(`${row.venue ?? "unknown"} venue gate has blockers: ${row.blockers.join("; ")}`);
    }
  }
  return rows;
};

const validateRouteArtifact = (artifact: RehearsalArtifact | null, requiredVenues: readonly FundingVenue[]): void => {
  if (!artifact) {
    blockers.push("Route rehearsal artifact is missing or unreadable.");
    return;
  }
  if (artifact.status !== "COMPLETED") {
    blockers.push(`Route rehearsal status is ${artifact.status ?? "missing"}, expected COMPLETED.`);
  }
  if (artifact.sandboxLane?.laneId !== routeOrLaneId) {
    blockers.push(`Route rehearsal laneId is ${artifact.sandboxLane?.laneId ?? "missing"}, expected ${routeOrLaneId}.`);
  }
  if (!sameVenueSet(artifact.sandboxLane?.venuePath, requiredVenues)) {
    blockers.push(`Route rehearsal venuePath must match required venues ${requiredVenues.join(",")}.`);
  }
  if (!isFresh(artifact.generatedAt)) {
    blockers.push("Route rehearsal artifact is missing, invalid, or stale.");
  }
  if (artifact.executionPreflight?.ok !== true) {
    blockers.push("Route rehearsal executionPreflight.ok must be true.");
  }
  if ((artifact.persistedReadinessRows ?? 0) < requiredVenues.length) {
    blockers.push(`Route rehearsal persistedReadinessRows must be at least ${requiredVenues.length}.`);
  }
  if (artifact.adminReadinessVisible !== true) {
    blockers.push("Route rehearsal adminReadinessVisible must be true.");
  }
  if (artifact.redactionVerified !== true) {
    blockers.push("Route rehearsal redactionVerified must be true.");
  }
  if (artifact.safety?.defaultFundingPreflightEnforcementEnabled !== false ||
    artifact.safety?.scriptScopedFundingPreflightEnforcementOnly !== true ||
    artifact.safety?.liveLifiExecutionEnabled !== false ||
    artifact.safety?.backendBroadcastedTransaction !== false ||
    artifact.safety?.liveVenueSubmissionEnabled !== false) {
    blockers.push("Route rehearsal safety flags are not acceptable.");
  }

  for (const venue of requiredVenues) {
    const leg = artifact.routeLegs?.find((row) => row.targetVenue === venue);
    if (!leg) {
      blockers.push(`Route rehearsal missing route leg for ${venue}.`);
      continue;
    }
    if (leg.routeLegStatus !== "LEG_READY_TO_TRADE" || leg.destinationStatus !== "CONFIRMED" || leg.venueCreditStatus !== "CONFIRMED") {
      blockers.push(`${venue} route leg is not fully READY_TO_TRADE/CONFIRMED in route rehearsal.`);
    }
    const evidenceReady = artifact.venueEvidence?.some((row) => row.targetVenue === venue && row.readyToTrade === true) === true;
    if (!evidenceReady) {
      blockers.push(`${venue} venue evidence is not READY_TO_TRADE in route rehearsal.`);
    }
  }
};

const renderMarkdown = (report: RouteReadinessReport): string => [
  "# Funding Route Enforcement Readiness",
  "",
  `Generated: ${report.generatedAt}`,
  `Status: ${report.status}`,
  `Route/Lane: ${report.routeOrLaneId}`,
  `Required venues: ${report.requiredVenues.join(", ")}`,
  `Max age hours: ${report.maxAgeHours}`,
  "",
  "## Gate Inputs",
  "",
  `- All-venue gate summary: ${report.allVenueGateSummaryPath}`,
  `- Route rehearsal artifact: ${report.routeRehearsalArtifactPath ?? "missing"}`,
  "",
  "## Safety",
  "",
  `- Read-only validator: ${report.safety.readOnlyValidator}`,
  `- Live LI.FI execution enabled: ${report.safety.liveLifiExecutionEnabled}`,
  `- Funding preflight enforcement changed: ${report.safety.fundingPreflightEnforcementChanged}`,
  `- Backend broadcasted transaction: ${report.safety.backendBroadcastedTransaction}`,
  `- Live venue submission enabled: ${report.safety.liveVenueSubmissionEnabled}`,
  "",
  "## Blockers",
  "",
  ...(report.blockers.length > 0 ? report.blockers.map((blocker) => `- ${blocker}`) : ["- none"]),
  ""
].join("\n");

const requiredVenues = inferVenues();
const routeArtifactPath = requiredVenues.length > 0 ? routeArtifactPathFor(requiredVenues) : null;
if (!routeArtifactPath) {
  blockers.push("No route-specific rehearsal artifact convention exists for this venue set. Set FUNDING_ROUTE_REHEARSAL_ARTIFACT_PATH to the approved route rehearsal artifact.");
}

const [summary, routeArtifact] = await Promise.all([
  readJson<VenueGateSummary>(allVenueGateSummaryPath),
  routeArtifactPath ? readJson<RehearsalArtifact>(routeArtifactPath) : Promise.resolve(null)
]);
const summaryRows = validateSummary(summary, requiredVenues);
validateRouteArtifact(routeArtifact, requiredVenues);

const report: RouteReadinessReport = {
  generatedAt: new Date().toISOString(),
  status: blockers.length === 0 ? "PASSED" : "FAILED",
  routeOrLaneId,
  requiredVenues,
  maxAgeHours,
  allVenueGateSummaryPath,
  routeRehearsalArtifactPath: routeArtifactPath,
  blockers,
  allVenueGate: {
    status: summary?.status ?? null,
    generatedAt: summary?.generatedAt ?? null,
    fresh: isFresh(summary?.generatedAt),
    requiredVenueRows: summaryRows
  },
  routeRehearsal: {
    status: routeArtifact?.status ?? null,
    generatedAt: routeArtifact?.generatedAt ?? null,
    fresh: isFresh(routeArtifact?.generatedAt),
    executionPreflightOk: routeArtifact?.executionPreflight?.ok === true,
    persistedReadinessRows: routeArtifact?.persistedReadinessRows ?? 0,
    adminReadinessVisible: routeArtifact?.adminReadinessVisible === true,
    redactionVerified: routeArtifact?.redactionVerified === true,
    safetyOk: routeArtifact?.safety?.defaultFundingPreflightEnforcementEnabled === false &&
      routeArtifact.safety.scriptScopedFundingPreflightEnforcementOnly === true &&
      routeArtifact.safety.liveLifiExecutionEnabled === false &&
      routeArtifact.safety.backendBroadcastedTransaction === false &&
      routeArtifact.safety.liveVenueSubmissionEnabled === false
  },
  safety: {
    readOnlyValidator: true,
    liveLifiExecutionEnabled: false,
    fundingPreflightEnforcementChanged: false,
    backendBroadcastedTransaction: false,
    liveVenueSubmissionEnabled: false
  }
};

await mkdir(artifactDir, { recursive: true });
await writeFile(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(outputMarkdownPath, renderMarkdown(report), "utf8");

console.log(`Funding route enforcement readiness: ${report.status}`);
console.log(`routeOrLaneId=${routeOrLaneId}`);
console.log(`requiredVenues=${requiredVenues.join(",")}`);
console.log(`artifact=${outputJsonPath}`);
if (report.status !== "PASSED") {
  for (const blocker of blockers) {
    console.error(`- ${blocker}`);
  }
  process.exitCode = 1;
}
