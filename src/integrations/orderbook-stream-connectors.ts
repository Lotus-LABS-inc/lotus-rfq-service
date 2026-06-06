import {
  WebSocketClient as LimitlessWebSocketClient,
  DEFAULT_WS_URL as LIMITLESS_DEFAULT_WS_URL
} from "@limitless-exchange/sdk";
import { WebSocketClient as OpinionWebSocketClient } from "@opinion-labs/opinion-clob-sdk";
import type { Logger } from "pino";
import type { NormalizedVenueQuoteSnapshot } from "../core/sor/quote-snapshot.js";
import {
  DEFAULT_POLYMARKET_MARKET_WS_URL,
  LimitlessOrderbookStreamAdapter,
  OpinionOrderbookStreamAdapter,
  PolymarketOrderbookStreamAdapter,
  PredictOrderbookStreamAdapter,
  type VenueOrderbookStreamAdapter
} from "./orderbook-stream-normalizers.js";
import { PredictWsClient, type PredictWsLike } from "./predict/predict-ws-client.js";
import type { PredictEnvironment } from "./predict/predict-types.js";
import {
  subscriptionKey,
  type VenueOrderbookStreamConnector,
  type VenueOrderbookSubscriptionTarget
} from "../services/orderbook-stream.service.js";

export interface WsLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "close" | "error" | "message", listener: (event: { data?: unknown }) => void): void;
}

export interface JsonVenueWebSocketConnectorConfig {
  venue: string;
  url: string;
  adapter: VenueOrderbookStreamAdapter;
  logger?: Pick<Logger, "info" | "warn"> | undefined;
  webSocketFactory?: (url: string) => WsLike;
  subscribePayload: (targets: readonly VenueOrderbookSubscriptionTarget[]) => Record<string, unknown>;
  unsubscribePayload?: ((targets: readonly VenueOrderbookSubscriptionTarget[]) => Record<string, unknown>) | undefined;
  matchTargets: (payload: Record<string, unknown>, targets: readonly VenueOrderbookSubscriptionTarget[]) => readonly VenueOrderbookSubscriptionTarget[];
}

type SnapshotListener = (snapshot: NormalizedVenueQuoteSnapshot, target: VenueOrderbookSubscriptionTarget) => void;

const SOCKET_OPEN = 1;

export class JsonVenueWebSocketConnector implements VenueOrderbookStreamConnector {
  public readonly venue: string;
  private socket: WsLike | null = null;
  private readonly targets = new Map<string, VenueOrderbookSubscriptionTarget>();
  private listener: SnapshotListener | null = null;

  public constructor(private readonly config: JsonVenueWebSocketConnectorConfig) {
    this.venue = normalizeVenue(config.venue);
  }

  public async subscribe(
    targets: readonly VenueOrderbookSubscriptionTarget[],
    onSnapshot: SnapshotListener
  ): Promise<void> {
    this.listener = onSnapshot;
    const newTargets = targets.filter((target) => !this.targets.has(subscriptionKey(target)));
    for (const target of newTargets) {
      this.targets.set(subscriptionKey(target), target);
    }
    if (newTargets.length === 0 && this.socket !== null) {
      return;
    }
    this.connect();
    this.send(this.config.subscribePayload(newTargets.length > 0 ? newTargets : [...this.targets.values()]));
  }

  public async unsubscribe(keys: readonly string[]): Promise<void> {
    const removed = keys.flatMap((key) => {
      const target = this.targets.get(key);
      this.targets.delete(key);
      return target ? [target] : [];
    });
    if (removed.length === 0) {
      return;
    }
    if (this.config.unsubscribePayload) {
      this.send(this.config.unsubscribePayload(removed));
    }
    if (this.targets.size === 0) {
      await this.disconnect();
    }
  }

  public async disconnect(): Promise<void> {
    this.socket?.close(1000, "Lotus stream service shutdown");
    this.socket = null;
    this.targets.clear();
  }

  private connect(): void {
    if (this.socket !== null) {
      return;
    }
    const factory = this.config.webSocketFactory ?? createDefaultWebSocket;
    const socket = factory(this.config.url);
    this.socket = socket;
    socket.addEventListener("open", () => {
      this.config.logger?.info?.({ venue: this.venue }, "Venue orderbook websocket connected.");
      if (this.targets.size > 0) {
        this.send(this.config.subscribePayload([...this.targets.values()]));
      }
    });
    socket.addEventListener("message", (event) => {
      this.onMessage(event.data);
    });
    socket.addEventListener("close", () => {
      this.socket = null;
      this.config.logger?.warn?.({ venue: this.venue }, "Venue orderbook websocket closed.");
    });
    socket.addEventListener("error", () => {
      this.config.logger?.warn?.({ venue: this.venue }, "Venue orderbook websocket error.");
    });
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(payload));
  }

  private onMessage(raw: unknown): void {
    const messages = parseJsonMessages(raw);
    for (const message of messages) {
      const matchedTargets = this.config.matchTargets(message, [...this.targets.values()]);
      for (const target of matchedTargets) {
        const snapshot = this.config.adapter.normalize({
          venueMarketId: target.venueMarketId,
          ...(target.venueOutcomeId ? { venueOutcomeId: target.venueOutcomeId } : {}),
          ...(target.canonicalOutcomeId ? { canonicalOutcomeId: target.canonicalOutcomeId } : {}),
          payload: message,
          receivedAt: new Date()
        });
        if (snapshot) {
          this.listener?.(snapshot, target);
        }
      }
    }
  }
}

export const createPolymarketOrderbookConnector = (input: {
  logger?: Pick<Logger, "info" | "warn"> | undefined;
  url?: string | undefined;
  webSocketFactory?: (url: string) => WsLike;
} = {}): JsonVenueWebSocketConnector =>
  new JsonVenueWebSocketConnector({
    venue: "POLYMARKET",
    url: input.url ?? DEFAULT_POLYMARKET_MARKET_WS_URL,
    adapter: new PolymarketOrderbookStreamAdapter(),
    logger: input.logger,
    ...(input.webSocketFactory ? { webSocketFactory: input.webSocketFactory } : {}),
    subscribePayload: (targets) => ({
      type: "market",
      assets_ids: [...new Set(targets.flatMap((target) => target.venueOutcomeId ? [target.venueOutcomeId] : []))]
    }),
    matchTargets: matchByVenueOutcomeOrSingle
  });

export class LimitlessSdkOrderbookConnector implements VenueOrderbookStreamConnector {
  public readonly venue = "LIMITLESS";
  private readonly client: LimitlessWebSocketClient;
  private readonly targets = new Map<string, VenueOrderbookSubscriptionTarget>();
  private listener: SnapshotListener | null = null;
  private connected = false;
  private readonly adapter = new LimitlessOrderbookStreamAdapter();

  public constructor(private readonly config: {
    logger?: Pick<Logger, "warn"> | undefined;
    wsUrl?: string | undefined;
  } = {}) {
    this.client = new LimitlessWebSocketClient({ url: config.wsUrl ?? LIMITLESS_DEFAULT_WS_URL, autoReconnect: true });
    const onMethod = this.client.on.bind(this.client) as unknown as (event: string, handler: (payload: unknown) => void) => void;
    onMethod("orderbookUpdate", (payload) => this.onPayload(payload));
    onMethod("orderbook", (payload) => this.onPayload(payload));
    // On reconnect the socket.io transport re-establishes but does NOT replay subscriptions.
    // Re-send all active subscriptions whenever the connect event fires while we already
    // hold active targets (initial connect has connected=false so the guard skips it).
    onMethod("connect", () => {
      if (this.connected && this.targets.size > 0) {
        void this.client.subscribe("orderbook", {
          marketSlugs: [...new Set([...this.targets.values()].map((t) => t.venueMarketId))]
        }).catch(() => {});
        config.logger?.warn?.({ venue: "LIMITLESS", targetCount: this.targets.size }, "Limitless websocket reconnected; resubscribed all targets.");
      }
    });
  }

  public async subscribe(targets: readonly VenueOrderbookSubscriptionTarget[], onSnapshot: SnapshotListener): Promise<void> {
    this.listener = onSnapshot;
    const newTargets = targets.filter((target) => !this.targets.has(subscriptionKey(target)));
    for (const target of newTargets) {
      this.targets.set(subscriptionKey(target), target);
    }
    if (newTargets.length === 0 && this.connected) {
      return;
    }
    await this.connect();
    await this.client.subscribe("orderbook", {
      marketSlugs: [...new Set((newTargets.length > 0 ? newTargets : [...this.targets.values()]).map((target) => target.venueMarketId))]
    });
  }

  public async unsubscribe(keys: readonly string[]): Promise<void> {
    const removed = keys.flatMap((key) => {
      const target = this.targets.get(key);
      this.targets.delete(key);
      return target ? [target] : [];
    });
    if (removed.length === 0 || !this.connected) {
      return;
    }
    // Fire-and-forget: the Limitless socket.io server does not acknowledge unsubscribe
    // messages, so awaiting causes a timeout on every tick and prevents stale subscription
    // keys from being cleaned up locally. The local targets map is already updated above;
    // the server-side cleanup is best-effort.
    void this.client.unsubscribe("orderbook", {
      marketSlugs: [...new Set(removed.map((target) => target.venueMarketId))]
    }).catch(() => {});
    if (this.targets.size === 0) {
      await this.disconnect();
    }
  }

  public async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }
    await this.client.disconnect();
    this.connected = false;
    this.targets.clear();
  }

  private async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    await this.client.connect();
    this.connected = true;
  }

  private onPayload(payload: unknown): void {
    const messages = parseJsonMessages(payload);
    for (const message of messages) {
      for (const target of matchByMarketId(message, [...this.targets.values()])) {
        const snapshot = this.adapter.normalize({
          venueMarketId: target.venueMarketId,
          ...(target.venueOutcomeId ? { venueOutcomeId: target.venueOutcomeId } : {}),
          ...(target.canonicalOutcomeId ? { canonicalOutcomeId: target.canonicalOutcomeId } : {}),
          payload: message,
          receivedAt: new Date()
        });
        if (snapshot) {
          this.listener?.(snapshot, target);
        }
      }
    }
  }
}

export class OpinionSdkOrderbookConnector implements VenueOrderbookStreamConnector {
  public readonly venue = "OPINION";
  private readonly client: OpinionWebSocketClient;
  private readonly targets = new Map<string, VenueOrderbookSubscriptionTarget>();
  private listener: SnapshotListener | null = null;
  private connected = false;
  private readonly adapter = new OpinionOrderbookStreamAdapter();

  public constructor(private readonly config: {
    apiKey: string;
    walletAddress: string;
    wsUrl?: string | undefined;
    logger?: Pick<Logger, "warn"> | undefined;
  }) {
    this.client = new OpinionWebSocketClient({
      apiKey: config.apiKey,
      walletAddress: config.walletAddress,
      ...(config.wsUrl ? { wsUrl: config.wsUrl } : {}),
      onError: (error) => config.logger?.warn?.({ err: error }, "Opinion orderbook websocket error.")
    });
  }

  public async subscribe(targets: readonly VenueOrderbookSubscriptionTarget[], onSnapshot: SnapshotListener): Promise<void> {
    this.listener = onSnapshot;
    const wasConnected = this.connected;
    await this.connect();
    const subscribeTargets = targets.filter((target) => !this.targets.has(subscriptionKey(target)) || !wasConnected);
    for (const target of subscribeTargets) {
      const key = subscriptionKey(target);
      if (this.targets.has(key) && wasConnected) {
        continue;
      }
      const marketId = Number(target.venueMarketId);
      if (!Number.isInteger(marketId)) {
        continue;
      }
      this.targets.set(key, target);
      this.client.subscribeMarketDepthDiff(marketId, (payload) => this.onPayload(payload, target));
    }
  }

  public async unsubscribe(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      const target = this.targets.get(key);
      this.targets.delete(key);
      const marketId = Number(target?.venueMarketId);
      if (Number.isInteger(marketId) && this.connected) {
        this.client.unsubscribeMarketDepthDiff(marketId);
      }
    }
    if (this.targets.size === 0) {
      await this.disconnect();
    }
  }

  public async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }
    this.client.close();
    this.connected = false;
    this.targets.clear();
  }

  private async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    await this.client.connect();
    this.connected = true;
  }

  private onPayload(payload: unknown, target: VenueOrderbookSubscriptionTarget): void {
    const snapshot = this.adapter.normalize({
      venueMarketId: target.venueMarketId,
      ...(target.venueOutcomeId ? { venueOutcomeId: target.venueOutcomeId } : {}),
      ...(target.canonicalOutcomeId ? { canonicalOutcomeId: target.canonicalOutcomeId } : {}),
      payload,
      receivedAt: new Date()
    });
    if (snapshot) {
      this.listener?.(snapshot, target);
    }
  }
}

export class PredictWebSocketOrderbookConnector implements VenueOrderbookStreamConnector {
  public readonly venue = "PREDICT_FUN";
  private readonly client: PredictWsClient;
  private readonly targets = new Map<string, VenueOrderbookSubscriptionTarget>();
  private listener: SnapshotListener | null = null;
  private readonly adapter: PredictOrderbookStreamAdapter;

  public constructor(private readonly config: {
    url: string;
    environment: PredictEnvironment;
    webSocketFactory?: (url: string) => PredictWsLike;
    logger?: Pick<Logger, "info" | "warn" | "error"> | undefined;
  }) {
    this.adapter = new PredictOrderbookStreamAdapter(config.environment);
    this.client = new PredictWsClient({
      url: config.url,
      environment: config.environment,
      ...(config.webSocketFactory ? { webSocketFactory: config.webSocketFactory } : {}),
      ...(config.logger ? { logger: config.logger } : {})
    });
    this.client.onEnvelope((envelope) => this.onPayload(envelope.payload, envelope.receivedAt));
  }

  public async subscribe(targets: readonly VenueOrderbookSubscriptionTarget[], onSnapshot: SnapshotListener): Promise<void> {
    this.listener = onSnapshot;
    const newTargets = targets.filter((target) => !this.targets.has(subscriptionKey(target)));
    for (const target of newTargets) {
      this.targets.set(subscriptionKey(target), target);
    }
    if (newTargets.length === 0 && this.targets.size > 0) {
      this.client.connect();
      this.client.subscribe(
        [...new Set([...this.targets.values()].map((target) => target.venueMarketId))],
        (topics) => ({
          method: "subscribe",
          topic: "orderbook",
          topics,
          requestId: this.client.nextRequestId()
        })
      );
      return;
    }
    this.client.connect();
    this.client.subscribe(
      [...new Set(newTargets.map((target) => target.venueMarketId))],
      (topics) => ({
        method: "subscribe",
        topic: "orderbook",
        topics,
        requestId: this.client.nextRequestId()
      })
    );
  }

  public async unsubscribe(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      this.targets.delete(key);
    }
    if (this.targets.size === 0) {
      await this.disconnect();
    }
  }

  public async disconnect(): Promise<void> {
    this.client.disconnect();
    this.targets.clear();
  }

  private onPayload(payload: unknown, receivedAt: Date): void {
    const messages = parseJsonMessages(payload);
    for (const message of messages) {
      for (const target of matchByMarketId(message, [...this.targets.values()])) {
        const snapshot = this.adapter.normalize({
          venueMarketId: target.venueMarketId,
          ...(target.venueOutcomeId ? { venueOutcomeId: target.venueOutcomeId } : {}),
          ...(target.canonicalOutcomeId ? { canonicalOutcomeId: target.canonicalOutcomeId } : {}),
          payload: message,
          receivedAt
        });
        if (snapshot) {
          this.listener?.(snapshot, target);
        }
      }
    }
  }
}

const createDefaultWebSocket = (url: string): WsLike => new WebSocket(url) as unknown as WsLike;

const parseJsonMessages = (raw: unknown): readonly Record<string, unknown>[] => {
  const parsed = typeof raw === "string"
    ? parseJson(raw)
    : raw instanceof Buffer
      ? parseJson(raw.toString("utf8"))
      : raw;
  if (Array.isArray(parsed)) {
    return parsed
      .map((entry) => asRecord(entry))
      .filter((entry) => Object.keys(entry).length > 0);
  }
  return [asRecord(parsed)].filter((entry) => Object.keys(entry).length > 0);
};

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

const matchByVenueOutcomeOrSingle = (
  payload: Record<string, unknown>,
  targets: readonly VenueOrderbookSubscriptionTarget[]
): readonly VenueOrderbookSubscriptionTarget[] => {
  if (targets.length === 1) {
    return targets;
  }
  const token = firstString(payload.asset_id, payload.assetId, payload.token_id, payload.tokenId, payload.venueOutcomeId);
  return token
    ? targets.filter((target) => target.venueOutcomeId === token)
    : [];
};

const matchByMarketId = (
  payload: Record<string, unknown>,
  targets: readonly VenueOrderbookSubscriptionTarget[]
): readonly VenueOrderbookSubscriptionTarget[] => {
  if (targets.length === 1) {
    return targets;
  }
  const marketId = firstString(payload.market, payload.marketId, payload.market_id, payload.marketSlug, payload.slug, payload.venueMarketId);
  return marketId
    ? targets.filter((target) => target.venueMarketId === marketId)
    : [];
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

const firstString = (...values: readonly unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
};

const normalizeVenue = (venue: string): string => {
  const normalized = venue.trim().toUpperCase();
  return normalized === "PREDICT" ? "PREDICT_FUN" : normalized;
};
