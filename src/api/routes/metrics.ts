import type { FastifyInstance } from "fastify";
import { metricsRegistry } from "../../observability/metrics.js";

export const registerMetricsRoute = async (app: FastifyInstance): Promise<void> => {
  app.get("/metrics", async (_request, reply) => {
    reply.header("Content-Type", metricsRegistry.contentType);
    return metricsRegistry.metrics();
  });
};
