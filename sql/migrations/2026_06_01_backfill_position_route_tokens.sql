WITH route_legs AS (
  SELECT
    execution.user_id,
    execution.selected_route ->> 'marketId' AS market_id,
    execution.selected_route ->> 'outcomeId' AS outcome_id,
    upper(leg ->> 'venue') AS venue,
    nullif(leg ->> 'venueMarketId', '') AS venue_market_id,
    nullif(leg ->> 'venueOutcomeId', '') AS venue_outcome_id,
    execution.updated_at,
    row_number() OVER (
      PARTITION BY
        execution.user_id,
        upper(leg ->> 'venue'),
        execution.selected_route ->> 'marketId',
        execution.selected_route ->> 'outcomeId'
      ORDER BY execution.updated_at DESC
    ) AS row_number
  FROM signed_trade_bundle_executions execution
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(execution.selected_route -> 'legs', '[]'::jsonb)) AS leg
  WHERE execution.selected_route IS NOT NULL
    AND nullif(leg ->> 'venueOutcomeId', '') IS NOT NULL
),
latest_route_leg AS (
  SELECT *
  FROM route_legs
  WHERE row_number = 1
)
UPDATE user_execution_positions position
SET metadata = coalesce(position.metadata, '{}'::jsonb)
  || jsonb_strip_nulls(jsonb_build_object(
    'venueMarketId', latest_route_leg.venue_market_id,
    'venueOutcomeId', latest_route_leg.venue_outcome_id,
    'positionTokenBackfill', jsonb_build_object(
      'source', 'signed_trade_bundle_executions.selected_route',
      'appliedAt', now()
    )
  )),
  updated_at = now()
FROM latest_route_leg
WHERE position.user_id = latest_route_leg.user_id
  AND position.venue = latest_route_leg.venue
  AND position.market_id = latest_route_leg.market_id
  AND position.outcome_id = latest_route_leg.outcome_id
  AND coalesce(position.metadata ->> 'venueOutcomeId', '') = ''
  AND latest_route_leg.venue_outcome_id IS NOT NULL;
