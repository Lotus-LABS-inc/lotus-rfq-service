import fastifyWebsocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";
import type { RedisClient } from "../db/redis.js";
import { RFQWebSocketGateway } from "./rfq-ws-gateway.js";

export interface WebSocketPluginDependencies {
  redisClient: RedisClient;
  logger: Pick<Logger, "warn" | "error">;
}

export const registerWebSocketPlugin = async (
  app: FastifyInstance,
  dependencies: WebSocketPluginDependencies
): Promise<RFQWebSocketGateway> => {
  await app.register(fastifyWebsocket);

  const subscriber = dependencies.redisClient.duplicate();
  const gateway = new RFQWebSocketGateway({
    publisher: dependencies.redisClient,
    subscriber,
    logger: dependencies.logger
  });

  await gateway.start();

  app.get("/ws", { websocket: true }, (connection) => {
    gateway.registerConnection(connection.socket);
  });

  app.addHook("onClose", async () => {
    await gateway.stop();
  });

  return gateway;
};
