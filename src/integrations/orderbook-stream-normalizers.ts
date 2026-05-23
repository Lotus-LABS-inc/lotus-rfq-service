import type { NormalizedVenueQuoteSnapshot } from "../core/sor/quote-snapshot.js";
import { normalizeLimitlessOrderbook } from "./limitless/limitless-quote-reader.js";
import { normalizeOpinionOrderbook } from "./opinion/opinion-quote-reader.js";
import { normalizePolymarketOrderbook } from "./polymarket/polymarket-quote-reader.js";
import { normalizePredictOrderbook } from "./predict/predict-quote-reader.js";
import type { PredictEnvironment } from "./predict/predict-types.js";

export const DEFAULT_POLYMARKET_MARKET_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

export interface VenueOrderbookStreamAdapter {
  readonly venue: string;
  normalize(input: VenueOrderbookStreamMessage): NormalizedVenueQuoteSnapshot | null;
}

export interface VenueOrderbookStreamMessage {
  venueMarketId: string;
  venueOutcomeId?: string | undefined;
  canonicalOutcomeId?: string | undefined;
  receivedAt: Date;
  payload: unknown;
}

export class PolymarketOrderbookStreamAdapter implements VenueOrderbookStreamAdapter {
  public readonly venue = "POLYMARKET";

  public normalize(input: VenueOrderbookStreamMessage): NormalizedVenueQuoteSnapshot | null {
    const snapshot = normalizePolymarketOrderbook({
      payload: input.payload,
      venueMarketId: input.venueMarketId,
      ...(input.venueOutcomeId ? { venueOutcomeId: input.venueOutcomeId } : {}),
      receivedAt: input.receivedAt
    });
    return asStreamSnapshot(snapshot);
  }
}

export class LimitlessOrderbookStreamAdapter implements VenueOrderbookStreamAdapter {
  public readonly venue = "LIMITLESS";

  public normalize(input: VenueOrderbookStreamMessage): NormalizedVenueQuoteSnapshot | null {
    const snapshot = normalizeLimitlessOrderbook({
      payload: input.payload,
      venueMarketId: input.venueMarketId,
      ...(input.venueOutcomeId ? { venueOutcomeId: input.venueOutcomeId } : {}),
      receivedAt: input.receivedAt
    });
    return asStreamSnapshot(snapshot);
  }
}

export class OpinionOrderbookStreamAdapter implements VenueOrderbookStreamAdapter {
  public readonly venue = "OPINION";

  public normalize(input: VenueOrderbookStreamMessage): NormalizedVenueQuoteSnapshot | null {
    const snapshot = normalizeOpinionOrderbook({
      payload: input.payload,
      venueMarketId: input.venueMarketId,
      ...(input.venueOutcomeId ? { venueOutcomeId: input.venueOutcomeId } : {}),
      receivedAt: input.receivedAt
    });
    return asStreamSnapshot(snapshot);
  }
}

export class PredictOrderbookStreamAdapter implements VenueOrderbookStreamAdapter {
  public readonly venue = "PREDICT_FUN";

  public constructor(private readonly environment: PredictEnvironment) {}

  public normalize(input: VenueOrderbookStreamMessage): NormalizedVenueQuoteSnapshot | null {
    const snapshot = normalizePredictOrderbook({
      payload: input.payload,
      venueMarketId: input.venueMarketId,
      ...(input.venueOutcomeId ? { venueOutcomeId: input.venueOutcomeId } : {}),
      ...(input.canonicalOutcomeId === "YES" || input.canonicalOutcomeId === "NO" ? { outcomeSide: input.canonicalOutcomeId } : {}),
      receivedAt: input.receivedAt,
      environment: this.environment
    });
    return asStreamSnapshot(snapshot);
  }
}

const asStreamSnapshot = (snapshot: NormalizedVenueQuoteSnapshot): NormalizedVenueQuoteSnapshot => ({
  ...snapshot,
  source: "STREAM",
  quoteQuality: snapshot.bids.length > 1 && snapshot.asks.length > 1 ? "FULL_DEPTH_STREAM" : "TOP_OF_BOOK_REST",
  metadata: {
    ...(snapshot.metadata ?? {}),
    streamAdapterVersion: "venue-orderbook-stream-v1"
  }
});
