# Republican Nominee 2028 Pair Limited-Prod Review Checklist

- topic locked: NOMINEE|US_PRESIDENT|2028|REPUBLICAN
- approved pair: LIMITLESS|POLYMARKET
- approved candidates: donald_trump, donald_trump_jr, ted_cruz, tucker_carlson

## Required Checks

- confirm the review package is read-only and does not authorize rollout
- confirm every approved lane is `PAIR_EXACT_AUTO_ROUTEABLE`
- confirm every approved lane is `EXACT_RULE_COMPATIBLE`
- confirm no `Others` bucket is present in approved lanes
- confirm non-shared and unknown/composite outcomes remain excluded
- confirm no Democratic or tri lane is being promoted from this package

## Evidence

- donald_trump: LIMITLESS:Donald Trump | POLYMARKET:Donald Trump
- donald_trump_jr: LIMITLESS:Donald Trump Jr. | POLYMARKET:Donald Trump Jr.
- ted_cruz: LIMITLESS:Ted Cruz | POLYMARKET:Ted Cruz
- tucker_carlson: LIMITLESS:Tucker Carlson | POLYMARKET:Tucker Carlson

## Hold Conditions

- any rule compatibility drift away from exact-safe
- any candidate mismatch between LIMITLESS and POLYMARKET
- any attempt to add non-shared Republican names
- any attempt to widen scope beyond this exact topic and pair
