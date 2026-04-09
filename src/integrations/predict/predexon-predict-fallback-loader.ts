import type {
  PredexonHistoricalClient,
  PredexonPredictFunOrderbookSnapshot
} from "../predexon/predexon-client.js";
import type { PredictHistoricalFallbackLoader } from "./predict-historical-fallback.js";
import type { PredictFallbackSnapshot, PredictEnvironment } from "./predict-types.js";

const normalizeSnapshot = (
  environment: PredictEnvironment,
  marketId: string,
  snapshot: PredexonPredictFunOrderbookSnapshot
): PredictFallbackSnapshot => ({
  environment,
  marketId,
  provenance: "PREDExON_FALLBACK",
  fidelity: "ORDERBOOK",
  timestamp: new Date(Number(snapshot.timestamp)),
  snapshot: {
    marketId: String(snapshot.market_id),
    timestamp: Number(snapshot.timestamp),
    bids: snapshot.bids,
    asks: snapshot.asks,
    bestBid: snapshot.best_bid,
    bestAsk: snapshot.best_ask,
    bidDepth: snapshot.bid_depth,
    askDepth: snapshot.ask_depth,
    raw: snapshot
  }
});

export class PredexonPredictFallbackLoader implements PredictHistoricalFallbackLoader {
  public constructor(private readonly client: Pick<PredexonHistoricalClient, "getPredictFunOrderbookHistory">) {}

  public async load(input: {
    environment: PredictEnvironment;
    marketId: string;
    start: Date;
    end: Date;
  }): Promise<readonly PredictFallbackSnapshot[]> {
    const snapshots: PredictFallbackSnapshot[] = [];
    let paginationKey: string | undefined;

    do {
      const response = await this.client.getPredictFunOrderbookHistory({
        market_id: input.marketId,
        start_time: input.start.getTime(),
        end_time: input.end.getTime(),
        limit: 200,
        ...(paginationKey ? { pagination_key: paginationKey } : {})
      });

      snapshots.push(
        ...response.snapshots.map((snapshot) => normalizeSnapshot(input.environment, input.marketId, snapshot))
      );

      paginationKey = response.pagination.has_more ? response.pagination.pagination_key ?? undefined : undefined;
    } while (paginationKey);

    return snapshots;
  }
}
