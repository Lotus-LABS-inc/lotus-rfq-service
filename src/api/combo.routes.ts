import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ComboRFQRequestSchema, LPComboQuoteSchema } from "../core/combo-engine/types.js";
import { IComboEngine } from "../core/combo-engine/combo-engine.js";

// Fastify integration logic
export const comboRoutes = (engine: IComboEngine): FastifyPluginAsync => async (server) => {

    /**
     * POST /combo-rfqs
     * Initializes a new multi-leg RFQ instance.
     */
    server.post("/combo-rfqs", async (request, reply) => {
        try {
            const req = ComboRFQRequestSchema.parse(request.body);
            // Simulate req.user context injection
            const session = await engine.createComboRFQ(req);

            return reply.status(201).send({ status: "CREATED", comboId: session.id, expiresAt: session.expiresAt });
        } catch (e: any) {
            return reply.status(400).send({ error: e.message });
        }
    });

    /**
     * GET /combo-rfqs/:id
     * Returns metadata.
     */
    server.get("/combo-rfqs/:id", async (request: any, reply) => {
        // Abstract representation. Typically reads directly from Postgres bypassing the engine Mutator
        return reply.status(200).send({ status: "OK", comboId: request.params.id });
    });

    /**
     * POST /combo-rfqs/:id/accept
     * Taker accepts the Combo RFQ.
     */
    server.post("/combo-rfqs/:id/accept", async (request: any, reply) => {
        try {
            const comboId = request.params.id;
            const quoteId = request.body.quoteId;

            // Trigger internal combo acceptance loop involving risk evaluation
            const result = await engine.acceptCombo(comboId, quoteId);

            if (result.kind === "internal_filled") {
                return reply.status(200).send({
                    status: "INTERNALLY_FILLED",
                    comboId: result.comboId,
                    nettedSize: result.nettedSize,
                    nettingGroupIds: result.nettingGroupIds
                });
            }

            if (result.kind === "internal_cleared") {
                return reply.status(200).send({
                    status: "INTERNALLY_CLEARED",
                    comboId: result.comboId,
                    clearingRoundId: result.clearingRoundId,
                    participantSetHash: result.participantSetHash,
                    matchSignatureHash: result.matchSignatureHash,
                    clearedParticipantCount: result.clearedParticipantCount
                });
            }

            return reply.status(200).send({
                status: "ACCEPTED",
                planId: result.plan.id,
                nettedSize: result.nettedSize,
                residualLegCount: result.residualLegCount
            });
        } catch (e: any) {
            return reply.status(400).send({ error: e.message });
        }
    });

    /**
     * POST /lp/:id/combo-quotes
     * Inbound entry point for LPs to submit quotes to a combo.
     */
    server.post("/lp/:id/combo-quotes", async (request: any, reply) => {
        try {
            const lpPayload = LPComboQuoteSchema.parse({
                ...request.body,
                lpId: request.params.id // Plumb URL id into payload schema natively
            });

            await engine.collectLPQuote(lpPayload);
            return reply.status(202).send({ status: "ACCEPTED" });
        } catch (e: any) {
            return reply.status(400).send({ error: e.message });
        }
    });

    /**
     * WS channel setup simulation for subscriber broadcasts.
     * Normally bound to @fastify/websocket parsing `ws://.../combo-rfqs/:id/stream`
     */
    server.get('/combo-rfqs/:id/stream', { websocket: true } as any, (connection: any, req: any) => {
        const comboId = req.params.id;

        // Listen to ComboEngine's global events, filter by comboId and dispatch to socket pipe.
        // In reality, this scales horizontally via Redis Pub/Sub channels `combo:${comboId}`
        const listener = (payload: any) => {
            if (payload.combo_id === comboId) {
                connection.socket.send(JSON.stringify(payload));
            }
        };

        // Attach listeners exactly per event format
        (engine as any).events.on("COMBO_STATE_UPDATE", listener);
        (engine as any).events.on("COMBO_QUOTE_UPDATE", listener);
        (engine as any).events.on("COMBO_EXECUTION_UPDATE", listener);

        connection.socket.on("close", () => {
            (engine as any).events.off("COMBO_STATE_UPDATE", listener);
            (engine as any).events.off("COMBO_QUOTE_UPDATE", listener);
            (engine as any).events.off("COMBO_EXECUTION_UPDATE", listener);
        });
    });

};
