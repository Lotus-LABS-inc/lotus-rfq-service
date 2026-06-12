import {
  deriveCuratedEventGroup,
  deriveMarketDisplayMetadata
} from "../../repositories/market-catalog.repository.js";
import {
  MarketEventReviewRepository,
  type EventReviewCanonicalRow,
  type EventReviewFilter,
  type EventReviewVenueRuleRow
} from "../../repositories/market-event-review.repository.js";

export class MarketEventReviewServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketEventReviewServiceError";
  }
}

type CatalogStatus = "LIVE" | "PAUSED" | "DISABLED" | "PENDING";

const DB_TO_FRIENDLY: Record<EventReviewCanonicalRow["status"], CatalogStatus> = {
  APPROVED: "LIVE",
  HIDDEN: "PAUSED",
  DISABLED: "DISABLED",
  PENDING: "PENDING"
};

export interface EventReviewOutcomeVenue {
  venue: string;
  venueMarketId: string;
  rulesText: string | null;
  resolutionSource: string | null;
  resolutionTitle: string | null;
}

export interface EventReviewOutcome {
  outcomeKey: string;
  label: string;
  canonicalEventId: string;
  status: CatalogStatus;
  venues: string[];
  perVenue: EventReviewOutcomeVenue[];
  missingVenues: string[];
}

export interface EventReviewSummary {
  eventKey: string;
  eventTitle: string;
  category: string;
  venues: string[];
  outcomeCount: number;
  statusRollup: { live: number; paused: number; pending: number; disabled: number };
  // Outcomes not present on every venue the event touches — i.e. likely pairing gaps to review.
  gapOutcomeCount: number;
}

export interface EventReviewVenueRulesPanel {
  venue: string;
  rulesText: string | null;
  resolutionSource: string | null;
  resolutionTitle: string | null;
  sampleOutcome: string;
}

export interface EventReviewDetail extends EventReviewSummary {
  venueRules: EventReviewVenueRulesPanel[];
  outcomes: EventReviewOutcome[];
}

interface OutcomeAccumulator {
  outcomeKey: string;
  label: string;
  canonicalEventId: string;
  status: CatalogStatus;
  venueMarkets: Map<string, EventReviewOutcomeVenue>;
}

interface EventAccumulator {
  eventKey: string;
  eventTitle: string;
  category: string;
  outcomes: Map<string, OutcomeAccumulator>;
}

const stripSourcePrefix = (propositionKey: string): string => {
  const colon = propositionKey.indexOf(":");
  return colon >= 0 ? propositionKey.slice(colon + 1) : propositionKey;
};

const deriveEventIdentity = (row: EventReviewCanonicalRow): { eventKey: string; eventTitle: string } => {
  const body = stripSourcePrefix(row.propositionKey);
  const curated = deriveCuratedEventGroup(body);
  if (curated) {
    return { eventKey: curated.eventId, eventTitle: curated.title };
  }
  // Ungroupable (raw single-venue inventory): the event is the market itself.
  const display = deriveMarketDisplayMetadata({
    canonical_market_ids: row.canonicalMarketIds,
    title: row.title,
    proposition_key: row.propositionKey,
    frontend_display_title: row.frontendDisplayTitle
  });
  return {
    eventKey: `event:raw:${row.canonicalEventId}`,
    eventTitle: row.frontendDisplayTitle?.trim() || display.displayTopic || row.title
  };
};

const deriveOutcome = (row: EventReviewCanonicalRow): { outcomeKey: string; label: string } => {
  const display = deriveMarketDisplayMetadata({
    canonical_market_ids: row.canonicalMarketIds,
    title: row.title,
    proposition_key: row.propositionKey,
    frontend_display_title: row.frontendDisplayTitle
  });
  return { outcomeKey: display.displayOutcomeKey, label: display.displayOutcome };
};

/**
 * Event-centric (B1) read model over the canonical graph. Groups canonical events into
 * real-world events (via the catalog's family-aware grouping), each with its outcomes,
 * per-venue presence, and resolution rules side by side. Read-only — accept/decline and the
 * matcher near-exact overlay are a later stage.
 */
export class MarketEventReviewService {
  constructor(private readonly repository: MarketEventReviewRepository) {}

  private async buildEvents(filter: EventReviewFilter): Promise<Map<string, EventAccumulator>> {
    const rows = await this.repository.listCanonicalEvents(filter);
    const rules = await this.repository.listVenueRules(rows.map((row) => row.canonicalEventId));
    const rulesByEvent = new Map<string, EventReviewVenueRuleRow[]>();
    for (const rule of rules) {
      const bucket = rulesByEvent.get(rule.canonicalEventId) ?? [];
      bucket.push(rule);
      rulesByEvent.set(rule.canonicalEventId, bucket);
    }

    const events = new Map<string, EventAccumulator>();
    for (const row of rows) {
      const identity = deriveEventIdentity(row);
      const outcome = deriveOutcome(row);
      const event = events.get(identity.eventKey) ?? {
        eventKey: identity.eventKey,
        eventTitle: identity.eventTitle,
        category: row.category,
        outcomes: new Map<string, OutcomeAccumulator>()
      };
      const acc = event.outcomes.get(outcome.outcomeKey) ?? {
        outcomeKey: outcome.outcomeKey,
        label: outcome.label,
        canonicalEventId: row.canonicalEventId,
        status: DB_TO_FRIENDLY[row.status],
        venueMarkets: new Map<string, EventReviewOutcomeVenue>()
      };
      for (const rule of rulesByEvent.get(row.canonicalEventId) ?? []) {
        acc.venueMarkets.set(rule.venue, {
          venue: rule.venue,
          venueMarketId: rule.venueMarketId,
          rulesText: rule.rulesText,
          resolutionSource: rule.resolutionSource,
          resolutionTitle: rule.resolutionTitle
        });
      }
      event.outcomes.set(outcome.outcomeKey, acc);
      events.set(identity.eventKey, event);
    }
    return events;
  }

  private toSummary(event: EventAccumulator): EventReviewSummary {
    const eventVenues = new Set<string>();
    const statusRollup = { live: 0, paused: 0, pending: 0, disabled: 0 };
    for (const outcome of event.outcomes.values()) {
      for (const venue of outcome.venueMarkets.keys()) {
        eventVenues.add(venue);
      }
      if (outcome.status === "LIVE") statusRollup.live += 1;
      else if (outcome.status === "PAUSED") statusRollup.paused += 1;
      else if (outcome.status === "DISABLED") statusRollup.disabled += 1;
      else statusRollup.pending += 1;
    }
    let gapOutcomeCount = 0;
    for (const outcome of event.outcomes.values()) {
      if (outcome.venueMarkets.size < eventVenues.size) {
        gapOutcomeCount += 1;
      }
    }
    return {
      eventKey: event.eventKey,
      eventTitle: event.eventTitle,
      category: event.category,
      venues: [...eventVenues].sort(),
      outcomeCount: event.outcomes.size,
      statusRollup,
      gapOutcomeCount
    };
  }

  async listEvents(filter: EventReviewFilter = {}): Promise<{ events: EventReviewSummary[] }> {
    const events = await this.buildEvents(filter);
    const summaries = [...events.values()]
      .map((event) => this.toSummary(event))
      .sort((left, right) =>
        left.category.localeCompare(right.category) || left.eventTitle.localeCompare(right.eventTitle)
      );
    return { events: summaries };
  }

  async getEvent(eventKey: string): Promise<EventReviewDetail> {
    // Detail isn't filtered, so group everything then pick the one event.
    const events = await this.buildEvents({});
    const event = events.get(eventKey);
    if (!event) {
      throw new MarketEventReviewServiceError(`Event '${eventKey}' not found.`);
    }
    const summary = this.toSummary(event);
    const eventVenues = summary.venues;

    const outcomes: EventReviewOutcome[] = [...event.outcomes.values()]
      .map((outcome) => {
        const perVenue = [...outcome.venueMarkets.values()].sort((a, b) => a.venue.localeCompare(b.venue));
        const present = new Set(perVenue.map((entry) => entry.venue));
        return {
          outcomeKey: outcome.outcomeKey,
          label: outcome.label,
          canonicalEventId: outcome.canonicalEventId,
          status: outcome.status,
          venues: [...present].sort(),
          perVenue,
          missingVenues: eventVenues.filter((venue) => !present.has(venue))
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    // Event-level rules panel: one representative rule per venue (from the first outcome that has it).
    const venueRules: EventReviewVenueRulesPanel[] = eventVenues.map((venue) => {
      for (const outcome of outcomes) {
        const match = outcome.perVenue.find((entry) => entry.venue === venue && entry.rulesText);
        if (match) {
          return {
            venue,
            rulesText: match.rulesText,
            resolutionSource: match.resolutionSource,
            resolutionTitle: match.resolutionTitle,
            sampleOutcome: outcome.label
          };
        }
      }
      const fallback = outcomes.find((outcome) => outcome.perVenue.some((entry) => entry.venue === venue));
      const entry = fallback?.perVenue.find((e) => e.venue === venue);
      return {
        venue,
        rulesText: entry?.rulesText ?? null,
        resolutionSource: entry?.resolutionSource ?? null,
        resolutionTitle: entry?.resolutionTitle ?? null,
        sampleOutcome: fallback?.label ?? ""
      };
    });

    return { ...summary, venueRules, outcomes };
  }
}
