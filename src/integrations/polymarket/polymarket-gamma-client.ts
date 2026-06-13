export interface PolymarketGammaClientConfig {
  baseUrl?: string | undefined;
  clobHost?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export interface PolymarketGammaMarket {
  marketId: string | null;
  conditionId: string;
  marketSlug: string | null;
  title: string;
  raw: Record<string, unknown>;
}

export interface PolymarketGammaEvent {
  eventId: string | null;
  eventSlug: string | null;
  title: string;
  markets: PolymarketGammaMarket[];
  raw: Record<string, unknown>;
}

export interface PolymarketGammaListMarketsInput {
  limit?: number;
  offset?: number;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  order?: string;
  ascending?: boolean;
}

export type PolymarketGammaListEventsInput = PolymarketGammaListMarketsInput;

export class PolymarketGammaClient {
  private readonly baseUrl: string;
  private readonly clobHost: string;
  private readonly fetchImpl: typeof fetch;

  public constructor(config: PolymarketGammaClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? "https://gamma-api.polymarket.com";
    this.clobHost = config.clobHost ?? "https://clob.polymarket.com";
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  public async getMarketByIdentifier(identifier: string): Promise<PolymarketGammaMarket[]> {
    const trimmed = identifier.trim();
    if (!trimmed) {
      return [];
    }
    const eventScoped = parseEventScopedIdentifier(trimmed);
    if (eventScoped) {
      try {
        const markets = await this.getEventMarketsBySlug(eventScoped.eventSlug);
        return markets.filter((market) => marketMatchesScopedDate(market, eventScoped.dateSlug));
      } catch {
        return [];
      }
    }
    if (/^\d+$/.test(trimmed)) {
      const market = await this.getJson(`/markets/${encodeURIComponent(trimmed)}`);
      return normalizeGammaMarketList(market);
    }
    if (/^0x[0-9a-f]{64}$/i.test(trimmed)) {
      const market = await this.getJson(`/markets/${encodeURIComponent(trimmed)}`, {}, this.clobHost);
      return normalizeGammaMarketList(market);
    }
    try {
      const market = await this.getJson(`/markets/slug/${encodeURIComponent(trimmed)}`);
      return normalizeGammaMarketList(market);
    } catch {
      return [];
    }
  }

  public async getEventMarketsBySlug(slug: string): Promise<PolymarketGammaMarket[]> {
    const trimmed = slug.trim();
    if (!trimmed) {
      return [];
    }
    const event = await this.getJson(`/events/slug/${encodeURIComponent(trimmed)}`);
    const markets = asRecord(event).markets;
    return normalizeGammaMarketList(markets);
  }

  public async getEventBySlug(slug: string): Promise<Record<string, unknown>> {
    const trimmed = slug.trim();
    if (!trimmed) {
      return {};
    }
    return asRecord(await this.getJson(`/events/slug/${encodeURIComponent(trimmed)}`));
  }

  public async listEvents(input: PolymarketGammaListEventsInput = {}): Promise<PolymarketGammaEvent[]> {
    const query: Record<string, string> = {
      limit: String(input.limit ?? 100),
      offset: String(input.offset ?? 0)
    };
    if (input.active !== undefined) {
      query.active = String(input.active);
    }
    if (input.closed !== undefined) {
      query.closed = String(input.closed);
    }
    if (input.archived !== undefined) {
      query.archived = String(input.archived);
    }
    if (input.order) {
      query.order = input.order;
    }
    if (input.ascending !== undefined) {
      query.ascending = String(input.ascending);
    }
    const events = await this.getJson("/events", query);
    return normalizeGammaEventList(events);
  }

  public async searchMarkets(query: string): Promise<PolymarketGammaMarket[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }
    const markets = await this.getJson("/markets", { search: trimmed, limit: "20" });
    return normalizeGammaMarketList(markets);
  }

  public async listMarkets(input: PolymarketGammaListMarketsInput = {}): Promise<PolymarketGammaMarket[]> {
    const query: Record<string, string> = {
      limit: String(input.limit ?? 100),
      offset: String(input.offset ?? 0)
    };
    if (input.active !== undefined) {
      query.active = String(input.active);
    }
    if (input.closed !== undefined) {
      query.closed = String(input.closed);
    }
    if (input.archived !== undefined) {
      query.archived = String(input.archived);
    }
    if (input.order) {
      query.order = input.order;
    }
    if (input.ascending !== undefined) {
      query.ascending = String(input.ascending);
    }
    const markets = await this.getJson("/markets", query);
    return normalizeGammaMarketList(markets);
  }

  private async getJson(path: string, query: Record<string, string> = {}, baseUrl = this.baseUrl): Promise<unknown> {
    const url = new URL(path, baseUrl);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    const response = await this.fetchImpl(url, { method: "GET", headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`Polymarket Gamma request failed with status ${response.status}.`);
    }
    return response.json();
  }
}

export const normalizeGammaMarketList = (value: unknown): PolymarketGammaMarket[] => {
  const entries = Array.isArray(value) ? value : [value];
  return entries.flatMap((entry) => {
    const record = asRecord(entry);
    const conditionId = firstString(record.conditionId, record.condition_id);
    const title = firstString(record.question, record.title);
    if (!conditionId || !title) {
      return [];
    }
    const outcomes = parseStringArray(record.outcomes);
    const clobTokenIds = parseStringArray(record.clobTokenIds, record.clob_token_ids);
    const clobTokens = parseClobTokens(record.tokens);
    const normalizedOutcomes = outcomes.map((label, index) => ({
      label,
      token_id: clobTokenIds[index]
    })).filter((outcome) => typeof outcome.label === "string" && outcome.label.length > 0);
    const normalizedRaw = {
      ...record,
      outcomes: clobTokens.length > 0
        ? clobTokens
        : normalizedOutcomes
    };
    return [{
      marketId: firstString(record.id),
      conditionId,
      marketSlug: firstString(record.slug, record.market_slug),
      title,
      raw: normalizedRaw
    }];
  });
};

export const normalizeGammaEventList = (value: unknown): PolymarketGammaEvent[] => {
  const record = asRecord(value);
  const entries = Array.isArray(value)
    ? value
    : Array.isArray(record.events)
      ? record.events
      : Array.isArray(record.data)
        ? record.data
        : [value];
  return entries.flatMap((entry) => {
    const event = asRecord(entry);
    const title = firstString(event.title, event.name);
    if (!title) {
      return [];
    }
    return [{
      eventId: firstString(event.id),
      eventSlug: firstString(event.slug, event.event_slug),
      title,
      markets: normalizeGammaMarketList(event.markets),
      raw: event
    }];
  });
};

const parseClobTokens = (value: unknown): Array<{ label: string; token_id: string }> => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const record = asRecord(entry);
    const label = firstString(record.outcome, record.label);
    const tokenId = firstString(record.token_id, record.tokenId);
    return label && tokenId ? [{ label, token_id: tokenId }] : [];
  });
};

const parseStringArray = (...values: readonly unknown[]): string[] => {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
    }
    if (typeof value === "string" && value.trim().length > 0) {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
        }
      } catch {
        return [];
      }
    }
  }
  return [];
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

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

const parseEventScopedIdentifier = (value: string): { eventSlug: string; dateSlug: string } | null => {
  const [eventSlug, dateSlug, ...rest] = value.split(":");
  if (!eventSlug || !dateSlug || rest.length > 0) {
    return null;
  }
  if (!/^[a-z0-9-]+$/i.test(eventSlug) || !/^[a-z]+-\d{1,2}-\d{4}$/i.test(dateSlug)) {
    return null;
  }
  return { eventSlug, dateSlug };
};

const marketMatchesScopedDate = (market: PolymarketGammaMarket, dateSlug: string): boolean => {
  const normalizedDate = normalizeDateSlug(dateSlug);
  const slug = market.marketSlug?.toLowerCase() ?? "";
  if (slug.includes(dateSlug.toLowerCase())) {
    return true;
  }
  return normalizeDateSlug(market.title) === normalizedDate;
};

const normalizeDateSlug = (value: string): string | null => {
  const match = value.toLowerCase().match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)[\s-]+(\d{1,2})(?:st|nd|rd|th)?(?:[\s,-]+(20\d{2}))?\b/);
  if (!match) {
    return null;
  }
  const month = monthNumber(match[1]!);
  const day = Number.parseInt(match[2]!, 10);
  const year = match[3] ?? "2026";
  return month && day > 0 ? `${year}-${month}-${String(day).padStart(2, "0")}` : null;
};

const monthNumber = (value: string): string | null => {
  const key = value.slice(0, 3).toLowerCase();
  const months: Record<string, string> = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12"
  };
  return months[key] ?? null;
};
