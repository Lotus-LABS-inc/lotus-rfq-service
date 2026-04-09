export const sportsPocketValues = [
  "SPORTS|MATCHUP_WINNER|NBA",
  "SPORTS|MATCHUP_WINNER|EPL",
  "SPORTS|MATCHUP_WINNER|LA_LIGA",
  "ESPORTS|MATCHUP_WINNER|DOTA2_ESL",
  "ESPORTS|MATCHUP_WINNER|VALORANT",
  "ESPORTS|MATCHUP_WINNER|LEAGUE_OF_LEGENDS",
  "ESPORTS|MATCHUP_WINNER|LCK",
  "ESPORTS|MATCHUP_WINNER|KPL"
] as const;
export type SportsPocket = typeof sportsPocketValues[number];

export const sportsPocketAdmissionRejectionValues = [
  "POCKET_OUT_OF_SCOPE",
  "AMBIGUOUS_POCKET",
  "NON_MATCHUP_ROW",
  "NON_BINARY_ROW",
  "MISSING_OPPONENT",
  "MISSING_POCKET_CONTEXT"
] as const;
export type SportsPocketAdmissionRejection = typeof sportsPocketAdmissionRejectionValues[number];

export const sportsPocketEntityBlockerValues = [
  "SUBJECT_ENTITY_MISMATCH",
  "OPPONENT_MISMATCH",
  "UNRESOLVED_ALIAS",
  "SIDE_ASSIGNMENT_MISMATCH",
  "NON_TEAM_SUBJECT",
  "SINGLE_SIDE_ROW"
] as const;
export type SportsPocketEntityBlocker = typeof sportsPocketEntityBlockerValues[number];

export const sportsPocketDateBlockerValues = [
  "DATE_WINDOW_MISMATCH",
  "MISSING_EVENT_DATE",
  "MISSING_CUTOFF",
  "TIMEZONE_UNCERTAIN",
  "DATE_BUCKET_AMBIGUOUS"
] as const;
export type SportsPocketDateBlocker = typeof sportsPocketDateBlockerValues[number];

export const sportsPocketOutcomeBlockerValues = [
  "OUTCOME_STRUCTURE_MISMATCH",
  "SIDE_MAPPING_MISMATCH",
  "NON_COMPARABLE_BINARY_SHAPE"
] as const;
export type SportsPocketOutcomeBlocker = typeof sportsPocketOutcomeBlockerValues[number];

export const sportsPocketPrefilterBlockerValues = [
  "POCKET_MISMATCH",
  "DATE_WINDOW_MISMATCH",
  "SUBJECT_ENTITY_MISMATCH",
  "OPPONENT_MISMATCH",
  "OUTCOME_STRUCTURE_MISMATCH",
  "SIDE_ASSIGNMENT_MISMATCH",
  "NON_COMPARABLE_MATCH_SCOPE"
] as const;
export type SportsPocketPrefilterBlocker = typeof sportsPocketPrefilterBlockerValues[number];
