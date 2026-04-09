import { describe, expect, it } from "vitest";

import {
  applySemanticRulepack,
  findSemanticRuleMatch,
  getLooseDiscoveryKeywords,
  rankSemanticCategories
} from "../../src/simulation/semantic-rulepack.js";

describe("semantic-rulepack", () => {
  it("applies checked-in aliases deterministically", () => {
    const applied = applySemanticRulepack(
      "Will OKC win the NBA Finals and will BTC hit ATH by March 31, 2026?",
      "SPORTS"
    );

    expect(applied.text).toContain("oklahoma city thunder");
    expect(applied.aliasesApplied).toContain("okc=>oklahoma city thunder");
  });

  it("finds field-level matches for exact semantic dimensions", () => {
    const subject = findSemanticRuleMatch("Will Gen.G win the LCK 2026 playoffs?", "ESPORTS", "subject");
    const competition = findSemanticRuleMatch("Will Gen.G win the LCK 2026 playoffs?", "ESPORTS", "competitionOrContext");

    expect(subject?.canonical).toBe("gen g esports");
    expect(competition?.canonical).toBe("lck 2026 season playoffs");
  });

  it("exposes discovery keywords and ranking for broader categories", () => {
    expect(getLooseDiscoveryKeywords("WEATHER")).toContain("landfall");
    expect(rankSemanticCategories("Hurricane landfall in Florida this season")[0]).toEqual(
      expect.objectContaining({ category: "WEATHER" })
    );
  });
});
