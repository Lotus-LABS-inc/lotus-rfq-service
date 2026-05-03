import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { ExecutionVenuesAdminService } from "./execution-venues-admin-service.js";

export interface AdminTradeReadinessRouteDeps {
  executionVenuesAdminService: ExecutionVenuesAdminService;
}

export const registerAdminTradeReadinessRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminTradeReadinessRouteDeps
): Promise<void> => {
  app.get("/admin/trade-readiness", { preHandler: adminMiddleware }, async (_request, reply) => {
    const venues = await deps.executionVenuesAdminService.listVenues();
    return reply.send({
      generatedAt: new Date().toISOString(),
      venues: venues.map((venue) => ({
        venue: venue.venue,
        quoteCoverage: venue.marketRoutingCoverage,
        buyReadiness: readinessLabel(venue),
        sellReadiness: readinessLabel(venue),
        fundingReadiness: "CHECK_FUNDING_READINESS_API",
        activationReadiness: "CHECK_VENUE_ACTIVATIONS_API",
        venueAccountReady: !venue.venueAccountRequired || venue.venueAccountConfigured,
        submitSupported: venue.liveSubmissionSupported,
        liveExecutionEnabled: venue.liveExecutionEnabled,
        settlementEvidenceReady: venue.operationalStatus === "STRUCTURALLY_READY",
        blocker: readinessBlocker(venue)
      }))
    });
  });

  app.get("/admin/execution-routes/:quoteId", { preHandler: adminMiddleware }, async (request, reply) => {
    const { quoteId } = request.params as { quoteId: string };
    return reply.send({
      quoteId,
      message: "Route diagnostics are stored with execution_route_quotes.rejected_candidates for persisted quotes.",
      diagnosticsSource: "execution_route_quotes"
    });
  });

  app.get("/admin/execution-recovery", { preHandler: adminMiddleware }, async (_request, reply) => {
    return reply.send({
      generatedAt: new Date().toISOString(),
      recoveryCases: [],
      message: "Execution recovery case storage is available via execution_recovery_cases; no active case reader is configured in this route yet."
    });
  });
};

const readinessLabel = (venue: Awaited<ReturnType<ExecutionVenuesAdminService["listVenues"]>>[number]): string => {
  if (venue.operationalStatus === "STRUCTURALLY_READY" && venue.liveSubmissionSupported && venue.liveExecutionEnabled) {
    return venue.executionSigningModel.includes("USER_SIGNED") ? "USER_SIGNATURE_REQUIRED" : "EXECUTION_READY";
  }
  if (venue.venueAccountRequired && !venue.venueAccountConfigured) {
    return "BLOCKED";
  }
  if (!venue.liveSubmissionSupported) {
    return "QUOTE_ONLY";
  }
  if (!venue.liveExecutionEnabled) {
    return "BLOCKED";
  }
  return "BLOCKED";
};

const readinessBlocker = (venue: Awaited<ReturnType<ExecutionVenuesAdminService["listVenues"]>>[number]): string | null => {
  if (venue.venueAccountRequired && !venue.venueAccountConfigured) {
    return venue.accountSetupBlockers.join("; ") || "Venue account is not configured.";
  }
  if (venue.operationalStatus !== "STRUCTURALLY_READY") {
    return venue.operatorMessage;
  }
  return null;
};
