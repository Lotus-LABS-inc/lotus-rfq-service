export const POLITICS_PARTY_CONTROL_ROLLOUT_STRATEGY_KEY = "politics-party-control-rollout-v1" as const;
export const POLITICS_PARTY_CONTROL_ROLLOUT_SCOPE_TYPE = "POLITICS_PARTY_CONTROL_LANE" as const;

export const partyControlBalanceOfPower2026TriLaneId =
  "POLITICS_PARTY_CONTROL_BALANCE_OF_POWER_2026_TRI_OPINION_POLYMARKET_PREDICT" as const;

export const partyControlBalanceOfPower2026PairFallbackLaneId =
  "POLITICS_PARTY_CONTROL_BALANCE_OF_POWER_2026_PAIR_POLYMARKET_PREDICT" as const;

export const politicsPartyControlLaneIds = [
  partyControlBalanceOfPower2026TriLaneId,
  partyControlBalanceOfPower2026PairFallbackLaneId
] as const;
export type PoliticsPartyControlLaneId = typeof politicsPartyControlLaneIds[number];
