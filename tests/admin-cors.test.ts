import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import { describe, expect, it } from "vitest";
import { buildAdminCorsOptions, parseAdminCorsOrigins } from "../src/api/admin-cors.js";

describe("admin CORS", () => {
  it("parses exact allowlist origins in production", () => {
    expect(parseAdminCorsOrigins("https://admin.lotus.example, http://localhost:5173 ", "production")).toEqual([
      "https://admin.lotus.example",
      "http://localhost:5173"
    ]);
  });

  it("merges local frontend origins into configured non-production origins", () => {
    expect(parseAdminCorsOrigins("https://admin.lotus.example", "development")).toEqual([
      "https://admin.lotus.example",
      "http://localhost:5173",
      "http://127.0.0.1:5173"
    ]);
  });

  it("defaults to local frontend origins outside production", () => {
    expect(parseAdminCorsOrigins(undefined, "development")).toEqual([
      "http://localhost:5173",
      "http://127.0.0.1:5173"
    ]);
    expect(parseAdminCorsOrigins(undefined, "test")).toEqual([
      "http://localhost:5173",
      "http://127.0.0.1:5173"
    ]);
  });

  it("does not default browser origins in production", () => {
    expect(parseAdminCorsOrigins(undefined, "production")).toEqual([]);
  });

  it("allows configured admin origins and rejects unknown browser origins", async () => {
    const app = Fastify({ logger: false });
    await app.register(fastifyCors, buildAdminCorsOptions(["https://admin.lotus.example"]));
    app.get("/admin/ping", async () => ({ ok: true }));

    const allowed = await app.inject({
      method: "OPTIONS",
      url: "/admin/ping",
      headers: {
        origin: "https://admin.lotus.example",
        "access-control-request-method": "GET"
      }
    });
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://admin.lotus.example");

    const denied = await app.inject({
      method: "OPTIONS",
      url: "/admin/ping",
      headers: {
        origin: "https://evil.example",
        "access-control-request-method": "GET"
      }
    });
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });
});
