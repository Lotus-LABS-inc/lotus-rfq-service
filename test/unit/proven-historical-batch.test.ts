import { describe, expect, it, vi } from "vitest";

import { buildProvenHistoricalBatchPlan, runProvenHistoricalBatch, type HistoricalRouteManifestEntry } from "../../src/operations/fast-testing/proven-historical-batch.js";

const createAcceptedRoute = (overrides: Partial<HistoricalRouteManifestEntry> = {}): HistoricalRouteManifestEntry => ({
  historicalCanonicalEventId: "HISTSIM::EVENT-1",
  historicalCanonicalMarketId: "HISTSIM-EVENT-1",
  title: "Accepted route",
  canonicalCategory: "CRYPTO",
  decision: {
    status: "accepted"
  },
  venueProfiles: [
    {
      venue: "POLYMARKET",
      historyWindow: {
        start: "2026-03-01T00:00:00.000Z",
        end: "2026-03-20T00:00:00.000Z"
      }
    },
    {
      venue: "LIMITLESS",
      historyWindow: {
        start: "2026-03-05T00:00:00.000Z",
        end: "2026-03-18T00:00:00.000Z"
      }
    }
  ],
  ...overrides
});

describe("proven historical batch planning", () => {
  it("builds BUY and SELL runs for supported accepted routes using the shared window intersection", () => {
    const routes: HistoricalRouteManifestEntry[] = [
      createAcceptedRoute(),
      createAcceptedRoute({
        historicalCanonicalEventId: "HISTSIM::EVENT-2",
        historicalCanonicalMarketId: "HISTSIM-EVENT-2",
        venueProfiles: [
          {
            venue: "OPINION",
            historyWindow: {
              start: "2026-03-10T00:00:00.000Z",
              end: "2026-03-19T23:59:59.000Z"
            }
          }
        ]
      })
    ];

    const plan = buildProvenHistoricalBatchPlan(routes);
    expect(plan.skippedRoutes).toHaveLength(0);
    expect(plan.plannedRuns).toHaveLength(4);
    expect(plan.plannedRuns[0]).toMatchObject({
      canonicalEventId: "HISTSIM::EVENT-1",
      routeMode: "POLYMARKET_LIMITLESS",
      side: "BUY"
    });
    expect(plan.plannedRuns[0]?.from.toISOString()).toBe("2026-03-05T00:00:00.000Z");
    expect(plan.plannedRuns[0]?.to.toISOString()).toBe("2026-03-18T00:00:00.000Z");
    expect(plan.plannedRuns[2]).toMatchObject({
      canonicalEventId: "HISTSIM::EVENT-2",
      routeMode: "OPINION_ONLY",
      side: "BUY"
    });
  });

  it("skips unsupported and empty-window routes explicitly", () => {
    const plan = buildProvenHistoricalBatchPlan([
      createAcceptedRoute({
        historicalCanonicalEventId: "HISTSIM::TRI",
        historicalCanonicalMarketId: "HISTSIM-TRI",
        venueProfiles: [
          {
            venue: "POLYMARKET",
            historyWindow: {
              start: "2026-03-01T00:00:00.000Z",
              end: "2026-03-02T00:00:00.000Z"
            }
          },
          {
            venue: "LIMITLESS",
            historyWindow: {
              start: "2026-03-01T00:00:00.000Z",
              end: "2026-03-02T00:00:00.000Z"
            }
          },
          {
            venue: "OPINION",
            historyWindow: {
              start: "2026-03-01T00:00:00.000Z",
              end: "2026-03-02T00:00:00.000Z"
            }
          }
        ]
      }),
      createAcceptedRoute({
        historicalCanonicalEventId: "HISTSIM::EMPTY",
        historicalCanonicalMarketId: "HISTSIM-EMPTY",
        venueProfiles: [
          {
            venue: "POLYMARKET",
            historyWindow: {
              start: "2026-03-05T00:00:00.000Z",
              end: "2026-03-06T00:00:00.000Z"
            }
          },
          {
            venue: "LIMITLESS",
            historyWindow: {
              start: "2026-03-07T00:00:00.000Z",
              end: "2026-03-08T00:00:00.000Z"
            }
          }
        ]
      })
    ]);

    expect(plan.plannedRuns).toHaveLength(0);
    expect(plan.skippedRoutes).toEqual([
      expect.objectContaining({ canonicalEventId: "HISTSIM::TRI", reason: "unsupported_route" }),
      expect.objectContaining({ canonicalEventId: "HISTSIM::EMPTY", reason: "empty_history_window" })
    ]);
  });

  it("reports successful and failed run executions", async () => {
    const simulationAdminService = {
      runSimulation: vi.fn()
        .mockResolvedValueOnce({
          run: { id: "run-buy" },
          simulationResult: {
            runId: "run-buy",
            status: "SUCCEEDED",
            persistedResultCount: 3,
            blockedSliceCount: 0,
            sliceCount: 3
          }
        })
        .mockRejectedValueOnce(Object.assign(new Error("route blocked"), { code: "blocked" }))
    };

    const summary = await runProvenHistoricalBatch({
      routes: [
        createAcceptedRoute({
          venueProfiles: [
            {
              venue: "OPINION",
              historyWindow: {
                start: "2026-03-10T00:00:00.000Z",
                end: "2026-03-19T23:59:59.000Z"
              }
            }
          ]
        })
      ],
      simulationAdminService
    });

    expect(simulationAdminService.runSimulation).toHaveBeenCalledTimes(2);
    expect(summary.completedRuns).toHaveLength(1);
    expect(summary.failedRuns).toHaveLength(1);
    expect(summary.completedRuns[0]?.runId).toBe("run-buy");
    expect(summary.failedRuns[0]).toMatchObject({
      errorCode: "blocked",
      errorMessage: "route blocked"
    });
  });
});
