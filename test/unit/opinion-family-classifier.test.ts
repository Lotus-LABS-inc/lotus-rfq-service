import { describe, expect, it } from "vitest";

import { classifyStructuredOpinionFamily } from "../../src/integrations/opinion/opinion-family-classifier.js";

describe("classifyStructuredOpinionFamily", () => {
  it("keeps crypto ATH and directional families separate", () => {
    expect(classifyStructuredOpinionFamily({
      category: "CRYPTO",
      title: "Bitcoin all time high by March 31, 2026?",
      rules: "Resolves YES if BTC reaches a new all time high by March 31, 2026."
    }).familyBucket).toBe("ATH_BY_DATE");

    expect(classifyStructuredOpinionFamily({
      category: "CRYPTO",
      title: "Bitcoin Up or Down on March 30?(12:00 ET)",
      rules: null
    }).familyBucket).toBe("SAME_DAY_DIRECTIONAL");
  });

  it("keeps sports championship and matchup winner families separate", () => {
    expect(classifyStructuredOpinionFamily({
      category: "SPORTS",
      title: "Will OKC win the NBA Finals?",
      rules: "Resolves YES if Oklahoma City Thunder wins the NBA Finals."
    }).familyBucket).toBe("CHAMPIONSHIP_WINNER");

    expect(classifyStructuredOpinionFamily({
      category: "SPORTS",
      title: "NBA: Thunder vs Celtics (Mar. 25 7:30PM ET)",
      rules: null
    }).familyBucket).toBe("MATCHUP_WINNER");
  });

  it("keeps esports league and matchup winner families separate", () => {
    expect(classifyStructuredOpinionFamily({
      category: "ESPORTS",
      title: "Will Gen.G win LCK Spring 2026?",
      rules: "Resolves YES if Gen.G wins LCK Spring 2026."
    }).familyBucket).toBe("SPLIT_WINNER");

    expect(classifyStructuredOpinionFamily({
      category: "ESPORTS",
      title: "LCK: T1 vs Gen.G (Mar. 31 6:00AM ET)",
      rules: null
    }).familyBucket).toBe("MATCHUP_WINNER");
  });
});
