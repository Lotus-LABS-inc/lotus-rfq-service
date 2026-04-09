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
  private isOpen = false;
  private sequence = 0;
  private requestId = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly listeners = new Set<(envelope: PredictWsEnvelope) => void>();
  private readonly pendingPayloads: string[] = [];
  private openPromise: Promise<void> | null = null;
  private resolveOpen: (() => void) | null = null;
  private rejectOpen: ((error: Error) => void) | null = null;

  public constructor(private readonly config: PredictWsClientConfig) {}

  public onEnvelope(listener: (envelope: PredictWsEnvelope) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public connect(): void {
    if (this.socket !== null) {
      return;
    }
    this.openPromise = new Promise<void>((resolve, reject) => {
      this.resolveOpen = resolve;
      this.rejectOpen = reject;
    });
    const factory = this.config.webSocketFactory ?? createDefaultWebSocket;
    this.socket = factory(this.config.url);
    this.socket.addEventListener("open", () => {
      this.isOpen = true;
       this.resolveOpen?.();
       this.resolveOpen = null;
       this.rejectOpen = null;
      this.config.logger?.info({ environment: this.config.environment }, "Predict websocket connected.");
      this.refreshHeartbeat();
      while (this.pendingPayloads.length > 0) {
        this.socket?.send(this.pendingPayloads.shift()!);
      }
    });
    this.socket.addEventListener("message", (event) => {
      this.refreshHeartbeat();
      const payload = this.parsePayload(event?.data);
      if (payload === null) {
        return;
      }
      if (payload.type === "M" && payload.topic === "heartbeat" && "data" in payload) {
        this.respondToHeartbeat(payload.data);
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
      this.isOpen = false;
      if (this.rejectOpen) {
        this.rejectOpen(new Error("Predict websocket closed before opening."));
      }
      this.resolveOpen = null;
      this.rejectOpen = null;
      this.openPromise = null;
      this.socket = null;
    });
    this.socket.addEventListener("error", (event) => {
      const error = event instanceof Error ? event : new Error("Predict websocket connection failed.");
      if (this.rejectOpen) {
        this.rejectOpen(error);
      }
      this.resolveOpen = null;
      this.rejectOpen = null;
    });
  }

  public disconnect(): void {
    this.clearHeartbeat();
    this.isOpen = false;
    this.pendingPayloads.length = 0;
    if (this.rejectOpen) {
      this.rejectOpen(new Error("Predict websocket disconnected before opening."));
    }
    this.resolveOpen = null;
    this.rejectOpen = null;
    this.openPromise = null;
    this.socket?.close();
    this.socket = null;
  }

  public async waitForOpen(): Promise<void> {
    if (this.isOpen) {
      return;
    }
    if (this.openPromise === null) {
      throw new Error("Predict websocket has not been connected.");
    }
    await this.openPromise;
  }

  public send(payload: Record<string, unknown>): void {
    if (this.socket === null) {
      throw new Error("Predict websocket is not connected.");
    }
    const serialized = JSON.stringify(payload);
    if (!this.isOpen) {
      this.pendingPayloads.push(serialized);
      return;
    }
    this.socket.send(serialized);
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

  public nextRequestId(): number {
    this.requestId += 1;
    return this.requestId;
  }

  private respondToHeartbeat(timestamp: unknown): void {
    try {
      this.send({
        method: "heartbeat",
        data: timestamp
      });
    } catch (error) {
      this.config.logger?.warn?.({ err: error }, "Failed to respond to Predict websocket heartbeat.");
    }
  }
}
