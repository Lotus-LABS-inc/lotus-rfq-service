import type { Logger } from "pino";

import type { PredictEnvironment } from "./predict-types.js";

export interface PredictWsLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "close" | "error" | "message", listener: (event: any) => void): void;
}

export interface PredictWsClientConfig {
  url: string;
  environment: PredictEnvironment;
  webSocketFactory?: (url: string) => PredictWsLike;
  logger?: Pick<Logger, "info" | "warn" | "error">;
  heartbeatTimeoutMs?: number;
}

export interface PredictWsEnvelope {
  sequence: number;
  receivedAt: Date;
  payload: Record<string, unknown>;
}

const createDefaultWebSocket = (url: string): PredictWsLike => new WebSocket(url) as unknown as PredictWsLike;

export class PredictWsClient {
  private socket: PredictWsLike | null = null;
  private sequence = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly listeners = new Set<(envelope: PredictWsEnvelope) => void>();

  public constructor(private readonly config: PredictWsClientConfig) {}

  public onEnvelope(listener: (envelope: PredictWsEnvelope) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public connect(): void {
    if (this.socket !== null) {
      return;
    }
    const factory = this.config.webSocketFactory ?? createDefaultWebSocket;
    this.socket = factory(this.config.url);
    this.socket.addEventListener("open", () => {
      this.config.logger?.info({ environment: this.config.environment }, "Predict websocket connected.");
      this.refreshHeartbeat();
    });
    this.socket.addEventListener("message", (event) => {
      this.refreshHeartbeat();
      const payload = this.parsePayload(event?.data);
      if (payload === null) {
        return;
      }
      const envelope: PredictWsEnvelope = {
        sequence: ++this.sequence,
        receivedAt: new Date(),
        payload
      };
      for (const listener of this.listeners) {
        listener(envelope);
      }
    });
    this.socket.addEventListener("close", () => {
      this.clearHeartbeat();
      this.socket = null;
    });
  }

  public disconnect(): void {
    this.clearHeartbeat();
    this.socket?.close();
    this.socket = null;
  }

  public send(payload: Record<string, unknown>): void {
    if (this.socket === null) {
      throw new Error("Predict websocket is not connected.");
    }
    this.socket.send(JSON.stringify(payload));
  }

  public subscribe(topics: readonly string[], requestFactory: (topics: readonly string[]) => Record<string, unknown>): void {
    this.send(requestFactory(topics));
  }

  private parsePayload(raw: unknown): Record<string, unknown> | null {
    if (typeof raw !== "string") {
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
    } catch (error) {
      this.config.logger?.warn({ error }, "Predict websocket message was not valid JSON.");
      return null;
    }
  }

  private refreshHeartbeat(): void {
    this.clearHeartbeat();
    const timeoutMs = this.config.heartbeatTimeoutMs ?? 30_000;
    this.heartbeatTimer = setTimeout(() => {
      this.config.logger?.warn({ environment: this.config.environment }, "Predict websocket heartbeat timed out.");
      this.disconnect();
    }, timeoutMs);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
