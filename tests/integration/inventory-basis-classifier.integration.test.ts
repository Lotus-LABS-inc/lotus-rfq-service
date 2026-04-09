import { describe, expect, it } from "vitest";

import {
  classifyEvidenceLabelBasis,
  classifyHistoricalMetadataVersionBasis,
  classifyRouteabilityBasis
} from "../../src/inventory/inventory-basis-classifier.js";

describe("inventory basis classifier", () => {
  it("maps evidence labels deterministically", () => {
    expect(classifyEvidenceLabelBasis("historical")).toBe("HISTORICAL");
    expect(classifyEvidenceLabelBasis("current_state")).toBe("LIVE_CURRENT_STATE");
    expect(classifyEvidenceLabelBasis("recorder")).toBe("LIVE_CURRENT_STATE");
    expect(classifyEvidenceLabelBasis("live_inventory_only")).toBe("LIVE_INVENTORY_ONLY");
    expect(classifyEvidenceLabelBasis("fallback")).toBe("UNKNOWN");
  });

  it("maps metadata versions deterministically", () => {
    expect(classifyHistoricalMetadataVersionBasis("opinion-current-bootstrap-v1")).toBe("LIVE_CURRENT_STATE");
    expect(classifyHistoricalMetadataVersionBasis("limitless-live-bootstrap-v1")).toBe("LIVE_CURRENT_STATE");
    expect(classifyHistoricalMetadataVersionBasis("predexon-v2")).toBe("HISTORICAL");
    expect(classifyHistoricalMetadataVersionBasis("predict-fallback-v1")).toBe("UNKNOWN");
  });

  it("classifies routeability basis correctly", () => {
    expect(classifyRouteabilityBasis(["HISTORICAL", "HISTORICAL"])).toBe("HISTORICAL_ONLY");
    expect(classifyRouteabilityBasis(["LIVE_CURRENT_STATE", "LIVE_INVENTORY_ONLY"])).toBe("LIVE_ONLY");
    expect(classifyRouteabilityBasis(["HISTORICAL", "LIVE_CURRENT_STATE"])).toBe("MIXED_BASIS");
    expect(classifyRouteabilityBasis(["UNKNOWN"])).toBe("INSUFFICIENT_BASIS");
  });
});
