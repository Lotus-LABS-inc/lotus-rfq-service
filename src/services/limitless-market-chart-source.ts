import type { Logger } from "pino";
import type { LimitlessHistoricalClient } from "../integrations/limitless/limitless-client.js";
import type { MarketChartTimeframe, MarketHistoricalChartSource } from "./market-data-view.service.js";

export interface LimitlessMarketChartSourceConfig {
  client: Pick<LimitlessHistoricalClient, "getHistoricalPrice">;
  logger?: Pick<Logger, "warn"> | undefined;
}

const intervalByTimeframe: Readonly<Record<MarketChartTimeframe, "1h" | "6h" | "1d" | "1w" | "1m" | "all">> = {
  "1H": "1h",
  "6H": "1h",
  "1D": "1h",
  "1W": "6h",
  "1M": "1d",
  ALL: "all"
};

export class LimitlessMarketChartSource implements MarketHistoricalChartSource {
  public constructor(private readonly config: LimitlessMarketChartSourceConfig) {}

  public async listChartPoints(input: Parameters<MarketHistoricalChartSource["listChartPoints"]>[0]) {
    const limitlessMappings = [...new Map(
      (input.venueMappings ?? [])
        .filter((mapping) => mapping.venue.toUpperCase() === "LIMITLESS")
        .map((mapping) => [mapping.venueMarketId, mapping])
    ).values()];

    const rows = await Promise.all(limitlessMappings.map(async (mapping) => {
      try {
        const series = await this.config.client.getHistoricalPrice({
          slug: mapping.venueMarketId,
          ...(input.since ? { from: input.since.toISOString() } : {}),
          interval: intervalByTimeframe[input.timeframe ?? "1H"]
        });
        return series.flatMap((entry) =>
          entry.prices.flatMap((point) => {
            const timestamp = toDate(point.timestamp);
            const value = String(point.price);
            return timestamp && Number.isFinite(Number(value))
              ? [{ timestamp, venue: "LIMITLESS", value }]
              : [];
          })
        );
      } catch (error) {
        this.config.logger?.warn(
          { err: error, venueMarketId: mapping.venueMarketId },
          "Limitless historical chart source unavailable for market."
        );
        return [];
      }
    }));

    return rows.flat().sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
  }
}

const toDate = (value: string | number): Date | null => {
  if (typeof value === "number") {
    const millis = value >= 1_000_000_000_000 ? value : value * 1_000;
    const date = new Date(millis);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  const numeric = /^\d+$/.test(value) ? Number.parseInt(value, 10) : Number.NaN;
  const millis = Number.isFinite(numeric)
    ? numeric >= 1_000_000_000_000 ? numeric : numeric * 1_000
    : Date.parse(value);
  const date = new Date(millis);
  return Number.isFinite(date.getTime()) ? date : null;
};
