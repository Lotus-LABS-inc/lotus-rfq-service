/**
 * combo-tracer.ts
 *
 * OpenTelemetry tracing instrumentation for the Combo RFQ Engine.
 *
 * Wraps the four key lifecycle operations with named spans:
 *   - combo.create         (createComboRFQ)
 *   - combo.rank           (quote normalization + ranking)
 *   - combo.build_plan     (ExecutionPlanBuilder.buildExecutionPlan)
 *   - combo.execute_plan   (per-leg step inside executePlan)
 *
 * The tracer gracefully falls back to a no-op when @opentelemetry/api is not
 * configured (e.g. in unit tests or environments with no OTEL collector).
 */

import { trace, context, SpanStatusCode, SpanKind, type Tracer, type Span, type Attributes } from "@opentelemetry/api";

// ─── Tracer Singleton ─────────────────────────────────────────────────────────

const COMBO_TRACER_NAME = "lotus.combo-engine";
const COMBO_TRACER_VERSION = "1.0.0";

function getTracer(): Tracer {
    return trace.getTracer(COMBO_TRACER_NAME, COMBO_TRACER_VERSION);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Executes `fn` inside a named span. Records any exception and re-throws it,
 * ensuring the span always ends regardless of success or failure.
 */
export async function withSpan<T>(
    spanName: string,
    attributes: Attributes,
    fn: (span: Span) => Promise<T>
): Promise<T> {
    const tracer = getTracer();
    const span = tracer.startSpan(spanName, {
        kind: SpanKind.INTERNAL,
        attributes
    });

    return context.with(trace.setSpan(context.active(), span), async () => {
        try {
            const result = await fn(span);
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
        } catch (err: any) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message ?? "unknown error" });
            span.recordException(err);
            throw err;
        } finally {
            span.end();
        }
    });
}

// ─── Named Span Wrappers ──────────────────────────────────────────────────────

/**
 * Wraps the combo.create lifecycle step.
 * @param takerId    The taker user ID.
 * @param numLegs    Number of legs in the request.
 * @param policy     Acceptance policy (ALL_OR_NONE | PARTIAL_ALLOWED | BEST_EFFORT).
 */
export function traceComboCreate<T>(
    takerId: string,
    numLegs: number,
    policy: string,
    fn: (span: Span) => Promise<T>
): Promise<T> {
    return withSpan("combo.create", {
        "combo.taker_id": takerId,
        "combo.num_legs": numLegs,
        "combo.acceptance_policy": policy,
    }, fn);
}

/**
 * Wraps the combo.rank lifecycle step (quote normalization + ranking).
 * @param comboId  The combo session ID.
 * @param lpId     LP quote provider ID.
 */
export function traceComboRank<T>(
    comboId: string,
    lpId: string,
    fn: (span: Span) => Promise<T>
): Promise<T> {
    return withSpan("combo.rank", {
        "combo.session_id": comboId,
        "combo.lp_id": lpId,
    }, fn);
}

/**
 * Wraps the combo.build_plan lifecycle step.
 * @param comboId          The combo session ID.
 * @param reservationToken The risk reservation token.
 * @param policy           Acceptance policy.
 */
export function traceCombosBuildPlan<T>(
    comboId: string,
    reservationToken: string,
    policy: string,
    fn: (span: Span) => Promise<T>
): Promise<T> {
    return withSpan("combo.build_plan", {
        "combo.session_id": comboId,
        "combo.reservation_token": reservationToken,
        "combo.acceptance_policy": policy,
    }, fn);
}

/**
 * Wraps a single leg execution step: combo.execute_plan.
 * One span is created per leg step to enable per-leg latency breakdown.
 * @param planId   The execution plan ID.
 * @param legId    The specific leg being executed.
 * @param lpId     The LP/connector being used.
 */
export function traceComboExecuteLeg<T>(
    planId: string,
    legId: string,
    lpId: string,
    fn: (span: Span) => Promise<T>
): Promise<T> {
    return withSpan("combo.execute_plan", {
        "combo.plan_id": planId,
        "combo.leg_id": legId,
        "combo.lp_id": lpId,
    }, fn);
}
