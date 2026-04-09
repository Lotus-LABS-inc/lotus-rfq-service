export type SportsTargetedPriorityPocket =
  | "SPORTS|MATCHUP_WINNER|EPL"
  | "SPORTS|MATCHUP_WINNER|LA_LIGA"
  | "ESPORTS|MATCHUP_WINNER|VALORANT"
  | "ESPORTS|MATCHUP_WINNER|LEAGUE_OF_LEGENDS";

export type SportsHeldPocketReference =
  | "ESPORTS|MATCHUP_WINNER|KPL"
  | "ESPORTS|MATCHUP_WINNER|LCK";

export type SportsTargetedCompetitionKey =
  | "premier_league"
  | "la_liga"
  | "valorant_vct"
  | "valorant_masters"
  | "valorant_champions"
  | "lck"
  | "lec"
  | "lcs"
  | "lpl"
  | "lol_worlds"
  | "lol_msi";

export interface SportsTargetedPocketConfig {
  pocket: SportsTargetedPriorityPocket;
  internalCompetitionKeys: readonly SportsTargetedCompetitionKey[];
  reportingBucket: "EPL" | "LA_LIGA" | "VALORANT" | "LEAGUE_OF_LEGENDS";
  competitionScopedInternally: boolean;
  venueAllowlist: readonly ["OPINION", "POLYMARKET", "LIMITLESS", "PREDICT"];
  marketFamilyAllowlist: readonly ["MATCHUP_WINNER"];
}

export interface SportsTargetedIngestionScope {
  generatedAt: string;
  liveWindow: {
    lookbackHours: 6;
    lookaheadHours: 72;
    startsAt: string;
    endsAt: string;
    mode: "LIVE_AND_NEAR_UPCOMING_ONLY";
  };
  activePockets: readonly SportsTargetedPocketConfig[];
  heldPocketReferences: readonly SportsHeldPocketReference[];
  venueAllowlist: readonly ["OPINION", "POLYMARKET", "LIMITLESS", "PREDICT"];
  marketFamilyAllowlist: readonly ["MATCHUP_WINNER"];
}

export const sportsTargetedVenueAllowlist = ["OPINION", "POLYMARKET", "LIMITLESS", "PREDICT"] as const;
export const sportsHeldPocketReferences = [
  "ESPORTS|MATCHUP_WINNER|KPL",
  "ESPORTS|MATCHUP_WINNER|LCK"
] as const satisfies readonly SportsHeldPocketReference[];

export const sportsTargetedPriorityOrder = [
  "SPORTS|MATCHUP_WINNER|EPL",
  "SPORTS|MATCHUP_WINNER|LA_LIGA",
  "ESPORTS|MATCHUP_WINNER|VALORANT",
  "ESPORTS|MATCHUP_WINNER|LEAGUE_OF_LEGENDS"
] as const satisfies readonly SportsTargetedPriorityPocket[];

export const sportsTargetedPocketConfigs: readonly SportsTargetedPocketConfig[] = [
  {
    pocket: "SPORTS|MATCHUP_WINNER|EPL",
    internalCompetitionKeys: ["premier_league"],
    reportingBucket: "EPL",
    competitionScopedInternally: false,
    venueAllowlist: sportsTargetedVenueAllowlist,
    marketFamilyAllowlist: ["MATCHUP_WINNER"]
  },
  {
    pocket: "SPORTS|MATCHUP_WINNER|LA_LIGA",
    internalCompetitionKeys: ["la_liga"],
    reportingBucket: "LA_LIGA",
    competitionScopedInternally: false,
    venueAllowlist: sportsTargetedVenueAllowlist,
    marketFamilyAllowlist: ["MATCHUP_WINNER"]
  },
  {
    pocket: "ESPORTS|MATCHUP_WINNER|VALORANT",
    internalCompetitionKeys: ["valorant_vct", "valorant_masters", "valorant_champions"],
    reportingBucket: "VALORANT",
    competitionScopedInternally: true,
    venueAllowlist: sportsTargetedVenueAllowlist,
    marketFamilyAllowlist: ["MATCHUP_WINNER"]
  },
  {
    pocket: "ESPORTS|MATCHUP_WINNER|LEAGUE_OF_LEGENDS",
    internalCompetitionKeys: ["lck", "lec", "lcs", "lpl", "lol_worlds", "lol_msi"],
    reportingBucket: "LEAGUE_OF_LEGENDS",
    competitionScopedInternally: true,
    venueAllowlist: sportsTargetedVenueAllowlist,
    marketFamilyAllowlist: ["MATCHUP_WINNER"]
  }
] as const;

export const buildSportsTargetedIngestionScope = (now: Date = new Date()): SportsTargetedIngestionScope => {
  const startsAt = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const endsAt = new Date(now.getTime() + 72 * 60 * 60 * 1000);
  return {
    generatedAt: now.toISOString(),
    liveWindow: {
      lookbackHours: 6,
      lookaheadHours: 72,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      mode: "LIVE_AND_NEAR_UPCOMING_ONLY"
    },
    activePockets: sportsTargetedPocketConfigs,
    heldPocketReferences: sportsHeldPocketReferences,
    venueAllowlist: sportsTargetedVenueAllowlist,
    marketFamilyAllowlist: ["MATCHUP_WINNER"]
  };
};

export const mapCompetitionKeyToTargetedPocket = (
  competitionKey: string | null
): SportsTargetedPriorityPocket | null => {
  if (!competitionKey) {
    return null;
  }
  if (competitionKey === "premier_league") {
    return "SPORTS|MATCHUP_WINNER|EPL";
  }
  if (competitionKey === "la_liga") {
    return "SPORTS|MATCHUP_WINNER|LA_LIGA";
  }
  if (competitionKey === "valorant_vct" || competitionKey === "valorant_masters" || competitionKey === "valorant_champions") {
    return "ESPORTS|MATCHUP_WINNER|VALORANT";
  }
  if (competitionKey === "lck" || competitionKey === "lec" || competitionKey === "lcs" || competitionKey === "lpl" || competitionKey === "lol_worlds" || competitionKey === "lol_msi") {
    return "ESPORTS|MATCHUP_WINNER|LEAGUE_OF_LEGENDS";
  }
  return null;
};

export const isHeldPocketReference = (pocket: string): pocket is SportsHeldPocketReference =>
  sportsHeldPocketReferences.includes(pocket as SportsHeldPocketReference);
