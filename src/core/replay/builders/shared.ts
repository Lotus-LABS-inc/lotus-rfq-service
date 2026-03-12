import {
    stableJsonSerialize,
    type ReplayEnvelopeWriterErrorCode
} from "../replay-envelope-writer.js";
import type {
    ReplayBuilderBaseMetadata,
    ReplayDecisionType,
    WriteReplayEnvelopeInput
} from "../replay.types.js";

type ReplaySafePrimitive = string | number | boolean | null;
type ReplaySafeValue =
    | ReplaySafePrimitive
    | readonly ReplaySafeValue[]
    | { readonly [key: string]: ReplaySafeValue };

export class ReplaySnapshotBuilderError extends Error {
    readonly code: ReplayEnvelopeWriterErrorCode | "invalid_snapshot_input";

    constructor(code: ReplayEnvelopeWriterErrorCode | "invalid_snapshot_input", message: string) {
        super(message);
        this.name = "ReplaySnapshotBuilderError";
        this.code = code;
    }
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
        throw new ReplaySnapshotBuilderError("invalid_snapshot_input", `${fieldName} must be a non-empty string.`);
    }
};

const convertToReplaySafeValue = (value: unknown, path: string): ReplaySafeValue => {
    if (value === null) {
        return null;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (typeof value === "string" || typeof value === "boolean") {
        return value;
    }

    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new ReplaySnapshotBuilderError("invalid_replay_json", `${path} contains a non-finite number.`);
        }
        return value;
    }

    if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
        throw new ReplaySnapshotBuilderError("invalid_replay_json", `${path} contains a non-replay-safe value.`);
    }

    if (Array.isArray(value)) {
        return value.map((entry, index) => convertToReplaySafeValue(entry, `${path}[${index}]`));
    }

    if (!isPlainObject(value)) {
        throw new ReplaySnapshotBuilderError("invalid_replay_json", `${path} contains a non-plain object.`);
    }

    return Object.keys(value).reduce<Record<string, ReplaySafeValue>>((accumulator, key) => {
        accumulator[key] = convertToReplaySafeValue(value[key], `${path}.${key}`);
        return accumulator;
    }, {});
};

export const toReplaySnapshotObject = (value: unknown, fieldName: string): Record<string, unknown> => {
    const replaySafe = convertToReplaySafeValue(value, fieldName);
    if (!isPlainObject(replaySafe)) {
        throw new ReplaySnapshotBuilderError("invalid_snapshot_input", `${fieldName} must serialize to a JSON object.`);
    }

    return JSON.parse(stableJsonSerialize(replaySafe)) as Record<string, unknown>;
};

export const validateBuilderBaseMetadata = (metadata: ReplayBuilderBaseMetadata): void => {
    ensureNonEmptyString(metadata.correlationId, "correlationId");
    ensureNonEmptyString(metadata.configVersion, "configVersion");
    ensureNonEmptyString(metadata.engineVersion, "engineVersion");

    if (!isPlainObject(metadata.featureFlags)) {
        throw new ReplaySnapshotBuilderError("invalid_snapshot_input", "featureFlags must be a plain object.");
    }
};

export const buildReplayEnvelope = (input: {
    decisionType: ReplayDecisionType;
    entityId: string;
    metadata: ReplayBuilderBaseMetadata;
    inputSnapshot: unknown;
    decisionTrace: unknown;
    outputSnapshot: unknown;
}): WriteReplayEnvelopeInput => {
    validateBuilderBaseMetadata(input.metadata);
    ensureNonEmptyString(input.entityId, "entityId");

    return {
        decisionType: input.decisionType,
        entityId: input.entityId,
        correlationId: input.metadata.correlationId,
        configVersion: input.metadata.configVersion,
        engineVersion: input.metadata.engineVersion,
        featureFlags: toReplaySnapshotObject(input.metadata.featureFlags, "featureFlags"),
        inputSnapshot: toReplaySnapshotObject(input.inputSnapshot, "inputSnapshot"),
        decisionTrace: toReplaySnapshotObject(input.decisionTrace, "decisionTrace"),
        outputSnapshot: toReplaySnapshotObject(input.outputSnapshot, "outputSnapshot")
    };
};
