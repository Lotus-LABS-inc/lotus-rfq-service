import { describe, expect, it, vi } from "vitest";
import type { Pool, QueryResult, QueryResultRow } from "pg";
import {
    ReplayEnvelopeWriter,
    ReplayEnvelopeWriterError,
    orderKeysDeterministically,
    stableJsonSerialize
} from "../../src/core/replay/replay-envelope-writer.js";
import type { WriteReplayEnvelopeInput } from "../../src/core/replay/replay.types.js";

const makeInput = (): WriteReplayEnvelopeInput => ({
    decisionType: "RFQ_GROUPING",
    entityId: "rfq-session-1",
    correlationId: "corr-1",
    configVersion: "config-v1",
    engineVersion: "engine-v1",
    featureFlags: {
        bFlag: true,
        aFlag: false
    },
    inputSnapshot: {
        market: "market-1",
        venueIds: ["venue-b", "venue-a"]
    },
    decisionTrace: {
        selected: {
            lane: "safe"
        },
        reasons: ["safe equivalent"]
    },
    outputSnapshot: {
        lanes: [{ id: "safe-1", members: ["venue-a", "venue-b"] }]
    }
});

const makeQueryResult = <T extends QueryResultRow>(rows: T[]): QueryResult<T> => ({
    command: "INSERT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows
});

describe("ReplayEnvelopeWriter", () => {
    it("orders object keys deterministically and preserves array order", () => {
        const ordered = orderKeysDeterministically({
            zeta: 1,
            alpha: {
                beta: 2,
                alpha: 1
            },
            items: [{ b: 2, a: 1 }, "tail"]
        });

        expect(ordered).toEqual({
            alpha: {
                alpha: 1,
                beta: 2
            },
            items: [{ a: 1, b: 2 }, "tail"],
            zeta: 1
        });
    });

    it("produces identical serialized payloads for logically identical input", () => {
        const left = {
            beta: true,
            alpha: {
                two: 2,
                one: 1
            }
        };

        const right = {
            alpha: {
                one: 1,
                two: 2
            },
            beta: true
        };

        expect(stableJsonSerialize(left)).toBe(stableJsonSerialize(right));
    });

    it("fails closed on non-json-safe payload values", () => {
        expect(() =>
            stableJsonSerialize({
                value: Number.NaN
            })
        ).toThrowError(ReplayEnvelopeWriterError);
    });

    it("persists a replay envelope with deterministically serialized payloads", async () => {
        const input = makeInput();

        const query = vi.fn(async (_sql: string, params?: unknown[]) =>
            makeQueryResult([
                {
                    id: "envelope-1",
                    decision_type: input.decisionType,
                    entity_id: input.entityId,
                    correlation_id: input.correlationId,
                    config_version: input.configVersion,
                    engine_version: input.engineVersion,
                    feature_flags: JSON.parse(params?.[5] as string),
                    input_snapshot: JSON.parse(params?.[6] as string),
                    decision_trace: JSON.parse(params?.[7] as string),
                    output_snapshot: JSON.parse(params?.[8] as string),
                    created_at: new Date("2026-03-11T12:00:00.000Z")
                }
            ])
        );

        const writer = new ReplayEnvelopeWriter({
            pool: { query } as unknown as Pool
        });

        const result = await writer.write(input);

        expect(query).toHaveBeenCalledTimes(1);
        const params = query.mock.calls[0]?.[1] as unknown[];
        expect(params[5]).toBe(stableJsonSerialize(input.featureFlags));
        expect(params[6]).toBe(stableJsonSerialize(input.inputSnapshot));
        expect(params[7]).toBe(stableJsonSerialize(input.decisionTrace));
        expect(params[8]).toBe(stableJsonSerialize(input.outputSnapshot));
        expect(result).toMatchObject({
            id: "envelope-1",
            decisionType: "RFQ_GROUPING",
            entityId: "rfq-session-1",
            correlationId: "corr-1"
        });
    });

    it("rejects invalid top-level replay input before persistence", async () => {
        const writer = new ReplayEnvelopeWriter({
            pool: { query: vi.fn() } as unknown as Pool
        });

        await expect(
            writer.write({
                ...makeInput(),
                inputSnapshot: [] as unknown as Record<string, unknown>
            })
        ).rejects.toMatchObject({
            code: "invalid_replay_input"
        });
    });
});
