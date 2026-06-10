import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import type { PairRouteQualification } from "../qualification/pair-route-qualification.js";

export interface StagingShadowRouteScopeConfig {
  routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION" | "PAIR_PM_PREDICTFUN";
  routeMode: "POLYMARKET_LIMITLESS" | "POLYMARKET_OPINION" | "POLYMARKET_PREDICT_FUN";
  canaryCountableScopeKeys: readonly string[];
  shadowObservableScopeKeys: readonly string[];
  blockedScopes: readonly string[];
  sampleTarget: number;
}

export interface StagingShadowWindowConfig {
  observedAt: string;
  environment: string;
  authoritativePersistenceTarget: "SUPABASE_DB_URL";
  harnessSource: "staging_replay_harness";
  evidenceWindowStart: string;
  evidenceWindowEnd: string;
  routes: readonly StagingShadowRouteScopeConfig[];
}

const markdown = (config: StagingShadowWindowConfig): string => {
  const lines = [
    "# Staging Shadow Window Config",
    "",
    `Observed at: ${config.observedAt}`,
    `Environment: ${config.environment}`,
    `Persistence target: ${config.authoritativePersistenceTarget}`,
    `Harness source: ${config.harnessSource}`,
    `Evidence window: ${config.evidenceWindowStart} -> ${config.evidenceWindowEnd}`,
    ""
  ];
  for (const route of config.routes) {
    lines.push(`## ${route.routeClass}`);
    lines.push(`- Route mode: ${route.routeMode}`);
    lines.push(`- Canary-countable scopes: ${route.canaryCountableScopeKeys.join(", ") || "none"}`);
    lines.push(`- Shadow-observable scopes: ${route.shadowObservableScopeKeys.join(", ") || "none"}`);
    lines.push(`- Blocked scopes: ${route.blockedScopes.join(", ") || "none"}`);
    lines.push(`- Sample target: ${route.sampleTarget}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
};

export const buildStagingShadowWindowConfig = (
  qualifications: readonly PairRouteQualification[],
  now = new Date()
): StagingShadowWindowConfig => ({
  observedAt: now.toISOString(),
  environment: process.env.NODE_ENV ?? "development",
  authoritativePersistenceTarget: "SUPABASE_DB_URL",
  harnessSource: "staging_replay_harness",
  evidenceWindowStart: now.toISOString(),
  evidenceWindowEnd: now.toISOString(),
  routes: qualifications.map((qualification) => ({
    routeClass: qualification.routeClassId,
    routeMode: qualification.definition.routeMode,
    canaryCountableScopeKeys: qualification.safeSubsetMarkets.map(
      (market) => market.canonicalMarketId ?? market.canonicalEventId
    ),
    shadowObservableScopeKeys: qualification.runnableMarkets.map(
      (market) => market.canonicalMarketId ?? market.canonicalEventId
    ),
    blockedScopes: qualification.blockedFamilies,
    sampleTarget: qualification.routeClassId === "PAIR_PM_LIMITLESS" ? 5 : 3
  }))
});

export const writeStagingShadowWindowConfig = (
  repoRoot: string,
  qualifications: readonly PairRouteQualification[],
  now = new Date()
): StagingShadowWindowConfig => {
  const config = buildStagingShadowWindowConfig(qualifications, now);
  mkdirSync(path.resolve(repoRoot, "docs"), { recursive: true });
  writeArtifact(repoRoot, "docs/staging-shadow-window-config.json", config);
  writeMarkdownArtifact(repoRoot, "docs/staging-shadow-window-config.md", markdown(config));
  return config;
};
