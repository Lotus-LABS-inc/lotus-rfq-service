export const SPORTS_CHAMPIONS_LEAGUE_WINNER_ROLLOUT_STRATEGY_KEY =
  "sports-champions-league-winner-rollout-v1" as const;
export const SPORTS_CHAMPIONS_LEAGUE_WINNER_ROLLOUT_SCOPE_TYPE =
  "SPORTS_CHAMPIONS_LEAGUE_WINNER_LANE" as const;

export const sportsChampionsLeagueWinner20252026AllVenueLaneId =
  "SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT" as const;

export const sportsChampionsLeagueWinner20252026PairLimitlessPolymarketLaneId =
  "SPORTS_CHAMPIONS_LEAGUE_WINNER_2025_2026_PAIR_LIMITLESS_POLYMARKET" as const;

export const sportsChampionsLeagueWinner20252026LaneIds = [
  sportsChampionsLeagueWinner20252026AllVenueLaneId,
  sportsChampionsLeagueWinner20252026PairLimitlessPolymarketLaneId
] as const;

export type SportsChampionsLeagueWinner20252026LaneId =
  typeof sportsChampionsLeagueWinner20252026LaneIds[number];
