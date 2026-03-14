import type { FastifyInstance, preHandlerHookHandler } from "fastify";

import { renderSimulationConsolePage } from "./simulation-console.page.js";

export const registerAdminSimulationConsoleRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler
): Promise<void> => {
  app.get("/admin/simulation-console", { preHandler: adminMiddleware }, async (_request, reply) =>
    reply
      .type("text/html; charset=utf-8")
      .send(renderSimulationConsolePage())
  );
};
