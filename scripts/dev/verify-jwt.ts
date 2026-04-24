import { buildServer } from "../../src/api/server.js";
import pino from "pino";
import { randomUUID } from "node:crypto";

async function test() {
    const logger = pino({ level: "silent" });
    const jwtSecret = "1bec540fef68b7e4e3b09f75975c37dfc9f3dbdd79dfd1138bd81f50fa7";

    const redisClient: any = {
        duplicate: () => redisClient,
        on: () => redisClient,
        off: () => redisClient,
        connect: async () => undefined,
        quit: async () => "OK",
        publish: async () => 1,
        subscribe: async () => 1,
        unsubscribe: async () => 1,
        set: async () => "OK",
        get: async () => null,
        del: async () => 1,
        zadd: async () => 1,
        zrevrange: async () => []
    };

    const app = await buildServer({
        logger,
        redisClient,
        pgPool: {
            query: async () => ({ rows: [] }),
            on: () => { },
            connect: async () => ({ query: async () => ({ rows: [] }), release: () => { } })
        } as any,
        db: {} as any,
        canonicalServiceBaseUrl: "http://localhost:4001",
        jwtSecret
    });

    const token = app.jwt.sign({ userId: "test-user-123" });
    console.log("Generated Token:", token);

    const payload = {
        canonicalMarketId: randomUUID(),
        takerId: "test-taker",
        side: "buy",
        quantity: "1.5",
        idempotencyKey: randomUUID(),
        ttlSeconds: 60
    };

    console.log("\nTesting with valid token...");
    const validResponse = await app.inject({
        method: "POST",
        url: "/rfq",
        headers: {
            authorization: `Bearer ${token}`
        },
        payload
    });
    console.log("Status Code:", validResponse.statusCode);
    console.log("Body:", validResponse.body);

    console.log("\nTesting with NO token...");
    const noTokenResponse = await app.inject({
        method: "POST",
        url: "/rfq",
        payload
    });
    console.log("Status Code:", noTokenResponse.statusCode);
    console.log("Body:", noTokenResponse.body);

    await app.close();
}

test().catch(console.error);
