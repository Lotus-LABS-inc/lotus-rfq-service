import { describe, expect, it } from "vitest";

import {
    HistoricalMarketClass,
    HistoricalSimulationRunStatus,
    type CreateHistoricalMarketStateInput,
    type CreateHistoricalSimulationRunInput,
    type CreateHistoricalSimulationResultInput,
    type HistoricalMarketState,
    type HistoricalSimulationRequest,
    type HistoricalSimulationResult,
    type HistoricalVenueAdapter
} from "../../src/core/historical-simulation/historical-simulation.types.js";

describe("historical-simulation types", () => {
    it("exports the expected market class and run status enums", () => {
        expect(Object.values(HistoricalMarketClass)).toEqual(["BINARY"]);
        expect(Object.values(HistoricalSimulationRunStatus)).toEqual([
            "PENDING",
            "RUNNING",
            "SUCCEEDED",
            "FAILED",
            "CANCELLED"
        ]);
    });

    it("models nullable numeric and json fields on HistoricalMarketState", () => {
        const state: HistoricalMarketState = {
            id: "state-1",
            canonicalEventId: "event-1",
            canonicalCategory: "OTHER",
            venue: "PREDexon".toUpperCase(),
            venueMarketId: "market-1",
            marketClass: HistoricalMarketClass.BINARY,
            timestamp: new Date("2026-03-13T00:00:00.000Z"),
            midpoint: null,
            bestBid: null,
            bestAsk: null,
            spread: null,
            lastPrice: "0.51",
            volume: null,
            openInterest: null,
            candles: null,
            orderbookSnapshot: null,
            marketEvents: null,
            trades: null,
            ownExecutionHistory: null,
            metadataVersion: "v1",
            sourceTimestamp: new Date("2026-03-13T00:00:01.000Z")
        };

        expect(state.midpoint).toBeNull();
        expect(state.candles).toBeNull();
        expect(state.lastPrice).toBe("0.51");
    });

    it("models HistoricalSimulationRequest and HistoricalSimulationResult with deferred payload objects", () => {
        const request: HistoricalSimulationRequest = {
            scopeType: "MARKET",
            scopeId: "market-1",
            venuePair: "POLYMARKET|LIMITLESS",
            marketClass: HistoricalMarketClass.BINARY,
            canonicalEventId: "event-1",
            startTimestamp: new Date("2026-03-01T00:00:00.000Z"),
            endTimestamp: new Date("2026-03-02T00:00:00.000Z"),
            metadata: {
                simulationVersion: "phase4-v1"
            }
        };
        const result: HistoricalSimulationResult = {
            id: "result-1",
            runId: "run-1",
            canonicalEventId: "event-1",
            timestamp: new Date("2026-03-01T12:00:00.000Z"),
            baselineResults: { externalOnly: {} },
            lotusResult: { lotus: {} },
            improvement: { priceImprovement: "0.01" },
            rolloutEligibility: { safeEquivalent: true },
            createdAt: new Date("2026-03-01T12:00:01.000Z")
        };

        expect(request.venuePair).toBe("POLYMARKET|LIMITLESS");
        expect(result.rolloutEligibility.safeEquivalent).toBe(true);
    });

    it("models metadata defaults as optional on create inputs and required on persisted rows", () => {
        const adapter: HistoricalVenueAdapter = {
            venue: "LIMITLESS",
            marketClass: HistoricalMarketClass.BINARY,
            supportsCandles: false,
            supportsOrderbookHistory: true,
            supportsTradesHistory: true,
            supportsOwnExecutionHistory: true,
            metadataVersion: "v1"
        };
        const createState: CreateHistoricalMarketStateInput = {
            canonicalEventId: "event-1",
            canonicalCategory: "CRYPTO",
            venue: "LIMITLESS",
            venueMarketId: "market-1",
            marketClass: HistoricalMarketClass.BINARY,
            timestamp: new Date("2026-03-13T00:00:00.000Z"),
            metadataVersion: "v1",
            sourceTimestamp: new Date("2026-03-13T00:00:01.000Z")
        };
        const createRun: CreateHistoricalSimulationRunInput = {
            scopeType: "MARKET",
            scopeId: "market-1",
            venuePair: "POLYMARKET|LIMITLESS",
            marketClass: HistoricalMarketClass.BINARY,
            status: HistoricalSimulationRunStatus.PENDING
        };
        const createResult: CreateHistoricalSimulationResultInput = {
            runId: "run-1",
            canonicalEventId: "event-1",
            timestamp: new Date("2026-03-13T01:00:00.000Z"),
            baselineResults: {},
            lotusResult: {},
            improvement: {},
            rolloutEligibility: {}
        };

        expect(adapter.supportsTradesHistory).toBe(true);
        expect(createState.candles).toBeUndefined();
        expect(createRun.metadata).toBeUndefined();
        expect(createResult.createdAt).toBeUndefined();
    });
});
