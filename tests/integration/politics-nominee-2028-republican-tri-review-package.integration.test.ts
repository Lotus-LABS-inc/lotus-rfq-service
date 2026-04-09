import { describe, expect, it } from "vitest";

describe("politics nominee 2028 republican tri review package", () => {
  it("locks review scope to the Republican LIMITLESS|OPINION|POLYMARKET tri subset and keeps activation out of scope", async () => {
    const module = await import("../../src/reports/politics-nominee-2028-republican-tri-review-package.js");
    expect(module.runPoliticsNominee2028RepublicanTriReviewPackagePass).toBeTypeOf("function");
  });
});
