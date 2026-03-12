import type { Pool, QueryResult } from "pg";
import type {
    ReplayEnvelope,
    SerializedReplayEnvelopePayload,
    WriteReplayEnvelopeInput
} from "./replay.types.js";

type JsonPrimitive = string | number | boolean | null;
type OrderedJsonValue = JsonPrimitive | OrderedJsonValue[] | { [key: string]: OrderedJsonValue };

export type ReplayEnvelopeWriterErrorCode =
    | "invalid_replay_input"
    | "invalid_replay_json"
    | "replay_persistence_failed";

export class ReplayEnvelopeWriterError extends Error {
    readonly code: ReplayEnvelopeWriterErrorCode;

    constructor(code: ReplayEnvelopeWriterErrorCode, message: string) {
        super(message);
        this.name = "ReplayEnvelopeWriterError";
        this.code = code;
    }
}

export interface IReplayEnvelopeWriter {
    write(input: WriteReplayEnvelopeInput): Promise<ReplayEnvelope>;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};

const ensureNonEmptyString = (value: string, fieldName: string): void => {
    if (value.trim().length === 0) {
        throw new ReplayEnvelopeWriterError("invalid_replay_input", `${fieldName} must be a non-empty string.`);
    }
};

const normalizeJsonValue = (value: unknown, path: string): OrderedJsonValue => {
    if (value === null) {
        return null;
    }

    if (typeof value === "string" || typeof value === "boolean") {
        return value;
    }

    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new ReplayEnvelopeWriterError("invalid_replay_json", `${path} contains a non-finite number.`);
        }
        return value;
    }

    if (typeof value === "undefined") {
        throw new ReplayEnvelopeWriterError("invalid_replay_json", `${path} contains undefined.`);
    }

    if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
        throw new ReplayEnvelopeWriterError("invalid_replay_json", `${path} contains a non-JSON-safe value.`);
    }

    if (Array.isArray(value)) {
        return value.map((entry, index) => normalizeJsonValue(entry, `${path}[${index}]`));
    }

    if (!isPlainObject(value)) {
        throw new ReplayEnvelopeWriterError("invalid_replay_json", `${path} contains a non-plain object.`);
    }

    return Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .reduce<Record<string, OrderedJsonValue>>((accumulator, key) => {
            accumulator[key] = normalizeJsonValue(value[key], `${path}.${key}`);
            return accumulator;
        }, {});
};

export const orderKeysDeterministically = (value: unknown): OrderedJsonValue =>
    normalizeJsonValue(value, "$");

export const stableJsonSerialize = (value: unknown): string =>
    JSON.stringify(orderKeysDeterministically(value));

interface ReplayEnvelopeRow {
    id: string;
    decision_type: string;
    entity_id: string;
    correlation_id: string;
    config_version: string;
    engine_version: string;
    feature_flags: Record<string, unknown>;
    input_snapshot: Record<string, unknown>;
    decision_trace: Record<string, unknown>;
    output_snapshot: Record<string, unknown>;
    created_at: Date;
}

const mapReplayEnvelopeRow = (row: ReplayEnvelopeRow): ReplayEnvelope => ({
    id: row.id,
    decisionType: row.decision_type as ReplayEnvelope["decisionType"],
    entityId: row.entity_id,
    correlationId: row.correlation_id,
    configVersion: row.config_version,
    engineVersion: row.engine_version,
    featureFlags: row.feature_flags,
    inputSnapshot: row.input_snapshot,
    decisionTrace: row.decision_trace,
    outputSnapshot: row.output_snapshot,
    createdAt: new Date(row.created_at)
});

export class ReplayEnvelopeWriter implements IReplayEnvelopeWriter {
    private readonly pool: Pool;

    constructor(options: { pool: Pool }) {
        this.pool = options.pool;
    }

    async write(input: WriteReplayEnvelopeInput): Promise<ReplayEnvelope> {
        this.validateInput(input);

        const serializedPayload = this.serializePayload(input);

        try {
            const result: QueryResult<ReplayEnvelopeRow> = await this.pool.query(
                `INSERT INTO replay_envelopes
                    (decision_type, entity_id, correlation_id, config_version, engine_version,
                     feature_flags, input_snapshot, decision_trace, output_snapshot)
                 VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb)
                 RETURNING
                    id,
                    decision_type,
                    entity_id,
                    correlation_id,
                    config_version,
                    engine_version,
                    feature_flags,
                    input_snapshot,
                    decision_trace,
                    output_snapshot,
                    created_at`,
                [
                    input.decisionType,
                    input.entityId,
                    input.correlationId,
                    input.configVersion,
                    input.engineVersion,
                    serializedPayload.featureFlags,
                    serializedPayload.inputSnapshot,
                    serializedPayload.decisionTrace,
                    serializedPayload.outputSnapshot
                ]
            );

            const row = result.rows[0];
            if (row === undefined) {
                throw new ReplayEnvelopeWriterError("replay_persistence_failed", "Replay envelope insert returned no row.");
            }

            return mapReplayEnvelopeRow(row);
        } catch (error) {
            if (error instanceof ReplayEnvelopeWriterError) {
                throw error;
            }

            throw new ReplayEnvelopeWriterError("replay_persistence_failed", "Failed to persist replay envelope.");
        }
    }

    private validateInput(input: WriteReplayEnvelopeInput): void {
        ensureNonEmptyString(input.decisionType, "decisionType");
        ensureNonEmptyString(input.entityId, "entityId");
        ensureNonEmptyString(input.correlationId, "correlationId");
        ensureNonEmptyString(input.configVersion, "configVersion");
        ensureNonEmptyString(input.engineVersion, "engineVersion");

        if (!isPlainObject(input.featureFlags)) {
            throw new ReplayEnvelopeWriterError("invalid_replay_input", "featureFlags must be a plain object.");
        }
        if (!isPlainObject(input.inputSnapshot)) {
            throw new ReplayEnvelopeWriterError("invalid_replay_input", "inputSnapshot must be a plain object.");
        }
        if (!isPlainObject(input.decisionTrace)) {
            throw new ReplayEnvelopeWriterError("invalid_replay_input", "decisionTrace must be a plain object.");
        }
        if (!isPlainObject(input.outputSnapshot)) {
            throw new ReplayEnvelopeWriterError("invalid_replay_input", "outputSnapshot must be a plain object.");
        }
    }

    private serializePayload(input: WriteReplayEnvelopeInput): SerializedReplayEnvelopePayload {
        return {
            featureFlags: stableJsonSerialize(input.featureFlags),
            inputSnapshot: stableJsonSerialize(input.inputSnapshot),
            decisionTrace: stableJsonSerialize(input.decisionTrace),
            outputSnapshot: stableJsonSerialize(input.outputSnapshot)
        };
    }
}
