import { describe, expect, it } from "vitest";

import {
  canLooseMatchCategoryText,
  compareStructuredPropositions,
  parseStructuredProposition
} from "../../src/simulation/proposition-matching.js";
import {
  rankSemanticCategories
} from "../../src/simulation/semantic-rulepack.js";

describe("proposition-matching", () => {
  it("normalizes politics aliases into structured fields", () => {
    const parsed = parseStructuredProposition({
      category: "POLITICS",
      title: "Will Gavin Newsom win the Democratic presidential nomination?",
      rules: "This market resolves YES if Gavin Newsom becomes the 2028 Democratic nominee.",
      yesLabel: "Yes",
      noLabel: "No"
    });

    expect(parsed.subject.normalized).toBe("gavin newsom");
    expect(parsed.actionOrCondition.normalized).toBe("win nomination");
    expect(parsed.competitionOrContext.normalized).toBe("2028 democratic presidential nomination");
    expect(parsed.outcomeSchema.normalized).toBe("YES_NO");
  });

  it("normalizes crypto ATH aliases and thresholds deterministically", () => {
    const parsed = parseStructuredProposition({
      category: "CRYPTO",
      title: "BTC ATH by March 31, 2026?",
      rules: "Resolves YES if Bitcoin reaches a new all time high by March 31, 2026.",
      yesLabel: "Yes",
      noLabel: "No"
    });

    expect(parsed.subject.normalized).toBe("bitcoin");
    expect(parsed.actionOrCondition.normalized).toBe("reach all time high");
    expect(parsed.deadlineOrSeason.normalized).toBe("march 31 2026");
  });

  it("infers crypto ATH action and missing by-date year from boundary reference time", () => {
    const parsed = parseStructuredProposition({
      category: "CRYPTO",
      title: "BTC all time high by March 31?",
      rules: null,
      boundaryReferenceAt: new Date("2026-03-31T12:00:00Z"),
      yesLabel: "Yes",
      noLabel: "No"
    });

    expect(parsed.subject.normalized).toBe("bitcoin");
    expect(parsed.actionOrCondition.normalized).toBe("reach all time high");
    expect(parsed.threshold.normalized).toBe("all time high");
    expect(parsed.deadlineOrSeason.normalized).toBe("march 31 2026");
  });

  it("normalizes sports and esports aliases", () => {
    const sports = parseStructuredProposition({
      category: "SPORTS",
      title: "Will OKC win the NBA Finals?",
      rules: "Resolves YES if Oklahoma City Thunder wins the NBA Finals.",
      yesLabel: "Yes",
      noLabel: "No"
    });
    const esports = parseStructuredProposition({
      category: "ESPORTS",
      title: "Will Gen.G win the LCK 2026 playoffs?",
      rules: "Resolves YES if Gen.G Esports wins the LCK 2026 season playoffs.",
      yesLabel: "Yes",
      noLabel: "No"
    });

    expect(sports.subject.normalized).toBe("oklahoma city thunder");
    expect(sports.competitionOrContext.normalized).toBe("nba finals");
    expect(esports.subject.normalized).toBe("gen g esports");
    expect(esports.competitionOrContext.normalized).toBe("lck 2026 season playoffs");
  });

  it("parses broader culture, tech, weather and other discovery semantics conservatively", () => {
    const culture = parseStructuredProposition({
      category: "CULTURE",
      title: "Will Dune win an Oscar in 2026?",
      rules: "Resolves YES if Dune wins an Academy Award in 2026.",
      yesLabel: "Yes",
      noLabel: "No"
    });
    const tech = parseStructuredProposition({
      category: "TECH",
      title: "Will OpenAI launch a new model in 2026?",
      rules: "Resolves YES if OpenAI announces and releases a new flagship AI model in 2026.",
      yesLabel: "Yes",
      noLabel: "No"
    });
    const weather = parseStructuredProposition({
      category: "WEATHER",
      title: "Will a hurricane make landfall in Florida by March 31, 2026?",
      rules: "Resolves YES if a named storm makes landfall in Florida by March 31, 2026.",
      yesLabel: "Yes",
      noLabel: "No"
    });
    const other = parseStructuredProposition({
      category: "OTHER",
      title: "Will US inflation be above 3.5% in Q3 2026?",
      rules: "Resolves YES if CPI is above 3.5% in Q3 2026.",
      yesLabel: "Yes",
      noLabel: "No"
    });

    expect(culture.actionOrCondition.normalized).toBe("award win");
    expect(tech.subject.normalized).toBe("openai");
    expect(tech.actionOrCondition.normalized).toBe("model release");
    expect(weather.actionOrCondition.normalized).toBe("landfall");
    expect(weather.deadlineOrSeason.normalized).toBe("march 31 2026");
    expect(other.threshold.normalized).toBe("above:3.5");
    expect(other.deadlineOrSeason.normalized).toBe("q3");
  });

  it("classifies perfect and near-exact comparisons deterministically", () => {
    const seed = parseStructuredProposition({
      category: "POLITICS",
      title: "Will Gavin Newsom win the 2028 Democratic presidential nomination?",
      rules: "Resolves YES if Gavin Newsom becomes the 2028 Democratic nominee.",
      yesLabel: "Yes",
      noLabel: "No"
    });
    const exactCandidate = parseStructuredProposition({
      category: "POLITICS",
      title: "Will Gavin Newsom win the Democratic presidential nomination?",
      rules: "Resolves YES if Gavin Newsom wins the 2028 Democratic nominee contest.",
      yesLabel: "Yes",
      noLabel: "No"
    });
    const nearCandidate = parseStructuredProposition({
      category: "POLITICS",
      title: "Will Jon Ossoff win the Democratic presidential nomination?",
      rules: "Resolves YES if Jon Ossoff wins the 2028 Democratic nominee contest.",
      yesLabel: "Yes",
      noLabel: "No"
    });

    expect(compareStructuredPropositions({
      seed,
      candidate: exactCandidate,
      historyQualified: true,
      requireHistoricalQualification: true
    }).classification).toBe("semantic_exact_historical_qualified");

    const near = compareStructuredPropositions({
      seed,
      candidate: nearCandidate,
      historyQualified: true,
      requireHistoricalQualification: true
    });
    expect(near.classification).toBe("semantic_near_exact");
    expect(near.failedDimensions).toContain("subjectEntityMatch");
  });

  it("keeps exact same-day date-bounded markets exact and downgrades wrong-day variants", () => {
    const seed = parseStructuredProposition({
      category: "CRYPTO",
      title: "Bitcoin Up or Down on March 21, 2026?",
      rules: "Resolves YES if BTC/USD is up on March 21, 2026.",
      yesLabel: "Yes",
      noLabel: "No"
    });
    const sameDay = parseStructuredProposition({
      category: "CRYPTO",
      title: "BTC Up or Down on March 21, 2026?",
      rules: "Resolves YES if Bitcoin is up on March 21, 2026.",
      yesLabel: "Yes",
      noLabel: "No"
    });
    const wrongDay = parseStructuredProposition({
      category: "CRYPTO",
      title: "BTC Up or Down on March 28, 2026?",
      rules: "Resolves YES if Bitcoin is up on March 28, 2026.",
      yesLabel: "Yes",
      noLabel: "No"
    });

    expect(seed.deadlineOrSeason.normalized).toBe("march 21 2026");
    expect(sameDay.deadlineOrSeason.normalized).toBe("march 21 2026");
    expect(wrongDay.deadlineOrSeason.normalized).toBe("march 28 2026");

    expect(compareStructuredPropositions({
      seed,
      candidate: sameDay,
      historyQualified: true,
      requireHistoricalQualification: true
    }).classification).toBe("semantic_exact_historical_qualified");

    const downgraded = compareStructuredPropositions({
      seed,
      candidate: wrongDay,
      historyQualified: true,
      requireHistoricalQualification: true
    });
    expect(downgraded.classification).toBe("semantic_near_exact");
    expect(downgraded.failedDimensions).toContain("timeBoundaryMatch");
  });

  it("pools the same politics proposition across venues and downgrades different subjects", () => {
    const seed = parseStructuredProposition({
      category: "POLITICS",
      title: "Will Gavin Newsom win the 2028 Democratic presidential nomination?",
      rules: "Resolves YES if Gavin Newsom becomes the 2028 Democratic nominee.",
      yesLabel: "Yes",
      noLabel: "No"
    });
    const sameAcrossVenue = parseStructuredProposition({
      category: "POLITICS",
      title: "Gavin Newsom to win the Democratic presidential nomination?",
      rules: "Resolves YES if Gavin Newsom wins the 2028 Democratic nominee contest.",
      yesLabel: "Yes",
      noLabel: "No"
    });
    const differentSubject = parseStructuredProposition({
      category: "POLITICS",
      title: "Will Jon Ossoff win the Democratic presidential nomination?",
      rules: "Resolves YES if Jon Ossoff wins the 2028 Democratic nominee contest.",
      yesLabel: "Yes",
      noLabel: "No"
    });

    expect(compareStructuredPropositions({
      seed,
      candidate: sameAcrossVenue,
      historyQualified: true,
      requireHistoricalQualification: true
    }).classification).toBe("semantic_exact_historical_qualified");

    expect(compareStructuredPropositions({
      seed,
      candidate: differentSubject,
      historyQualified: true,
      requireHistoricalQualification: true
    }).failedDimensions).toContain("subjectEntityMatch");
  });

  it("pools the same sports and esports propositions across venues", () => {
    const sportsSeed = parseStructuredProposition({
      category: "SPORTS",
      title: "Will the Oklahoma City Thunder win the NBA Finals?",
      rules: "Resolves YES if the Oklahoma City Thunder win the NBA Finals.",
      yesLabel: "Yes",
      noLabel: "No"
    });
    const sportsAcrossVenue = parseStructuredProposition({
      category: "SPORTS",
      title: "OKC Thunder to win the NBA Finals?",
      rules: "Resolves YES if Oklahoma City Thunder wins the NBA Finals.",
      yesLabel: "Yes",
      noLabel: "No"
    });
    const esportsSeed = parseStructuredProposition({
      category: "ESPORTS",
      title: "Will Gen.G win the LCK 2026 playoffs?",
      rules: "Resolves YES if Gen.G Esports wins the LCK 2026 season playoffs.",
      yesLabel: "Yes",
      noLabel: "No"
    });
    const esportsAcrossVenue = parseStructuredProposition({
      category: "ESPORTS",
      title: "Gen.G Esports to win the LCK 2026 season playoffs?",
      rules: "Resolves YES if Gen.G wins the LCK 2026 season playoffs.",
      yesLabel: "Yes",
      noLabel: "No"
    });

    expect(compareStructuredPropositions({
      seed: sportsSeed,
      candidate: sportsAcrossVenue,
      historyQualified: true,
      requireHistoricalQualification: true
    }).classification).toBe("semantic_exact_historical_qualified");

    expect(compareStructuredPropositions({
      seed: esportsSeed,
      candidate: esportsAcrossVenue,
      historyQualified: true,
      requireHistoricalQualification: true
    }).classification).toBe("semantic_exact_historical_qualified");
  });

  it("infers missing year for month-day titles from boundary reference time", () => {
    const parsed = parseStructuredProposition({
      category: "CRYPTO",
      title: "Bitcoin Up or Down on March 21?",
      rules: null,
      boundaryReferenceAt: new Date("2026-03-21T00:00:00Z")
    });

    expect(parsed.deadlineOrSeason.normalized).toBe("march 21 2026");
  });

  it("uses boundary reference dates for same-day sports match winners when the title omits the date", () => {
    const parsed = parseStructuredProposition({
      category: "SPORTS",
      title: "Lakers vs. Magic",
      rules: "Resolves YES if the Lakers win the match.",
      boundaryReferenceAt: new Date("2026-03-21T23:00:00Z")
    });

    expect(parsed.actionOrCondition.normalized).toBe("win match");
    expect(parsed.deadlineOrSeason.normalized).toBe("mar 21 2026");
  });

  it("keeps loose matching deterministic by category keywords", () => {
    expect(canLooseMatchCategoryText("CRYPTO", "Bitcoin all time high by March 31")).toBe(true);
    expect(canLooseMatchCategoryText("SPORTS", "Will the Oklahoma City Thunder win the NBA Finals?")).toBe(true);
    expect(canLooseMatchCategoryText("POLITICS", "Jazz vs Suns tonight")).toBe(false);
    expect(canLooseMatchCategoryText("WEATHER", "Will a hurricane make landfall in Florida?")).toBe(true);
    expect(canLooseMatchCategoryText("TECH", "OpenAI model launch next year")).toBe(true);
  });

  it("ranks semantic categories from the shared rulepack", () => {
    const ranked = rankSemanticCategories("OpenAI will launch a new AI model while Nvidia ships new GPUs");
    expect(ranked[0]).toEqual(expect.objectContaining({
      category: "TECH"
    }));
  });
});
