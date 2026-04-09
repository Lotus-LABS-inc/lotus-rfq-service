# Limitless BTC Directional Discovery Map

- authoritative discovery surface: limitless-live-market-loader
- authenticated enrichment available: yes

| Surface | Auth | Temporal | Payload | Consumed | Strength | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| limitless-live-market-loader | PUBLIC | LIVE_CURRENT_STATE | DISCOVERY | yes | STRONG | public HTML discovery only; no guaranteed full market history; cutoff semantics inferred from parsed content and expiration fields |
| limitless-live-market-loader-snapshot-fallback | PUBLIC | MIXED | DISCOVERY | yes | PARTIAL | snapshot-backed rather than guaranteed live; cannot prove exact absence; only as complete as checked-in HTML |
| limitless-client-market-detail | AUTHENTICATED | LIVE_CURRENT_STATE | DETAIL | no | PARTIAL | requires known slug; cannot discover unknown markets by itself; useful only as enrichment on already discovered candidates |
| limitless-client-market-events | AUTHENTICATED | HISTORICAL | EVENTS | no | WEAK | requires known slug; not a discovery surface; not needed for exact-safe directional proof |
| limitless-client-historical-price | AUTHENTICATED | HISTORICAL | STATE | no | WEAK | requires known slug; not a listing surface; cannot reveal missing directional inventory |
| ingest-limitless-live-markets.job | PUBLIC | LIVE_CURRENT_STATE | ENRICHMENT | yes | PARTIAL | consumer of the live loader rather than an independent discovery path; cannot discover beyond what the loader already exposes |
| btc-limitless-counterpart-proof-audit | AUTHENTICATED | MIXED | ENRICHMENT | no | PARTIAL | proof helper, not a raw discovery surface; depends on underlying public loader and known-slug enrichment |
| btc-venue-audit-sources | AUTHENTICATED | MIXED | ENRICHMENT | no | PARTIAL | snapshot-derived candidate universe; detail enrichment still requires known slug; exact absence cannot be proven from this surface alone |
