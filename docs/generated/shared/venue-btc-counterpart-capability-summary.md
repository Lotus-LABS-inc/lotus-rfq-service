# Venue BTC Counterpart Capability Summary

- Opinion BTC buckets available: 141

## OPINION
- classification: `DIRECT_PROOF`
- supported surfaces: openapi:/market
- market list completeness: high
- market detail completeness: medium
- searchable by asset/date/family: true/true/true
- exact presence proof: CAN_PROVE_PRESENCE
- exact absence proof: PARTIAL_NEGATIVE_PROOF
- observed candidates: 141
- warnings: 0
- limitation: Opinion is authoritative for the current live BTC target bucket set, not for proving other venue universes.
- limitation: The current pass uses list pagination rather than exhaustive historical exports.

## POLYMARKET
- classification: `DIRECT_PROOF`
- supported surfaces: predexon:listMarkets(search=Bitcoin)
- market list completeness: medium
- market detail completeness: medium
- searchable by asset/date/family: true/false/false
- exact presence proof: CAN_PROVE_PRESENCE
- exact absence proof: CAN_PROVE_ABSENCE
- observed candidates: 999
- warnings: 0
- limitation: Predexon search is asset-led rather than exact date/family indexed.
- limitation: Negative proof is only safe when the live Predexon surface is reachable in this run.

## LIMITLESS
- classification: `WEAK_INFERENCE_ONLY`
- supported surfaces: limitless:getMarketDetail(known_refs_only), snapshot:.tmp-limitless-*.html
- market list completeness: low
- market detail completeness: low
- searchable by asset/date/family: false/false/false
- exact presence proof: PARTIAL_NEGATIVE_PROOF
- exact absence proof: CANNOT_PROVE_ABSENCE
- observed candidates: 0
- warnings: 1
- limitation: Current public Limitless surfaces are positive-evidence oriented and do not safely prove absence.
- limitation: Detail API can enrich known references but does not provide exhaustive BTC date-family discovery.
- limitation: Snapshot absence is never evidence of non-existence.
