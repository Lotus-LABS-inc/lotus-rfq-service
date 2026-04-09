import type { MatchingMarketRecord } from "../matching-types.js";
import type { SportsScopedFamily } from "./sports-match-labels.js";
import {
  buildSortedMatchupKey,
  extractMatchParticipantsFromTitleDetailed,
  extractMatchParticipantsFromTitle,
  extractOutcomeLabels,
  extractSubjectFromOutrightText,
  isYesNoLabel,
  normalizeSportsEntity
} from "./sports-normalization.js";

export interface SportsSubjectNormalization {
  family: SportsScopedFamily;
  subjectEntityRaw: string | null;
  opponentEntityRaw: string | null;
  normalizedSubjectEntity: string | null;
  normalizedOpponentEntity: string | null;
  matchupKey: string | null;
  canonicalSortedTeams: readonly string[];
  aliasSet: readonly string[];
  entityType: "TEAM_OR_ORG" | "DRAW_COMPONENT" | "OTHER";
  sideAssignment: "LEFT" | "RIGHT" | "UNKNOWN" | null;
  sideAssignmentSource: "TITLE" | "OUTCOMES" | "UNKNOWN" | null;
  outcomeMappingBasis: "DIRECT_MATCH_WINNER" | "YES_NO_SINGLE_SIDE" | "ENTITY_OUTRIGHT_YES_NO" | "UNKNOWN";
  confidence: string;
  titleNoiseStripped: boolean;
  blockers: readonly string[];
}

const extractSubjectFromRules = (market: MatchingMarketRecord): string | null => {
  const match = `${market.title} ${market.rulesText ?? ""}`.match(/if\s+(.+?)\s+wins?\b/i);
  return match?.[1] ? match[1] : null;
};

export const normalizeSportsSubjectEntities = (input: {
  market: MatchingMarketRecord;
  family: SportsScopedFamily;
}): SportsSubjectNormalization => {
  const blockers: string[] = [];
  const aliasSet: string[] = [];
  const titleParticipantsDetailed = extractMatchParticipantsFromTitleDetailed(input.market.title);
  const titleParticipants = titleParticipantsDetailed
    ? [titleParticipantsDetailed.leftRaw, titleParticipantsDetailed.rightRaw] as const
    : extractMatchParticipantsFromTitle(input.market.title);
  const outcomeLabels = extractOutcomeLabels(input.market);
  const nonYesNoOutcomeLabels = outcomeLabels.filter((label) => !isYesNoLabel(label));

  if (input.family === "MATCHUP_WINNER") {
    const participants = titleParticipants ?? (nonYesNoOutcomeLabels.length === 2
      ? [nonYesNoOutcomeLabels[0]!, nonYesNoOutcomeLabels[1]!] as const
      : null);
    const normalizedSubject = normalizeSportsEntity(participants?.[0] ?? extractSubjectFromRules(input.market));
    const normalizedOpponent = normalizeSportsEntity(participants?.[1] ?? null);
    if (participants?.[0]) aliasSet.push(participants[0]);
    if (participants?.[1]) aliasSet.push(participants[1]);
    if (!normalizedSubject) {
      blockers.push("UNRESOLVED_ALIAS");
    }
    if (!normalizedOpponent) {
      blockers.push("OPPONENT_MISMATCH");
    }
    const yesNoSingleSide = nonYesNoOutcomeLabels.length === 0 && outcomeLabels.length > 0;
    return {
      family: input.family,
      subjectEntityRaw: participants?.[0] ?? extractSubjectFromRules(input.market),
      opponentEntityRaw: participants?.[1] ?? null,
      normalizedSubjectEntity: normalizedSubject,
      normalizedOpponentEntity: normalizedOpponent,
      matchupKey: buildSortedMatchupKey(normalizedSubject, normalizedOpponent),
      canonicalSortedTeams: [normalizedSubject, normalizedOpponent].filter((value): value is string => value !== null).sort((a, b) => a.localeCompare(b)),
      aliasSet,
      entityType: "TEAM_OR_ORG",
      sideAssignment: participants ? "LEFT" : "UNKNOWN",
      sideAssignmentSource: titleParticipantsDetailed ? "TITLE" : nonYesNoOutcomeLabels.length === 2 ? "OUTCOMES" : "UNKNOWN",
      outcomeMappingBasis: yesNoSingleSide ? "YES_NO_SINGLE_SIDE" : "DIRECT_MATCH_WINNER",
      confidence: normalizedSubject && normalizedOpponent && !yesNoSingleSide ? "1" : normalizedSubject ? "0.6" : "0.3",
      titleNoiseStripped: titleParticipantsDetailed?.titleNoiseStripped ?? false,
      blockers
    };
  }

  const outrightSubjectRaw = extractSubjectFromOutrightText(input.market);
  const normalizedSubjectEntity = normalizeSportsEntity(outrightSubjectRaw);
  if (outrightSubjectRaw) {
    aliasSet.push(outrightSubjectRaw);
  }
  if (!normalizedSubjectEntity) {
    blockers.push("UNRESOLVED_ALIAS");
  }
  return {
    family: input.family,
    subjectEntityRaw: outrightSubjectRaw,
    opponentEntityRaw: null,
    normalizedSubjectEntity,
    normalizedOpponentEntity: null,
    matchupKey: null,
    canonicalSortedTeams: normalizedSubjectEntity ? [normalizedSubjectEntity] : [],
    aliasSet,
    entityType: "TEAM_OR_ORG",
    sideAssignment: null,
    sideAssignmentSource: null,
    outcomeMappingBasis: "ENTITY_OUTRIGHT_YES_NO",
    confidence: normalizedSubjectEntity ? "1" : "0.35",
    titleNoiseStripped: false,
    blockers
  };
};
