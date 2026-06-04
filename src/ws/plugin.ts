import fastifyWebsocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";
import type { RedisClient } from "../db/redis.js";
import { RFQWebSocketGateway, type RFQBroadcastEvent } from "./rfq-ws-gateway.js";

export interface WebSocketPluginDependencies {
  redisClient: RedisClient;
  logger: Pick<Logger, "warn" | "error">;
  onSubscribe?: ((input: {
    topic: string;
    send: (event: RFQBroadcastEvent) => void;
  }) => void | Promise<void>) | undefined;
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
    logger: dependencies.logger,
    ...(dependencies.onSubscribe ? { onSubscribe: dependencies.onSubscribe } : {})
  });

  await gateway.start();

  app.get("/ws", { websocket: true }, (socket) => {
    gateway.registerConnection(socket);
  });

  app.addHook("onClose", async () => {
    await gateway.stop();
  });

  return gateway;
};
