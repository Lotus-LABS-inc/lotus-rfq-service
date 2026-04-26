import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  LimitlessWithdrawalEvidenceMalformedError,
  LimitlessWithdrawalEvidenceNotFoundError,
  LimitlessWithdrawalEvidenceReadNotConfiguredError,
  type InternalWithdrawalEvidenceReadService
} from "../../core/funding/limitless-withdrawal-evidence-read-service.js";
import type { FundingVenue } from "../../core/funding/types.js";
import { isWithdrawalEvidenceVenueSupported } from "../../core/funding/withdrawal-evidence.js";

const evidenceQuerySchema = z.object({
  userId: z.string().min(1),
  withdrawalIntentId: z.string().min(1),
  withdrawalRouteLegId: z.string().min(1),
  sourceVenue: z.string().min(1),
  withdrawalTxHash: z.string().min(1)
});

export interface InternalLimitlessWithdrawalEvidenceRouteConfig {
  bearerToken?: string | undefined;
  bearerTokenByVenue?: Partial<Record<FundingVenue, string | undefined>> | undefined;
  nodeEnv?: string | undefined;
}

const isLoopbackRequest = (request: FastifyRequest): boolean => {
  const hostHeader = typeof request.headers.host === "string" ? request.headers.host : "";
  const host = hostHeader.split(":")[0]?.toLowerCase() ?? "";
  return host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    request.ip === "127.0.0.1" ||
    request.ip === "::1" ||
    request.ip === "::ffff:127.0.0.1";
};

const authorizeInternalRead = (
  request: FastifyRequest,
  venue: FundingVenue,
  config: InternalLimitlessWithdrawalEvidenceRouteConfig
): boolean => {
  const token = (config.bearerTokenByVenue?.[venue] ?? config.bearerToken)?.trim();
  if (token) {
    const authorization = typeof request.headers.authorization === "string" ? request.headers.authorization : "";
    return authorization === `Bearer ${token}`;
  }
  if (config.nodeEnv === "production") {
    return false;
  }
  return isLoopbackRequest(request);
};

export const registerInternalLimitlessWithdrawalEvidenceRoute = async (
  app: FastifyInstance,
  service: InternalWithdrawalEvidenceReadService,
  config: InternalLimitlessWithdrawalEvidenceRouteConfig = {}
): Promise<void> => {
  app.get("/internal/funding/:venue/withdrawal-evidence", async (request, reply) => {
    const pathVenue = (request.params as { venue?: string }).venue?.toUpperCase();
    if (!pathVenue || !isWithdrawalEvidenceVenueSupported(pathVenue)) {
      return reply.status(404).send({
        code: "WITHDRAWAL_EVIDENCE_VENUE_NOT_SUPPORTED",
        message: "Internal withdrawal evidence venue is not supported."
      });
    }

    if (!authorizeInternalRead(request, pathVenue, config)) {
      return reply.status(401).send({
        code: "UNAUTHORIZED",
        message: `Internal ${pathVenue} withdrawal evidence read is not authorized.`
      });
    }

    const parsed = evidenceQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: `${pathVenue} withdrawal evidence request validation failed.`,
        details: parsed.error.flatten()
      });
    }

    const sourceVenue = parsed.data.sourceVenue.toUpperCase();
    if (sourceVenue !== pathVenue) {
      return reply.status(400).send({
        code: "WITHDRAWAL_EVIDENCE_VENUE_MISMATCH",
        message: "Withdrawal evidence path venue and source venue must match."
      });
    }

    try {
      const result = await service.readEvidence({
        ...parsed.data,
        sourceVenue: pathVenue
      });
      return reply.status(200).send(result);
    } catch (error) {
      return handleWithdrawalEvidenceReadError(pathVenue, error, reply);
    }
  });
};

const handleWithdrawalEvidenceReadError = (venue: FundingVenue, error: unknown, reply: FastifyReply) => {
  if (error instanceof LimitlessWithdrawalEvidenceReadNotConfiguredError) {
    return reply.status(503).send({
      code: `${venue}_WITHDRAWAL_EVIDENCE_READ_NOT_CONFIGURED`,
      message: `${venue} withdrawal evidence read is disabled or incomplete.`
    });
  }
  if (error instanceof LimitlessWithdrawalEvidenceNotFoundError) {
    return reply.status(404).send({
      code: `${venue}_WITHDRAWAL_EVIDENCE_NOT_FOUND`,
      message: `${venue} withdrawal evidence was not found.`
    });
  }
  if (error instanceof LimitlessWithdrawalEvidenceMalformedError) {
    return reply.status(502).send({
      code: `${venue}_WITHDRAWAL_EVIDENCE_MALFORMED`,
      message: `${venue} withdrawal evidence is malformed.`
    });
  }

  return reply.status(502).send({
    code: `${venue}_WITHDRAWAL_EVIDENCE_READ_UNAVAILABLE`,
    message: `${venue} withdrawal evidence read is unavailable.`
  });
};
