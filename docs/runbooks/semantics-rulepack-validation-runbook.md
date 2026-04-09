# Semantics Rulepack Validation Runbook

## Purpose
The semantics rulepack exists to widen candidate discovery across venues when materially equivalent propositions use different wording.

It is allowed to:
- improve CanonicalEvent candidate discovery
- improve semantic explainability
- add bounded, replayable discovery confidence uplift
- surface near-miss and ambiguity information for operator review

It is not allowed to:
- mark markets as executable equivalents by itself
- bypass `CompatibilityDecision`
- bypass safe equivalence gating
- bypass execution eligibility rules
- silently turn fuzzy semantic similarity into pooled execution eligibility

## Safety Model
Semantic discovery is upstream and additive.

The authoritative safety chain remains:
1. semantic discovery and validation
2. compatibility scoring and `CompatibilityDecision`
3. routeability and execution eligibility

The validator fails closed when:
- timing semantics are ambiguous or mismatched
- outcome schemas differ
- resolution or settlement semantics differ
- compatibility already blocks pooling
- multiple exact candidates survive

## Provenance And Versioning
Every semantic candidate decision must carry:
- `semanticsRulepackVersion`
- semantic `evaluationId`
- fired rule IDs
- matched rule families
- matched semantic dimensions
- normalized proposition elements
- timing semantics
- outcome semantics
- ambiguity flags
- semantic confidence contribution
- `createdAt`
- replay linkage metadata

There are no unversioned semantic decisions.

## How To Inspect Fired Rules
Semantic provenance is emitted through the semantic candidate metadata and curation artifacts.

Inspect:
- `matchedRules`
- `matchedRuleFamilies`
- `semanticMatchReasons`
- `matchedSemanticDimensions`

The current Opinion curation artifact is:
- `docs/opinion-exact-match-curation.json`

## How To Inspect Semantic Confidence
Review the semantic validation payload:
- `baseConfidence`
- `semanticConfidenceContribution`
- `finalConfidence`
- `capped`
- `confidenceCapReason`
- `qualificationSummary`

Interpretation:
- uplift is acceptable only when semantics are exact enough and no critical ambiguity remains
- capped confidence means semantics found something useful, but policy containment still applied
- low-confidence semantic candidates should remain review material, not execution material

## How To Review Ambiguous Matches
Inspect:
- `ambiguityFlags`
- `failedDimensions`
- `semanticReasons`
- `requiresReview`

Typical ambiguity flags:
- `multiple_exact_candidates`
- `timing_semantics_ambiguous`
- `outcome_semantics_ambiguous`
- `resolution_semantics_ambiguous`
- `low_confidence_field_inference`
- `semantic_near_exact`

Operational rule:
- ambiguity may widen discovery
- ambiguity must not widen execution eligibility

## Discovery Expansion Vs Execution Safety
Discovery expansion means:
- a candidate is surfaced as related, exact-live-only, or near-exact
- the semantic validator may increase or cap discovery confidence

Execution safety still requires:
- downstream `CompatibilityDecision`
- safe equivalence or caution handling from compatibility
- routeability approval
- existing execution-control gating

If a candidate is semantically strong but compatibility is `DISTINCT` or `DO_NOT_POOL`, the semantic layer must stay blocked for execution.

## Metrics To Inspect
The semantic validation layer emits or can aggregate:
- `semantic_candidate_matches_total`
- `semantic_rules_fired_total`
- `semantic_confidence_uplift_total`
- `semantic_match_downgraded_total`
- `semantic_match_blocked_by_compatibility_total`
- `semantic_false_positive_review_total`
- `semantic_candidate_to_equivalent_conversion_rate`
- `semantic_candidate_to_distinct_rate`

Qualification-facing rollups:
- `safeDiscoveryLift`
- `cautionDiscoveryLift`
- `blockedUnsafeExpansionRate`
- `lowConfidenceSemanticRate`

Healthy interpretation:
- candidate matches increase
- safe discovery lift increases modestly
- blocked unsafe expansion rate remains non-zero when lookalikes exist
- low-confidence rate is visible, not hidden
- equivalent conversion rate does not spike without compatibility support

## Validation And Regression Commands
Run the targeted semantic integration suites:

```powershell
npm test -- tests/integration/semantics-rulepack-validation.integration.test.ts tests/integration/semantics-rulepack-regression.integration.test.ts tests/integration/semantics-rulepack-determinism.integration.test.ts
```

Run typecheck:

```powershell
npm run typecheck
```

If you regenerate Opinion curation after semantic rule updates:

```powershell
npm run generate:opinion:exact-match-curation
```

## Rollback Criteria
Roll back the active rulepack version if any of these occur:
- determinism tests fail for identical inputs and version
- blocked unsafe expansion rate drops unexpectedly while false-positive review rises
- semantic candidate to equivalent conversion rises without corresponding compatibility evidence
- timing/outcome/resolution mismatch cases stop being downgraded or blocked
- semantic decisions lose provenance or version metadata
- operators cannot explain why a semantic candidate was surfaced

Rollback action:
1. revert the rulepack version or rule changes
2. regenerate semantic artifacts
3. rerun the semantic validation and regression suites
4. verify routeability and execution behavior remain unchanged

## Operational Rule
Semantic lift is acceptable.

Semantic false-positive lift without compatibility containment is not.

