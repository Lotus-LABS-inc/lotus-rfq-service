import fixture from "./fixtures/polymarket-clob-v2-dry-run-order.fixture.json" with { type: "json" };
import { describe, expect, it } from "vitest";

import {
  PolymarketClobV2DryRunClient,
  type PolymarketClobV2DryRunOrderEnvelope,
  type PolymarketClobV2DryRunOrderInput
} from "../src/execution-system/index.js";

describe("Polymarket CLOB V2 Lotus-internal dry-run signing fixture", () => {
  it("matches the known-good internal envelope and signing hashes exactly", () => {
    const client = new PolymarketClobV2DryRunClient({
      executionMode: "v2",
      liveExecutionEnabled: true,
      clobHost: fixture.config.clobHost,
      chainId: fixture.config.chainId,
      apiKey: fixture.config.apiKey,
      apiSecret: fixture.config.apiSecret,
      apiPassphrase: fixture.config.apiPassphrase,
      builderCode: fixture.config.builderCode
    });

    const envelope = client.buildOrderEnvelope(fixture.input as PolymarketClobV2DryRunOrderInput);
    expect(envelope.envelopeKind).toBe("LOTUS_INTERNAL_DRY_RUN_SHAPE");
    expect(envelope).toEqual(fixture.expectedEnvelope as PolymarketClobV2DryRunOrderEnvelope);
  });

  it("keeps fixture credentials out of the emitted envelope", () => {
    const client = new PolymarketClobV2DryRunClient({
      executionMode: "v2",
      liveExecutionEnabled: true,
      clobHost: fixture.config.clobHost,
      chainId: fixture.config.chainId,
      apiKey: fixture.config.apiKey,
      apiSecret: fixture.config.apiSecret,
      apiPassphrase: fixture.config.apiPassphrase,
      builderCode: fixture.config.builderCode
    });

    const envelopeText = JSON.stringify(
      client.buildOrderEnvelope(fixture.input as PolymarketClobV2DryRunOrderInput)
    );
    expect(envelopeText).not.toContain(fixture.config.apiKey);
    expect(envelopeText).not.toContain(fixture.config.apiSecret);
    expect(envelopeText).not.toContain(fixture.config.apiPassphrase);
  });
});
