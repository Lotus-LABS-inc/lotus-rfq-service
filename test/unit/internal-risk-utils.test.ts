import { describe, expect, it } from "vitest";
import {
  calculateExposureDelta,
  ExposureDeltaValidationError
} from "../../src/core/internal-engine/risk-utils.js";

describe("calculateExposureDelta", () => {
  it("calculates BUY exposure deltas with decimal string inputs", () => {
    const result = calculateExposureDelta("BUY", "0.42", "10.5");

    expect(result).toEqual({
      maxLossDelta: "4.41",
      maxGainDelta: "6.09"
    });
  });

  it("calculates SELL exposure deltas with decimal string inputs", () => {
    const result = calculateExposureDelta("SELL", "0.42", "10.5");

    expect(result).toEqual({
      maxLossDelta: "6.09",
      maxGainDelta: "4.41"
    });
  });

  it("accepts lowercase side values", () => {
    expect(calculateExposureDelta("buy", "0.25", "4")).toEqual({
      maxLossDelta: "1",
      maxGainDelta: "3"
    });
    expect(calculateExposureDelta("sell", "0.25", "4")).toEqual({
      maxLossDelta: "3",
      maxGainDelta: "1"
    });
  });

  it("rounds using ROUND_HALF_UP to 8 decimal places", () => {
    const result = calculateExposureDelta("BUY", "0.333333335", "1");

    expect(result).toEqual({
      maxLossDelta: "0.33333334",
      maxGainDelta: "0.66666667"
    });
  });

  it("handles edge prices at 0 and 1", () => {
    expect(calculateExposureDelta("BUY", "0", "3")).toEqual({
      maxLossDelta: "0",
      maxGainDelta: "3"
    });
    expect(calculateExposureDelta("SELL", "1", "3")).toEqual({
      maxLossDelta: "0",
      maxGainDelta: "3"
    });
  });

  it("rejects invalid side values", () => {
    expect(() => calculateExposureDelta("LONG" as never, "0.5", "1")).toThrowError(
      new ExposureDeltaValidationError("unsupported side: LONG")
    );
  });

  it("rejects invalid price values", () => {
    expect(() => calculateExposureDelta("BUY", "-0.1", "1")).toThrowError(
      new ExposureDeltaValidationError("price must be within [0, 1] for prediction markets")
    );
    expect(() => calculateExposureDelta("BUY", "1.1", "1")).toThrowError(
      new ExposureDeltaValidationError("price must be within [0, 1] for prediction markets")
    );
    expect(() => calculateExposureDelta("BUY", "not-a-number", "1")).toThrowError(
      new ExposureDeltaValidationError("price must be a valid decimal")
    );
  });

  it("rejects invalid size values", () => {
    expect(() => calculateExposureDelta("SELL", "0.5", "-1")).toThrowError(
      new ExposureDeltaValidationError("size must be greater than or equal to 0")
    );
    expect(() => calculateExposureDelta("SELL", "0.5", "NaN")).toThrowError(
      new ExposureDeltaValidationError("size must be finite")
    );
  });
});
