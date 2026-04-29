import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { SchemaMapService } from "./schema-map-service.js";

export interface AdminSchemaMapRouteDeps {
  schemaMapService: SchemaMapService;
}

export const registerAdminSchemaMapRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminSchemaMapRouteDeps
): Promise<void> => {
  app.get("/admin/schema-map", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      return reply.send({ schemaMap: await deps.schemaMapService.buildSchemaMap() });
    } catch (error) {
      app.log.error({ err: error }, "Failed to build admin schema map.");
      return reply.status(500).send({ code: "ADMIN_SCHEMA_MAP_ERROR", message: "Failed to build schema map." });
    }
  });
};
