import { describe, expect, it } from "vitest";
import { QuoteStaleError, QuoteStalenessGuard } from "../../src/core/quote-staleness-guard.js";

describe("QuoteStalenessGuard", () => {
  const now = () => new Date("2026-02-25T10:00:00.000Z");
  const guard = new QuoteStalenessGuard(now);

  it("detects hard expiry", () => {
    expect(
      guard.isExpired({
        expires_at: "2026-02-25T09:59:59.000Z",
        soft_refresh_flag: false
      })
    ).toBe(true);
  });

  it("treats missing firm window as firm", () => {
    expect(
      guard.isFirm({
        expires_at: "2026-02-25T10:10:00.000Z",
        soft_refresh_flag: false
      })
    ).toBe(true);
  });

  it("rejects non-firm quotes before execution", () => {
    expect(() =>
      guard.validateBeforeExecution({
        expires_at: "2026-02-25T10:10:00.000Z",
        firm_until: "2026-02-25T09:59:00.000Z",
        soft_refresh_flag: true
      })
    ).toThrowError(QuoteStaleError);
  });

  it("filters out expired and non-firm quotes", () => {
    const valid = {
      expires_at: "2026-02-25T10:10:00.000Z",
      firm_until: "2026-02-25T10:05:00.000Z",
      soft_refresh_flag: false,
      id: "valid"
    };
    const expired = {
      expires_at: "2026-02-25T09:00:00.000Z",
      firm_until: "2026-02-25T10:05:00.000Z",
      soft_refresh_flag: false,
      id: "expired"
    };
    const nonFirm = {
      expires_at: "2026-02-25T10:10:00.000Z",
      firm_until: "2026-02-25T09:00:00.000Z",
      soft_refresh_flag: true,
      id: "non-firm"
    };

    const output = guard.filterValidQuotes([valid, expired, nonFirm]);
    expect(output).toEqual([valid]);
  });
});
