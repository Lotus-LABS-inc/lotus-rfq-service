import { describe, expect, it } from "vitest";
import { resolveOpinionOrderbookApiKeys } from "../src/integrations/opinion/opinion-orderbook-client.js";

describe("Opinion orderbook client helpers", () => {
  it("deduplicates and preserves configured Opinion orderbook key priority", () => {
    expect(resolveOpinionOrderbookApiKeys({
      OPINION_API_KEY: " primary ",
      OPINION_BUILDER_API_KEY: "primary",
      OPINION_BUILDER_SERVICE_API_KEY: " secondary ",
      OPINION_BUILDER_API: " tertiary "
    } as NodeJS.ProcessEnv)).toEqual(["primary", "secondary", "tertiary"]);
  });
});
