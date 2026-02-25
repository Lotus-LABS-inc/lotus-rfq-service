import type { FastifyInstance } from "fastify";

export interface HealthResponse {
  status: "ok";
  service: "lotus-rfq-service";
}

export const registerHealthRoute = async (app: FastifyInstance): Promise<void> => {
  app.get<{ Reply: HealthResponse }>("/health", async () => ({
    status: "ok",
    service: "lotus-rfq-service"
  }));
};
