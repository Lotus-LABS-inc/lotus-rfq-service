export class ReplayEvaluationError extends Error {
    public readonly code: "invalid_replay_envelope" | "replay_execution_failed";

    public constructor(code: "invalid_replay_envelope" | "replay_execution_failed", message: string) {
        super(message);
        this.name = "ReplayEvaluationError";
        this.code = code;
    }
}

export const asObject = (value: unknown, fieldName: string): Record<string, unknown> => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new ReplayEvaluationError("invalid_replay_envelope", `${fieldName} must be a JSON object.`);
    }

    return value as Record<string, unknown>;
};

export const asArray = (value: unknown, fieldName: string): unknown[] => {
    if (!Array.isArray(value)) {
        throw new ReplayEvaluationError("invalid_replay_envelope", `${fieldName} must be an array.`);
    }

    return value;
};

export const asString = (value: unknown, fieldName: string): string => {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new ReplayEvaluationError("invalid_replay_envelope", `${fieldName} must be a non-empty string.`);
    }

    return value;
};

export const asOptionalString = (value: unknown, fieldName: string): string | null => {
    if (value === undefined || value === null) {
        return null;
    }
    return asString(value, fieldName);
};

export const asNumber = (value: unknown, fieldName: string): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ReplayEvaluationError("invalid_replay_envelope", `${fieldName} must be a finite number.`);
    }

    return value;
};

export const cloneJson = <T>(value: T): T =>
    JSON.parse(JSON.stringify(value)) as T;
