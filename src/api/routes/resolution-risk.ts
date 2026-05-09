import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { NormalizedResolutionProfile, ResolutionRiskAssessment } from "../../core/rfq-engine/resolution-risk.types.js";
import { ResolutionRiskPresentationFormatter } from "../../core/rfq-engine/resolution-risk-presentation.js";

const canonicalEventParamsSchema = z.object({
  eventId: z.string().uuid()
});

const pairQuerySchema = z.object({
  profileAId: z.string().uuid(),
  profileBId: z.string().uuid()
});

const marketParamsSchema = z.object({
  venue: z.string().min(1),
  marketId: z.string().min(1)
});

const ResolutionRiskPresentationResponseSchema = z.object({
  label: z.string().min(1),
  riskScore: z.string(),
  confidenceScore: z.string(),
  equivalenceClass: z.enum(["SAFE_EQUIVALENT", "EQUIVALENT_WITH_LAG", "CAUTION", "HIGH_RISK", "DO_NOT_POOL"]),
  shortReasons: z.array(z.string()),
  factorBreakdown: z.record(z.string(), z.unknown()),
  recommendedAction: z.enum(["Poolable", "Pool with caution", "Pool with caution (lag)", "Isolate execution", "Do not pool"])
});

const ResolutionProfileResponseSchema = z.object({
  id: z.string().uuid(),
  venue: z.string().min(1),
  venueMarketId: z.string().min(1),
  canonicalEventId: z.string().uuid(),
  canonicalMarketId: z.string().min(1),
  oracleType: z.string().nullable().optional(),
  oracleName: z.string().nullable().optional(),
  resolutionAuthorityType: z.string().nullable().optional(),
  primaryResolutionText: z.string().nullable().optional(),
  supplementalRulesText: z.string().nullable().optional(),
  disputeWindowHours: z.string().nullable().optional(),
  settlementLagHours: z.string().nullable().optional(),
  marketType: z.string().nullable().optional(),
  outcomeSchema: z.record(z.string(), z.unknown()).nullable().optional(),
  hasAmbiguousTimeBoundary: z.boolean(),
  hasAmbiguousJurisdictionBoundary: z.boolean(),
  hasAmbiguousSourceReference: z.boolean(),
  historicalDivergenceRate: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

const ResolutionRiskAssessmentListResponseSchema = z.object({
  canonicalEventId: z.string().uuid(),
  assessmentCount: z.number().int().min(0),
  assessments: z.array(ResolutionRiskPresentationResponseSchema)
});

const ResolutionRiskPairResponseSchema = z.object({
  assessment: ResolutionRiskPresentationResponseSchema
});

const ResolutionRiskMarketResponseSchema = z.object({
  profile: ResolutionProfileResponseSchema,
  assessmentCount: z.number().int().min(0),
  assessments: z.array(ResolutionRiskPresentationResponseSchema)
});

type CanonicalEventParams = z.infer<typeof canonicalEventParamsSchema>;
type PairQuery = z.infer<typeof pairQuerySchema>;
type MarketParams = z.infer<typeof marketParamsSchema>;

type ResolutionRiskErrorCode =
  | "profile_not_found"
  | "cross_event_pair_not_allowed"
  | "invalid_pair_ordering";

export interface ResolutionRiskRouteHandlers {
  buildAssessmentsForCanonicalEvent(canonicalEventId: string): Promise<readonly ResolutionRiskAssessment[]>;
  comparePair(profileAId: string, profileBId: string): Promise<ResolutionRiskAssessment>;
  resolveProfileByVenueMarket(venue: string, marketId: string): Promise<NormalizedResolutionProfile | null>;
}

export const registerResolutionRiskRoutes = async (
  app: FastifyInstance,
  handlers: ResolutionRiskRouteHandlers
): Promise<void> => {
  const formatter = new ResolutionRiskPresentationFormatter();

  app.get("/resolution-risk/canonical/:eventId", async (request, reply) => {
    const parsed = canonicalEventParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Resolution risk canonical-event request validation failed.",
        details: parsed.error.flatten()
      });
    }

    const { eventId } = parsed.data as CanonicalEventParams;

    try {
      const assessments = await handlers.buildAssessmentsForCanonicalEvent(eventId);
      const response = ResolutionRiskAssessmentListResponseSchema.parse({
        canonicalEventId: eventId,
        assessmentCount: assessments.length,
        assessments: formatter.formatMany(assessments)
      });

      return reply.status(200).send(response);
    } catch (error) {
      app.log.error({ err: error, eventId }, "Resolution risk canonical-event request failed.");
      return sendResolutionRiskError(reply, error);
    }
  });

  app.get("/resolution-risk/pair", async (request, reply) => {
    const parsed = pairQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Resolution risk pair request validation failed.",
        details: parsed.error.flatten()
      });
    }

    const { profileAId, profileBId } = parsed.data as PairQuery;

    try {
      const assessment = await handlers.comparePair(profileAId, profileBId);
      const response = ResolutionRiskPairResponseSchema.parse({
        assessment: formatter.format(assessment)
      });

      return reply.status(200).send(response);
    } catch (error) {
      app.log.error({ err: error, profileAId, profileBId }, "Resolution risk pair request failed.");
      return sendResolutionRiskError(reply, error);
    }
  });

  app.get("/resolution-risk/market/:venue/:marketId", async (request, reply) => {
    const parsed = marketParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Resolution risk market request validation failed.",
        details: parsed.error.flatten()
      });
    }

    const { venue, marketId } = parsed.data as MarketParams;

    try {
      const profile = await handlers.resolveProfileByVenueMarket(venue, marketId);
      if (!profile) {
        return reply.status(404).send({
          code: "PROFILE_NOT_FOUND",
          message: "Resolution profile not found for venue market."
        });
      }

      const assessments = await handlers.buildAssessmentsForCanonicalEvent(profile.canonicalEventId);
      const relatedAssessments = assessments.filter(
        (assessment) =>
          assessment.marketAProfileId === profile.id || assessment.marketBProfileId === profile.id
      );

      const response = ResolutionRiskMarketResponseSchema.parse({
        profile: toProfileResponse(profile),
        assessmentCount: relatedAssessments.length,
        assessments: formatter.formatMany(relatedAssessments)
      });

      return reply.status(200).send(response);
    } catch (error) {
      app.log.error({ err: error, venue, marketId }, "Resolution risk market request failed.");
      return sendResolutionRiskError(reply, error);
    }
  });
};

const toProfileResponse = (profile: NormalizedResolutionProfile) =>
  ResolutionProfileResponseSchema.parse({
    ...profile,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString()
  });

const getResolutionRiskErrorCode = (error: unknown): ResolutionRiskErrorCode | null => {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  if (
    code === "profile_not_found" ||
    code === "cross_event_pair_not_allowed" ||
    code === "invalid_pair_ordering"
  ) {
    return code;
  }

  return null;
};

const sendResolutionRiskError = (
  reply: {
    status(code: number): { send(payload: unknown): unknown };
  },
  error: unknown
) => {
  const code = getResolutionRiskErrorCode(error);

  if (code === "profile_not_found") {
    return reply.status(404).send({
      code: "PROFILE_NOT_FOUND",
      message: "Resolution profile not found."
    });
  }

  if (code === "cross_event_pair_not_allowed") {
    return reply.status(409).send({
      code: "CROSS_EVENT_PAIR_NOT_ALLOWED",
      message: "Resolution risk comparisons require profiles from the same canonical event."
    });
  }

  if (code === "invalid_pair_ordering") {
    return reply.status(400).send({
      code: "INVALID_REQUEST",
      message: "Resolution risk pair request validation failed."
    });
  }

  return reply.status(500).send({
    code: "RESOLUTION_RISK_ERROR",
    message: "Resolution risk request failed."
  });
};
