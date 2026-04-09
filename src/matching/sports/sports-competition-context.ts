import type { MatchingMarketRecord } from "../matching-types.js";
import type { SportsScopedDomain, SportsScopedFamily } from "./sports-match-labels.js";
import { detectCompetitionKey } from "./sports-normalization.js";

export interface SportsCompetitionContext {
  domain: SportsScopedDomain;
  family: SportsScopedFamily;
  sportOrEsport: string | null;
  competitionKey: string | null;
  competitionLabel: string | null;
  competitionScope: "MATCH" | "OUTRIGHT";
  stageOrRound: string | null;
  confidence: string;
  blockers: readonly string[];
}

export const normalizeSportsCompetitionContext = (input: {
  market: MatchingMarketRecord;
  domain: SportsScopedDomain;
  family: SportsScopedFamily;
}): SportsCompetitionContext => {
  const detected = detectCompetitionKey(input.market, input.domain);
  const competitionScope = input.family === "MATCHUP_WINNER" ? "MATCH" : "OUTRIGHT";
  const blockers: string[] = [];

  if (!detected.competitionKey) {
    blockers.push("COMPETITION_SCOPE_MISSING");
  }
  if (competitionScope === "MATCH" && input.family !== "MATCHUP_WINNER") {
    blockers.push("MATCH_VS_OUTRIGHT_MISMATCH");
  }
  if (input.family === "SPLIT_WINNER" && competitionScope !== "OUTRIGHT") {
    blockers.push("SPLIT_VS_MATCH_MISMATCH");
  }
  if ((input.family === "LEAGUE_WINNER" || input.family === "TOURNAMENT_WINNER") && detected.competitionKey === null) {
    blockers.push("LEAGUE_VS_TOURNAMENT_MISMATCH");
  }

  return {
    domain: input.domain,
    family: input.family,
    sportOrEsport: detected.sportOrEsport,
    competitionKey: detected.competitionKey,
    competitionLabel: detected.competitionLabel,
    competitionScope,
    stageOrRound: detected.stageOrRound,
    confidence: blockers.length === 0 ? "1" : detected.competitionKey ? "0.7" : "0.35",
    blockers
  };
};
