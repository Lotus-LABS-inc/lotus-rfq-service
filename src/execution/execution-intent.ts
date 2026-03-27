export interface ExecutionIntent {
    id: string;
    requestKey: string;
    routePlanId: string | null;
    routeSelectionTraceId: string | null;
    initiatingPrincipal: string;
    requestedAction: string;
    requestedNotional: string | null;
    requestedSize: string | null;
    routeType: string;
    approvalState: string;
    intendedVenues: readonly string[];
    compatibilityDecisionIds: readonly string[];
    compatibilityVersionIds: readonly string[];
    replayEnvelopeId: string | null;
    metadata: Readonly<Record<string, unknown>>;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateExecutionIntentInput {
    requestKey: string;
    routePlanId?: string | null;
    routeSelectionTraceId?: string | null;
    initiatingPrincipal: string;
    requestedAction: string;
    requestedNotional?: string | null;
    requestedSize?: string | null;
    routeType: string;
    approvalState: string;
    intendedVenues: readonly string[];
    compatibilityDecisionIds?: readonly string[];
    compatibilityVersionIds?: readonly string[];
    replayEnvelopeId?: string | null;
    metadata?: Readonly<Record<string, unknown>>;
}
