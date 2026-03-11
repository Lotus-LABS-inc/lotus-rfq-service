import Fastify from "fastify";
import websocketPlugin from "@fastify/websocket";
import { describe, expect, it, vi } from "vitest";

import { comboRoutes } from "../src/api/combo.routes.js";

describe("comboRoutes", () => {
  it("returns internally cleared response for Phase 2B full clearing", async () => {
    const app = Fastify();
    await app.register(websocketPlugin);

    const engine = {
      createComboRFQ: vi.fn(),
      collectLPQuote: vi.fn(),
      acceptCombo: vi.fn().mockResolvedValue({
        kind: "internal_cleared" as const,
        comboId: "combo-1",
        clearingRoundId: "round-1",
        participantSetHash: "set-hash",
        matchSignatureHash: "sig-hash",
        clearedParticipantCount: 3
      }),
      events: {
        on: vi.fn(),
        off: vi.fn()
      }
    };

    await app.register(comboRoutes(engine as never));

    const response = await app.inject({
      method: "POST",
      url: "/combo-rfqs/combo-1/accept",
      payload: { quoteId: "quote-1" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "INTERNALLY_CLEARED",
      comboId: "combo-1",
      clearingRoundId: "round-1",
      participantSetHash: "set-hash",
      matchSignatureHash: "sig-hash",
      clearedParticipantCount: 3
    });
  });
});
