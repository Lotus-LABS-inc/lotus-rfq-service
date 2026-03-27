const clientScript = String.raw`
const state = { scopes: [], latestRunId: null, canonicalMarkets: [] };

const endpoints = {
  scopes: "/admin/simulation/scopes",
  run: "/admin/simulation/run",
  canonical: (eventId, canonicalMarketId) => {
    const url = new URL("/admin/simulation/canonical/" + encodeURIComponent(eventId), window.location.origin);
    if (canonicalMarketId) {
      url.searchParams.set("canonicalMarketId", canonicalMarketId);
    }
    return url.pathname + url.search;
  },
  runDetail: (runId) => "/admin/simulation/run/" + encodeURIComponent(runId),
  runResults: (runId) => "/admin/simulation/run/" + encodeURIComponent(runId) + "/results"
};

const el = {};

const setStatus = (message, kind) => {
  el.status.textContent = message;
  el.status.dataset.kind = kind;
};

const safeJson = (value) => JSON.stringify(value, null, 2);
const esc = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const fmtDate = (value) => {
  if (!value) return "N/A";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "N/A" : date.toLocaleString();
};

const fmtNum = (value) => {
  if (value === null || value === undefined || value === "") return "N/A";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(3).replace(/\.?0+$/, "") : String(value);
};

const fmtProb = (value) => {
  if (value === null || value === undefined || value === "") return "Not inferable";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? (numeric * 100).toFixed(0) + "%" : String(value);
};

const fmtAbsNum = (value) => {
  if (value === null || value === undefined || value === "") return "N/A";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? fmtNum(Math.abs(numeric)) : fmtNum(value);
};

const currentSide = () => el.side?.value ?? state.latestSide ?? "BUY";

const cashLabel = (side) => side === "SELL" ? "Estimated net proceeds" : "Estimated cash spent";
const filledCashLabel = (side) => side === "SELL" ? "Cash received" : "Cash spent";
const averagePriceLabel = (side) => side === "SELL" ? "Average sale price" : "Average buy price";
const quantityLabel = () => "Filled quantity";
const residualQuantityLabel = () => "Unfilled quantity";

const describeComparisonReason = (reason, selectedPlan, alternatePlan) => {
  switch (reason) {
    case "higher_fill_ratio":
      return selectedPlan.planType + " won because it can prove more immediate fill than " + alternatePlan.planType + ".";
    case "lower_effective_cost":
      return selectedPlan.planType + " won because the economically comparable portion is cheaper for this order size.";
    case "fewer_allocations":
      return selectedPlan.planType + " won because both plans were economically similar and it used fewer venue allocations.";
    case "stable_plan_order":
      return selectedPlan.planType + " won on the deterministic tie-break.";
    default:
      return selectedPlan.planType + " was selected by the routing comparison.";
  }
};

const yesNo = (value) => value ? "Yes" : "No";

const fmtSignedDelta = (value) => {
  if (value === null || value === undefined || value === "") return "N/A";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  const formatted = fmtNum(Math.abs(numeric));
  if (numeric === 0) return formatted;
  return (numeric > 0 ? "+" : "-") + formatted;
};

const parseRatio = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const badge = (label, tone) => '<span class="badge ' + tone + '">' + esc(label) + "</span>";

const deriveConfidence = (lotusResult) => {
  const blocked = lotusResult?.metadata?.blocked === true || lotusResult?.resolutionRiskGating?.allowed === false;
  const selectedPlan = lotusResult?.feeAdjustedResult?.routingComparison?.selectedPlan ?? null;

  if (blocked || !selectedPlan) {
    return {
      grade: "BLOCKED",
      tone: "danger",
      summary: "Lotus did not produce a runnable route for this slice."
    };
  }

  const provableFillRatio = parseRatio(selectedPlan.provableFillRatio);
  const containsUnknownDepth = selectedPlan.containsUnknownDepth === true;
  const unprovenResidual = Math.abs(Number(selectedPlan.unprovenResidualNotional ?? 0));

  if (provableFillRatio >= 0.999 && !containsUnknownDepth && unprovenResidual === 0) {
    return {
      grade: "HIGH",
      tone: "success",
      summary: "The winning route is fully backed by explicit historical depth."
    };
  }

  if (provableFillRatio >= 0.25) {
    return {
      grade: "MEDIUM",
      tone: "warning",
      summary: "A meaningful portion of the route is depth-proven, but some capacity still depends on price-only residual assignment."
    };
  }

  return {
    grade: "LOW",
    tone: "danger",
    summary: "Most of the winning route still depends on price-only capacity or very limited provable depth."
  };
};

const kv = (items) =>
  '<dl class="kv">' +
  items.map(([label, value, raw]) => '<div><dt>' + esc(label) + '</dt><dd>' + (raw ? value : esc(value)) + "</dd></div>").join("") +
  "</dl>";

const currentRouteMode = () => el.routeMode?.value ?? "POLYMARKET_LIMITLESS";

const routeReasonLabel = (reason) => {
  switch (reason) {
    case "missing_required_venue":
      return "Missing required venue";
    case "missing_historical_rows":
      return "No historical rows";
    case "missing_pair_assessment":
      return "Missing pair assessment";
    case "incomplete_resolution_risk":
      return "Incomplete resolution risk";
    case "stale_resolution_risk":
      return "Stale resolution risk";
    case "unsafe_equivalence":
      return "Unsafe equivalence";
    case "ambiguous_venue_identity":
      return "Ambiguous venue identity";
    default:
      return "Unavailable";
  }
};

const selectedRouteAvailability = (market) =>
  (market?.routeModes ?? []).find((route) => route.routeMode === currentRouteMode()) ?? null;

const isRunnableForSelectedRouteMode = (market) => selectedRouteAvailability(market)?.runnable === true;

const formatRouteBadgeList = (routeModes) =>
  (Array.isArray(routeModes) ? routeModes : []).map((route) =>
    badge(
      route.label + (route.runnable ? " runnable" : " unavailable"),
      route.runnable ? "success" : "danger"
    ) + (route.runnable || !route.reason ? "" : ' <span class="muted">(' + esc(routeReasonLabel(route.reason)) + ")</span>")
  ).join(" ");

const renderCanonicalMarketOptions = (markets, preferredValue) => {
  const marketOptions = Array.isArray(markets) ? markets : [];
  state.canonicalMarkets = marketOptions;
  const describeVenueMarket = (venue) => {
    const title = venue.title ? " (" + venue.title + ")" : "";
    return venue.venue + ": " + venue.venueMarketId + title;
  };
  const availableIds = marketOptions.filter((market) => isRunnableForSelectedRouteMode(market)).map((market) => market.canonicalMarketId);
  const previousValue = preferredValue ?? el.canonicalMarketId.value;
  const nextValue =
    availableIds.includes(previousValue)
      ? previousValue
      : availableIds.length === 1
        ? availableIds[0]
        : "";

  if (marketOptions.length === 0) {
    el.canonicalMarketId.innerHTML = '<option value="">No market-scoped IDs available for this event</option>';
    el.canonicalMarketId.value = "";
    el.canonicalMarketId.disabled = true;
    el.canonicalMarketId.dataset.mode = "disabled";
    return "";
  }

  el.canonicalMarketId.innerHTML = '<option value="">Select exact market for this route mode</option>' +
    marketOptions.map((market) => {
      const venueLabel = market.venues.map((venue) => describeVenueMarket(venue)).join(" | ");
      const routeAvailability = selectedRouteAvailability(market);
      const stateLabel = routeAvailability?.runnable
        ? "Runnable"
        : "Unavailable: " + routeReasonLabel(routeAvailability?.reason);
      return '<option value="' + esc(market.canonicalMarketId) + '">' +
        esc(market.canonicalMarketId + " | " + stateLabel + " | " + venueLabel) +
        '</option>';
    }).join("");
  el.canonicalMarketId.disabled = false;
  el.canonicalMarketId.dataset.mode = "enabled";
  el.canonicalMarketId.value = nextValue;
  return nextValue;
};

const resetCanonicalMarketSelect = () => {
  el.canonicalMarketId.innerHTML = '<option value="">Select an event first</option>';
  el.canonicalMarketId.value = "";
  el.canonicalMarketId.disabled = true;
  el.canonicalMarketId.dataset.mode = "disabled";
};


const updateScopeOptions = () => {
  const current = el.eventSelect.value;
  el.eventSelect.innerHTML = '<option value="">Select canonical event</option>';
  for (const scope of state.scopes) {
    const option = document.createElement("option");
    option.value = scope.canonicalEventId;
    option.textContent = scope.canonicalEventId + " | " + scope.canonicalCategory + " | " + (scope.catalogScope === "historical_simulation" ? "Historical catalog" : "Live catalog");
    el.eventSelect.appendChild(option);
  }
  if (current && state.scopes.some((scope) => scope.canonicalEventId === current)) {
    el.eventSelect.value = current;
  }
};

const renderCanonical = (payload) => {
  const inspection = payload.resolutionRiskInspection ?? {};
  const freshness = inspection.freshness ?? {};
  const safeEquivalent = Array.isArray(inspection.assessments)
    && inspection.assessments.length > 0
    && inspection.assessments.every((assessment) => assessment.equivalenceClass === "SAFE_EQUIVALENT" || assessment.equivalenceClass === "EQUIVALENT_WITH_LAG");
  
  const riskClass = inspection.assessments?.[0]?.equivalenceClass ?? "UNKNOWN";
  const riskLabel = !freshness.isComplete || freshness.isStale
    ? badge("Stale / incomplete", "danger")
    : riskClass === "SAFE_EQUIVALENT"
      ? badge("SAFE_EQUIVALENT", "success")
      : riskClass === "EQUIVALENT_WITH_LAG"
        ? badge("EQUIVALENT_WITH_LAG", "success")
        : badge(riskClass, "warning");

  const coverageRows = (payload.venueCoverage ?? []).map((row) =>
    "<tr><td>" + esc(row.venue) + "</td><td>" + esc(String(row.rowCount)) + "</td><td>" + esc(fmtDate(row.coverageStart)) + "</td><td>" + esc(fmtDate(row.coverageEnd)) + "</td></tr>"
  ).join("");

  const ambiguity = payload.ambiguity ?? {};
  const venuesWithMultipleMarkets = Object.keys(ambiguity).filter(v => ambiguity[v].isAmbiguous);
  const pairingAmbiguous = venuesWithMultipleMarkets.length > 0;
  const pairedMarketsRows = (payload.pairedMarkets ?? []).map((market) =>
    "<tr><td>" + esc(market.venue) + "</td><td>" + esc(market.venueMarketId) + "</td><td>" + esc(market.title ?? "N/A") + "</td></tr>"
  ).join("");

  const selectedCanonicalMarketId = renderCanonicalMarketOptions(payload.canonicalMarkets ?? [], payload.canonicalMarketId ?? null);

  // Auto-set time range based on coverage
  const startTimes = (payload.venueCoverage ?? []).map(v => new Date(v.coverageStart).getTime()).filter(t => !isNaN(t));
  const endTimes = (payload.venueCoverage ?? []).map(v => new Date(v.coverageEnd).getTime()).filter(t => !isNaN(t));
  if (startTimes.length > 0 && endTimes.length > 0) {
    const minStart = new Date(Math.min(...startTimes));
    const maxEnd = new Date(Math.max(...endTimes));
    
    // adjust for local timezone offset when setting datetime-local input
    const toLocalString = (date) => new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().slice(0,16);
    
    el.from.value = toLocalString(minStart);
    el.to.value = toLocalString(maxEnd);

  }

  el.canonical.innerHTML =
    '<section class="card"><h3>Canonical event</h3>' +
    kv([
      ["Event ID", payload.canonicalEventId ?? "N/A"],
      ["Catalog scope", payload.catalogScope === "historical_simulation" ? "Historical simulation" : "Live"],
      ["Canonical Market ID", selectedCanonicalMarketId || "Choose exact market for route mode"],
      ["Category", payload.canonicalCategory ?? "N/A"],
      ["Market class", payload.marketClass ?? "N/A"],
      ["3-platform routes", payload.hasTriVenueRoute ? "Available" : "Not found"],
      ["Tri-venue exact markets", String(payload.triVenueRouteableMarketCount ?? 0)]
    ]) +
    "</section>" +
    '<section class="card"><h3>Route mode summary</h3><div class="cards">' +
    (payload.routeModeSummary ?? []).map((summary) =>
      '<section class="card"><h3>' + esc(summary.label) + '</h3>' +
      kv([
        ["Mode", summary.routeMode],
        ["Cardinality", summary.cardinality],
        ["Routeable markets", String(summary.routeableMarketCount)],
        ["Available in event", summary.hasAnyRoute ? "Yes" : "No"]
      ]) +
      '</section>'
    ).join("") +
    '</div></section>' +
    '<section class="card"><h3>Exact market routes</h3>' +
    ((payload.canonicalMarkets ?? []).some((market) => !isRunnableForSelectedRouteMode(market))
      ? '<p class="muted">Every exact market stays visible for audit context. Simulation is only allowed on markets that are runnable for the selected route mode.</p>'
      : '') +
    (pairingAmbiguous ? '<p class="callout">' + badge("Ambiguous Pairing", "danger") + ' Multiple markets found for: ' + esc(venuesWithMultipleMarkets.join(", ")) + '</p>' : "") +
    '<table class="table"><thead><tr><th>Canonical Market ID</th><th>Venues</th><th>Route Modes</th></tr></thead><tbody>' +
    ((payload.canonicalMarkets ?? []).map((market) =>
      '<tr><td>' + esc(market.canonicalMarketId) + '</td><td>' +
      esc((market.venues ?? []).map((venue) => venue.venue + ": " + venue.venueMarketId).join(" | ") || "N/A") +
      '</td><td>' + formatRouteBadgeList(market.routeModes) + '</td></tr>'
    ).join("") || '<tr><td colspan="3" class="muted">No exact markets found.</td></tr>') +
    '</tbody></table>' +
    "</section>" +
    '<section class="card"><h3>Selected market venues</h3>' +
    '<table class="table"><thead><tr><th>Venue</th><th>Venue Market ID</th><th>Title</th></tr></thead><tbody>' +
    (pairedMarketsRows || '<tr><td colspan="3" class="muted">No paired markets found.</td></tr>') +
    '</tbody></table>' +
    "</section>" +
    '<section class="card"><h3>Resolution risk</h3><p class="callout">' + riskLabel + '</p>' +
    kv([
      ["Scoring version", inspection.scoringVersion ?? "N/A"],
      ["Profiles", String(freshness.profileCount ?? 0)],
      ["Expected pairs", String(freshness.expectedPairCount ?? 0)],
      ["Persisted pairs", String(freshness.persistedPairCount ?? 0)],
      ["Max Settlement Delay", (inspection.assessments?.[0]?.maxSettlementDelayHours ?? 0) + "h"],
      ["Liquidity Cost", (Number(inspection.assessments?.[0]?.liquidityCost ?? 0) * 100).toFixed(4) + "%"],
      ["Identity Guard", pairingAmbiguous ? badge("MULTIPLE_MARKETS", "danger") : badge("READY", "success"), true]
    ]) +
    (inspection.assessments?.length > 0 ? 
      '<h4>Risk Factor Audit</h4><table class="table"><thead><tr><th>Factor</th><th>Score</th><th>Confidence</th><th>Reason</th></tr></thead><tbody>' +
      Object.entries(inspection.assessments[0].factorBreakdown ?? {}).map(([factor, data]) => 
        '<tr><td>' + esc(factor) + '</td><td>' + badge(fmtNum(data.score), data.score === 0 ? "success" : data.score > 0.5 ? "danger" : "warning") + '</td><td>' + fmtProb(data.confidence) + '</td><td>' + esc(data.reason ?? "-") + '</td></tr>'
      ).join("") +
      '</tbody></table>'
    : "") +
    "</section>" +
    '<section class="card"><h3>Historical venue coverage</h3><table class="table"><thead><tr><th>Venue</th><th>Rows</th><th>From</th><th>To</th></tr></thead><tbody>' +
    coverageRows +
    "</tbody></table></section>";
};

const renderRun = (payload) => {
  const run = payload.run ?? null;
  const sim = payload.simulationResult ?? null;
  if (!run && !sim) {
    el.run.innerHTML = '<p class="muted">No simulation run yet.</p>';
    return;
  }

  const status = run?.status ?? sim?.status ?? "UNKNOWN";
  const tone = status === "SUCCEEDED" ? "success" : status === "FAILED" ? "danger" : "warning";
  state.latestSide = run?.metadata?.side ?? sim?.metadata?.side ?? state.latestSide ?? "BUY";

  el.run.innerHTML =
    '<section class="card"><h3>Run status</h3><p class="callout">' + badge(status, tone) + '</p>' +
    kv([
      ["Run ID", run?.id ?? sim?.runId ?? "Dry run"],
      ["Strategy key", run?.metadata?.strategyKey ?? sim?.metadata?.strategyKey ?? "N/A"],
      ["Catalog scope", run?.metadata?.catalogScope ?? sim?.metadata?.catalogScope ?? "N/A"],
      ["Started", fmtDate(run?.startedAt ?? null)],
      ["Ended", fmtDate(run?.endedAt ?? null)]
    ]) +
    "</section>" +
    '<section class="card"><h3>Simulation summary</h3>' +
    kv([
      ["Scope", run ? run.scopeType + " / " + run.scopeId : "Dry run"],
      ["Route mode", run?.routeMode ?? "POLYMARKET_LIMITLESS"],
      ["Side", run?.metadata?.side ?? sim?.metadata?.side ?? "N/A"],
      ["Requested notional", fmtNum(run?.metadata?.requestedNotional ?? sim?.metadata?.requestedNotional ?? null)],
      ["Slices evaluated", String(sim?.sliceCount ?? 0)],
      ["Blocked slices", String(sim?.blockedSliceCount ?? 0)],
      ["Persisted results", String(sim?.persistedResultCount ?? 0)]
    ]) +
    "</section>";
};

const renderBaselines = (baselineResults) => {
  if (!baselineResults) {
    el.baselines.innerHTML = '<p class="muted">No baseline results available.</p>';
    return;
  }

  const winner = baselineResults.bestExternalOnly?.venue ?? "N/A";
  const side = currentSide();
  const rows = [
    ["Polymarket only", baselineResults.polymarketOnly],
    ["Limitless only", baselineResults.limitlessOnly],
    ["Opinion only", baselineResults.opinionOnly],
    ["Myriad only", baselineResults.myriadOnly],
    ["Predict only", baselineResults.predictOnly],
    ["Best external", baselineResults.bestExternalOnly],
    ["No internalization", baselineResults.noInternalization]
  ].filter(([, value]) => value);

  el.baselines.innerHTML = '<p class="lead">Best external venue in this slice: ' + esc(winner) + '.</p>' +
    '<div class="cards">' +
    rows.map(([label, baseline]) =>
      '<section class="card"><h3>' + esc(label) + '</h3>' +
      kv([
        ["Venue", baseline.venue ?? "N/A"],
        [cashLabel(side), fmtAbsNum(baseline.effectiveCost)],
        ["Reference slippage", fmtSignedDelta(baseline.slippage)],
        ["Fees", fmtNum(baseline.fees)],
        ["Fill probability", fmtProb(baseline.fillProbability)]
      ]) +
      (baseline.fillProbabilityReason ? '<p class="muted">Probability note: ' + esc(baseline.fillProbabilityReason) + '</p>' : "") +
      "</section>"
    ).join("") +
    "</div>";
};

const renderLotus = (lotusResult) => {
  if (!lotusResult) {
    el.lotus.innerHTML = '<p class="muted">No Lotus result available.</p>';
    return;
  }
  state.latestRoutingComparison = lotusResult.feeAdjustedResult?.routingComparison ?? null;

  const blocked = lotusResult.metadata?.blocked === true || lotusResult.resolutionRiskGating?.allowed === false;
  const rawReason = lotusResult.metadata?.blockedReason ?? lotusResult.resolutionRiskGating?.reason ?? "Allowed";
  const isIdentityBlock = rawReason.includes("identity_mismatch");
  const reason = isIdentityBlock ? "IDENTITY_BLOCK: " + rawReason : rawReason;
  const confidence = deriveConfidence(lotusResult);

  el.lotus.innerHTML =
    '<section class="card"><h3>Lotus path</h3><p class="callout">' +
    badge(blocked ? "Blocked" : "Allowed", blocked ? "danger" : "success") +
    (isIdentityBlock ? " " + badge("IDENTITY_RISK", "danger") : "") +
    '</p><p class="callout">' + badge("Confidence: " + confidence.grade, confidence.tone) + '</p><p class="lead">' + esc(confidence.summary) + '</p><p class="muted">' + esc(reason) + '</p>' +
    kv([
      ["Confidence grade", confidence.grade],
      ["Config version", lotusResult.configVersion ?? "N/A"],
      ["Engine version", lotusResult.engineVersion ?? "N/A"],
      ["Timestamp", fmtDate(lotusResult.timestamp ?? null)],
      ["SAFE_EQUIVALENT eligible", lotusResult.safeEquivalentEligible ? "Yes" : "No"],
      ["SOR evaluated", lotusResult.sor ? "Yes" : "No"],
      ["RFQ grouping evaluated", lotusResult.rfqGrouping ? "Yes" : "No"],
      ["Selected route plan", lotusResult.feeAdjustedResult?.metadata?.selectedPlanType ?? "N/A"]
    ]) +
    "</section>" +
    renderRoutingComparison(lotusResult.feeAdjustedResult?.routingComparison ?? null);
};

const renderPlanCard = (title, plan) =>
  '<section class="card"><h3>' + esc(title) + '</h3>' +
  '<p class="lead">' + esc(
    (plan.planType ?? "Plan") + " can prove " + fmtProb(plan.provableFillRatio ?? plan.fillRatio) + " of the order now." +
    ((Number(plan.unprovenResidualNotional ?? 0) > 0) ? " The rest is only economically assigned to a price-only venue and is not capacity-proven." :
      (Number(plan.residualNotional ?? 0) > 0) ? " The remaining amount is unfilled." : "")
  ) + '</p>' +
  kv([
    ["Plan type", plan.planType ?? "N/A"],
    ["Order size", fmtNum(plan.requestedNotional)],
    ["Provably fillable now", fmtAbsNum(plan.provableFilledNotional ?? plan.filledNotional)],
    ["Provable fill quantity", fmtNum(plan.provableFilledQuantity ?? plan.filledQuantity)],
    ["Provable fill ratio", fmtProb(plan.provableFillRatio ?? plan.fillRatio)],
    ["Residual with unknown depth", fmtAbsNum(plan.unprovenResidualNotional ?? "0")],
    ["Unknown-depth quantity", fmtNum(plan.unprovenResidualQuantity ?? "0")],
    ["Contains unknown-depth leg", yesNo(plan.containsUnknownDepth)],
    [filledCashLabel(plan.side), fmtAbsNum(plan.filledNotional)],
    ["Unfilled amount", fmtAbsNum(plan.residualNotional)],
    [quantityLabel(), fmtNum(plan.filledQuantity)],
    [residualQuantityLabel(), fmtNum(plan.residualQuantity)],
    ["Fill ratio", fmtProb(plan.fillRatio)],
    [averagePriceLabel(plan.side), fmtAbsNum(plan.averageExecutionPrice)],
    [cashLabel(plan.side), fmtAbsNum(plan.effectiveCost)],
    ["Reference slippage", fmtSignedDelta(plan.slippage)],
    ["Fees", fmtNum(plan.fees)],
    ["Fill probability", fmtProb(plan.fillProbability)]
  ]) +
  (Array.isArray(plan.allocations) && plan.allocations.length > 0
    ? '<div class="table-wrap"><table class="table compact-table"><thead><tr><th>Venue</th><th>Market</th><th>Price</th><th>Filled Qty</th><th>' + esc(filledCashLabel(plan.side)) + '</th><th>Liquidity Evidence</th><th>Provable</th></tr></thead><tbody>' +
      plan.allocations.map((allocation) =>
        '<tr><td>' + esc(allocation.venue) + '</td><td>' + esc(allocation.venueMarketId) + '</td><td>' + esc(fmtAbsNum(allocation.price)) + '</td><td>' + esc(fmtNum(allocation.quantity)) + '</td><td>' + esc(fmtAbsNum(allocation.filledNotional)) + '</td><td>' + esc(allocation.depthSource ?? "N/A") + '</td><td>' + esc(allocation.isProvable ? "Yes" : "No") + '</td></tr>'
      ).join("") +
      '</tbody></table></div>'
    : '<p class="muted">No routed allocations were available.</p>') +
  ((plan.containsUnknownDepth || Number(plan.unprovenResidualNotional ?? 0) > 0)
    ? '<p class="muted">Residual leg uses price-only venue; capacity is not provable from historical depth.</p>'
    : '') +
  (plan.fillProbabilityReason ? '<p class="muted">Fill note: ' + esc(plan.fillProbabilityReason) + '</p>' : "") +
  '</section>';

const renderRoutingComparison = (comparison) => {
  if (!comparison) {
    return '<p class="muted">No routing comparison available.</p>';
  }

  return '<section class="card"><h3>Routing comparison</h3><p class="lead">' +
    esc(describeComparisonReason(comparison.comparisonReason, comparison.selectedPlan ?? {}, comparison.alternatePlan ?? {})) +
    '</p><p class="muted">Comparison basis: ' + esc(comparison.comparisonBasis ?? "stable_plan_order") + '.' +
    ((comparison.selectedPlan?.containsUnknownDepth || comparison.alternatePlan?.containsUnknownDepth)
      ? ' Price-only residual capacity is shown separately from provable fill.'
      : '') +
    '</p><div class="cards">' +
    renderPlanCard("Winning Plan", comparison.selectedPlan) +
    renderPlanCard("Alternate Plan", comparison.alternatePlan) +
    '</div></section>';
};

const renderImprovement = (improvement) => {
  if (!improvement) {
    el.improvement.innerHTML = '<p class="muted">No improvement metrics available.</p>';
    return;
  }

  const items = [
    ["Best external", improvement.bestExternalOnly],
    ["No internalization", improvement.noInternalization],
    ["Polymarket", improvement.venueSpecific?.polymarketOnly],
    ["Limitless", improvement.venueSpecific?.limitlessOnly],
    ["Opinion", improvement.venueSpecific?.opinionOnly]
  ].filter(([, value]) => value);

  el.improvement.innerHTML = '<div class="cards">' +
    items.map(([label, item]) =>
      '<section class="card"><h3>' + esc(label) + '</h3>' +
      '<p class="callout">' + badge(item.status ?? "UNKNOWN", item.status === "BLOCKED" ? "danger" : "success") + '</p>' +
      ((state.latestRoutingComparison?.selectedPlan?.containsUnknownDepth)
        ? '<p class="muted">Economically preferred result includes price-only residual capacity; only the provable portion should be treated as guaranteed fill.</p>'
        : '') +
      kv([
        ["Baseline venue", item.baselineVenue ?? "N/A"],
        [cashLabel(currentSide()), fmtAbsNum(item.baselineEffectiveCost)],
        ["Baseline slippage", fmtSignedDelta(item.baselineSlippage)],
        ["Baseline fees", fmtNum(item.baselineFees)],
        ["Baseline fill probability", fmtProb(item.baselineFillProbability)],
        ["Lotus cash improvement", fmtSignedDelta(item.effectiveCostDelta)],
        ["Lotus slippage improvement", fmtSignedDelta(item.slippageDelta)],
        ["Lotus fee improvement", fmtSignedDelta(item.feeDelta)],
        ["Lotus fill probability delta", item.fillProbabilityDelta === null || item.fillProbabilityDelta === undefined ? "Not inferable" : fmtSignedDelta(item.fillProbabilityDelta)]
      ]) +
      "</section>"
    ).join("") +
    "</div>";
};

const renderEligibility = (eligibility) => {
  if (!eligibility) {
    el.eligibility.innerHTML = '<p class="muted">No rollout eligibility available.</p>';
    return;
  }

  const blocked = eligibility.status === "BLOCKED";
  el.eligibility.innerHTML =
    '<section class="card"><h3>Rollout decision</h3><p class="callout">' +
    badge(eligibility.status ?? "UNKNOWN", blocked ? "danger" : "success") +
    '</p><p class="lead">' + esc(eligibility.reason ?? "No reason provided.") + '</p>' +
    kv([["SAFE_EQUIVALENT eligible", eligibility.safeEquivalentEligible ? "Yes" : "No"]]) +
    "</section>";
};

const renderSlices = (sliceResults) => {
  if (!Array.isArray(sliceResults) || sliceResults.length === 0) {
    el.slices.innerHTML = '<p class="muted">No slice results available.</p>';
    return;
  }

  const rows = sliceResults.map((slice) => {
    const best = slice.baselineResults?.bestExternalOnly;
    const allowed = slice.lotusResult?.resolutionRiskGating?.allowed === true;
    const reason = slice.rolloutEligibility?.reason ?? slice.lotusResult?.metadata?.blockedReason ?? "N/A";
    return "<tr><td>" + esc(fmtDate(slice.timestamp)) + "</td><td>" + esc(allowed ? "Allowed" : "Blocked") + "</td><td>" + esc((best?.venue ?? "N/A") + " @ " + fmtNum(best?.effectiveCost)) + "</td><td>" + esc(reason) + "</td></tr>";
  }).join("");

  el.slices.innerHTML =
    '<table class="table"><thead><tr><th>Timestamp</th><th>Lotus path</th><th>Best baseline</th><th>Reason</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<details class="details"><summary>Technical JSON</summary><pre>' + esc(safeJson(sliceResults)) + "</pre></details>";
};

const renderSimulation = (simulationResult) => {
  const firstSlice = simulationResult.sliceResults[0] ?? null;
  renderBaselines(firstSlice?.baselineResults ?? null);
  renderLotus(firstSlice?.lotusResult ?? null);
  renderImprovement(firstSlice?.improvement ?? null);
  renderEligibility(firstSlice?.rolloutEligibility ?? null);
  renderSlices(simulationResult.sliceResults ?? []);
};

const requestJson = async (url, init) => {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...init
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.message === "string" ? body.message : typeof body.code === "string" ? body.code : "Request failed";
    throw new Error(message);
  }

  return body;
};

const loadScopes = async () => {
  setStatus("Loading scopes...", "loading");
  const query = new URLSearchParams();
  query.set("category", el.marketClass.value);
  query.set("marketClass", "BINARY");
  query.set("routeMode", el.routeMode.value);
  const payload = await requestJson(endpoints.scopes + "?" + query.toString(), { method: "GET" });
  state.scopes = Array.isArray(payload.scopes) ? payload.scopes : [];
  updateScopeOptions();
  if (!el.eventSelect.value) {
    resetCanonicalMarketSelect();
  }
  setStatus(state.scopes.length > 0 ? "Scopes loaded." : "No scopes available for this filter.", state.scopes.length > 0 ? "success" : "warning");
};

const loadCanonical = async () => {
  const eventId = el.eventSelect.value;
  if (!eventId) throw new Error("Select a canonical event first.");
  setStatus("Loading canonical coverage...", "loading");
  const payload = await requestJson(endpoints.canonical(eventId, el.canonicalMarketId.value || null), { method: "GET" });
  renderCanonical(payload);
  setStatus("Canonical coverage loaded.", "success");
};

const loadPersistedRun = async (runId) => {
  const [run, results] = await Promise.all([
    requestJson(endpoints.runDetail(runId), { method: "GET" }),
    requestJson(endpoints.runResults(runId), { method: "GET" })
  ]);
  renderRun(run);
  renderSlices(results.results ?? []);
};

const runSimulation = async (event) => {
  event.preventDefault();
  if (!el.eventSelect.value) {
    setStatus("Select a canonical event before running simulation.", "error");
    return;
  }
  const selectedMarketId = el.canonicalMarketId.value || null;
  const runnableMarkets = state.canonicalMarkets.filter((market) => isRunnableForSelectedRouteMode(market));
  if (!selectedMarketId && runnableMarkets.length > 1) {
    setStatus("Choose one exact canonical market before running this route mode.", "error");
    return;
  }
  if (selectedMarketId) {
    const selectedMarket = state.canonicalMarkets.find((market) => market.canonicalMarketId === selectedMarketId) ?? null;
    if (!isRunnableForSelectedRouteMode(selectedMarket)) {
      setStatus("Selected canonical market is unavailable for this route mode.", "error");
      return;
    }
  }

  const body = {
    marketClass: "BINARY",
    routeMode: el.routeMode.value,
    canonicalEventId: el.eventSelect.value,
    canonicalMarketId: selectedMarketId || undefined,
    side: el.side.value,
    requestedNotional: el.requestedNotional.value,
    from: new Date(el.from.value).toISOString(),
    to: new Date(el.to.value).toISOString(),
    strategyKey: el.strategyKey.value,
    dryRun: el.dryRun.checked
  };

  el.submit.disabled = true;
  setStatus("Running historical simulation...", "loading");

  try {
    const payload = await requestJson(endpoints.run, { method: "POST", body: JSON.stringify(body) });
    renderSimulation(payload.simulationResult);
    renderRun({
      run: payload.run,
      simulationResult: {
        ...payload.simulationResult,
        metadata: { strategyKey: body.strategyKey }
      }
    });
    state.latestRunId = payload.run ? payload.run.id : null;
    if (state.latestRunId) {
      await loadPersistedRun(state.latestRunId);
    }
    setStatus("Historical simulation complete.", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Simulation failed.", "error");
  } finally {
    el.submit.disabled = false;
  }
};

window.addEventListener("DOMContentLoaded", () => {
  el.form = document.getElementById("simulation-run-form");
  el.scopeRefresh = document.getElementById("refresh-scopes");
  el.canonicalRefresh = document.getElementById("refresh-canonical");
  el.runRefresh = document.getElementById("refresh-run");
  el.status = document.getElementById("console-status");
  el.eventSelect = document.getElementById("canonical-event");
  el.marketClass = document.getElementById("market-class");
  el.routeMode = document.getElementById("route-mode");
  el.from = document.getElementById("time-from");
  el.to = document.getElementById("time-to");
  el.side = document.getElementById("order-side");
  el.requestedNotional = document.getElementById("requested-notional");
  el.strategyKey = document.getElementById("strategy-key");
  el.canonicalMarketId = document.getElementById("canonical-market");
  el.dryRun = document.getElementById("dry-run");
  el.submit = document.getElementById("run-submit");
  el.canonical = document.getElementById("canonical-summary");
  el.run = document.getElementById("run-summary");
  el.baselines = document.getElementById("baseline-results");
  el.lotus = document.getElementById("lotus-result");
  el.improvement = document.getElementById("improvement-metrics");
  el.eligibility = document.getElementById("rollout-eligibility");
  el.slices = document.getElementById("slice-results");
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  el.from.value = oneHourAgo.toISOString().slice(0, 16);
  el.to.value = now.toISOString().slice(0, 16);
  resetCanonicalMarketSelect();

  el.scopeRefresh.addEventListener("click", () => loadScopes().catch((error) => setStatus(error.message, "error")));
  el.canonicalRefresh.addEventListener("click", () => loadCanonical().catch((error) => setStatus(error.message, "error")));
  el.runRefresh.addEventListener("click", () => {
    if (!state.latestRunId) {
      setStatus("No persisted run is loaded yet.", "error");
      return;
    }
    loadPersistedRun(state.latestRunId).then(() => setStatus("Persisted run refreshed.", "success")).catch((error) => setStatus(error.message, "error"));
  });

  el.marketClass.addEventListener("change", () => loadScopes().catch((error) => setStatus(error.message, "error")));
  el.routeMode.addEventListener("change", () => {
    Promise.resolve()
      .then(() => loadScopes())
      .then(() => (el.eventSelect.value ? loadCanonical() : undefined))
      .catch((error) => setStatus(error.message, "error"));
  });
  el.eventSelect.addEventListener("change", () => {
    resetCanonicalMarketSelect();
    loadCanonical().catch((error) => setStatus(error.message, "error"));
  });
  el.canonicalMarketId.addEventListener("change", () => loadCanonical().catch((error) => setStatus(error.message, "error")));
  el.form.addEventListener("submit", runSimulation);

  loadScopes().catch((error) => setStatus(error.message, "error"));
});
`;

export const renderSimulationConsolePage = (): string => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Lotus Internal Simulation Console</title>
    <style>
      :root {
        --bg: #f4f1e8;
        --panel: #fffdf7;
        --ink: #1e1a14;
        --muted: #6c655a;
        --line: #d7cfbf;
        --accent: #9b3d24;
        --ok: #23633b;
        --error: #8f1d1d;
        --warn: #9c6a12;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        color: var(--ink);
        background: linear-gradient(180deg, #f8f4ea 0%, var(--bg) 100%);
      }
      main {
        max-width: 1280px;
        margin: 0 auto;
        padding: 24px;
      }
      h1, h2, h3 { margin: 0 0 12px; }
      .hero, .panel, .card {
        border: 1px solid var(--line);
        background: var(--panel);
        min-width: 0;
      }
      .hero, .panel { padding: 16px; }
      .hero { margin-bottom: 16px; }
      .grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(12, minmax(0, 1fr));
      }
      .panel { grid-column: span 12; }
      .form-panel { grid-column: span 4; }
      .summary-panel { grid-column: span 8; }
      .result-panel { grid-column: span 6; }
      .controls { display: grid; gap: 12px; }
      label { display: grid; gap: 6px; font-size: 14px; font-weight: 600; }
      input, select, button { font: inherit; }
      input, select {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid var(--line);
        background: #fff;
      }
      button {
        padding: 10px 14px;
        border: 1px solid #7f311e;
        background: var(--accent);
        color: #fff9f3;
        cursor: pointer;
      }
      button.secondary {
        border-color: var(--line);
        background: #efe7d8;
        color: var(--ink);
      }
      .button-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .checkbox-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .status {
        margin-top: 12px;
        padding: 10px 12px;
        border: 1px solid var(--line);
        background: #fbf8f1;
      }
      .status[data-kind="success"] { color: var(--ok); }
      .status[data-kind="error"] { color: var(--error); }
      .status[data-kind="loading"],
      .status[data-kind="warning"] { color: var(--warn); }
      .cards, .summary-stack {
        display: grid;
        gap: 12px;
      }
      .cards {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: start;
      }
      .card {
        padding: 12px;
        min-width: 0;
        overflow: hidden;
      }
      .callout { margin: 0 0 10px; }
      .lead {
        color: var(--ink);
        line-height: 1.5;
        margin: 0 0 12px;
      }
      .muted { color: var(--muted); }
      .badge {
        display: inline-block;
        padding: 3px 8px;
        border-radius: 999px;
        border: 1px solid var(--line);
        font-size: 12px;
        font-weight: 700;
      }
      .success { background: #e1f0e6; color: var(--ok); }
      .danger { background: #f8e1e1; color: var(--error); }
      .warning { background: #f4ebd3; color: var(--warn); }
      .neutral { background: #ece6da; color: var(--ink); }
      .kv { display: grid; gap: 8px; margin: 0; }
      .kv div {
        display: grid;
        grid-template-columns: 160px 1fr;
        gap: 12px;
        min-width: 0;
      }
      .kv dt { font-weight: 700; color: var(--muted); }
      .kv dd { margin: 0; word-break: break-word; }
      .table-wrap {
        width: 100%;
        max-width: 100%;
        overflow-x: auto;
        overflow-y: hidden;
        margin-top: 12px;
      }
      .table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
        min-width: 0;
      }
      .table th, .table td {
        padding: 8px 10px;
        border: 1px solid var(--line);
        text-align: left;
        vertical-align: top;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .table th { background: #f1eadb; }
      .compact-table {
        min-width: 640px;
        font-size: 12px;
      }
      .compact-table th,
      .compact-table td {
        padding: 6px 8px;
      }
      .details { margin-top: 12px; }
      .details summary { cursor: pointer; font-weight: 700; }
      pre {
        margin: 10px 0 0;
        padding: 12px;
        overflow: auto;
        border: 1px solid var(--line);
        background: #fbf8f1;
        font-family: Consolas, "Courier New", monospace;
        font-size: 12px;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .endpoint-note {
        margin-top: 10px;
        font-size: 12px;
        color: var(--muted);
      }
      @media (max-width: 1180px) {
        .cards { grid-template-columns: 1fr; }
      }
      @media (max-width: 960px) {
        .form-panel, .summary-panel, .result-panel { grid-column: span 12; }
        .cards { grid-template-columns: 1fr; }
        .kv div { grid-template-columns: 1fr; gap: 4px; }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <h1>Internal Historical Simulation Console</h1>
        <p class="muted">Admin-only testing surface for exact-market route discovery and historical simulation across Predexon, Limitless, Opinion, Myriad, and Predict.</p>
        <div id="console-status" class="status" data-kind="idle">Console ready.</div>
      </section>

      <section class="grid">
        <section class="panel form-panel">
          <h2>Run Simulation</h2>
          <form id="simulation-run-form" class="controls">
            <label>
              Route Mode
              <select id="route-mode" name="routeMode">
                <option value="POLYMARKET_ONLY">Predexon Only</option>
                <option value="LIMITLESS_ONLY">Limitless Only</option>
                <option value="OPINION_ONLY">Opinion Only</option>
                <option value="MYRIAD_ONLY">Myriad Only</option>
                <option value="PREDICT_ONLY">Predict Only</option>
                <option value="POLYMARKET_LIMITLESS">Predexon + Limitless</option>
                <option value="POLYMARKET_OPINION">Predexon + Opinion</option>
                <option value="LIMITLESS_OPINION">Limitless + Opinion</option>
                <option value="POLYMARKET_LIMITLESS_OPINION">Predexon + Limitless + Opinion</option>
                <option value="POLYMARKET_PREDICT">Predexon + Predict</option>
                <option value="LIMITLESS_PREDICT">Limitless + Predict</option>
                <option value="OPINION_PREDICT">Opinion + Predict</option>
              </select>
            </label>
            <label>
              Side
              <select id="order-side" name="side">
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
              </select>
            </label>
            <label>
              Category
              <select id="market-class" name="marketClass">
                <option value="SPORTS">SPORTS</option>
                <option value="CRYPTO">CRYPTO</option>
                <option value="POLITICS">POLITICS</option>
                <option value="ESPORTS">ESPORTS</option>
              </select>
            </label>
            <label>
              Canonical Event
              <select id="canonical-event" name="canonicalEventId">
                <option value="">Select canonical event</option>
              </select>
            </label>
            <label>
              Canonical Market ID (Optional)
              <select id="canonical-market" name="canonicalMarketId">
                <option value="">Select market ID (Optional)</option>
              </select>
            </label>
            <label>
              From
              <input id="time-from" name="from" type="datetime-local" required />
            </label>
            <label>
              To
              <input id="time-to" name="to" type="datetime-local" required />
            </label>
            <label>
              Strategy Key
              <input id="strategy-key" name="strategyKey" type="text" placeholder="strategy.phase4.internal" required />
            </label>
            <label>
              Requested Notional
              <input id="requested-notional" name="requestedNotional" type="number" min="0.01" step="0.01" value="100" required />
            </label>
            <label class="checkbox-row">
              <input id="dry-run" name="dryRun" type="checkbox" />
              Dry Run
            </label>
            <div class="button-row">
              <button id="run-submit" type="submit">Run Simulation</button>
              <button id="refresh-scopes" class="secondary" type="button">Refresh Scopes</button>
              <button id="refresh-canonical" class="secondary" type="button">Refresh Canonical</button>
              <button id="refresh-run" class="secondary" type="button">Refresh Run</button>
            </div>
          </form>
          <div class="endpoint-note">
            Uses: <code>GET /admin/simulation/scopes</code>,
            <code>POST /admin/simulation/run</code>,
            <code>GET /admin/simulation/canonical/:eventId</code>,
            <code>GET /admin/simulation/run/:id</code>,
            <code>GET /admin/simulation/run/:id/results</code>
          </div>
        </section>

        <section class="panel summary-panel">
          <h2>Canonical Mapping Summary</h2>
          <div id="canonical-summary"><p class="muted">No canonical event loaded yet.</p></div>
          <h2 style="margin-top:16px;">Run Metadata And Status</h2>
          <div id="run-summary"><p class="muted">No simulation run yet.</p></div>
        </section>

        <section class="panel result-panel">
          <h2>Baseline Results</h2>
          <div id="baseline-results"><p class="muted">Run a simulation to view baseline comparisons.</p></div>
        </section>

        <section class="panel result-panel">
          <h2>Lotus Result</h2>
          <div id="lotus-result"><p class="muted">Run a simulation to view the Lotus path.</p></div>
        </section>

        <section class="panel result-panel">
          <h2>Improvement Metrics</h2>
          <div id="improvement-metrics"><p class="muted">Run a simulation to view improvement comparisons.</p></div>
        </section>

        <section class="panel result-panel">
          <h2>Rollout Eligibility Outcome</h2>
          <div id="rollout-eligibility"><p class="muted">Run a simulation to view rollout eligibility.</p></div>
        </section>

        <section class="panel">
          <h2>Slice Results</h2>
          <div id="slice-results"><p class="muted">No slice results yet.</p></div>
        </section>
      </section>
    </main>
    <script>${clientScript}</script>
  </body>
</html>
`;
