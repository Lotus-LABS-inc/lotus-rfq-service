-- Correct the frontend-approved Trump office-exit Polymarket mapping.
-- A prior curated artifact pointed the Trump lane at the Starmer Polymarket slug,
-- which prevented Polymarket quote/orderbook/media hydration for the terminal.

UPDATE venue_market_profiles
   SET venue_market_id = 'POLYMARKET:trump-out-as-president-before-2027:OFFICE_EXIT_BY_DATE|USA|US_PRESIDENT|DONALD_TRUMP|2026-12-31|YES',
       normalized_payload = (normalized_payload - 'quoteVerificationBlockers' - 'quoteVerificationSource' - 'quoteVerificationCheckedAt')
         || jsonb_build_object(
              'venueMarketId', 'trump-out-as-president-before-2027',
              'quoteMarketId', '0x48b0b0bca515f68fccf95af4793dbd0edbfec1f8ec6e8df2c0f69ba74f8c4722',
              'quoteTokenId', '59252515735652674747158950210016502214756531287333895140318848923768750410355',
              'quoteOutcomeLabel', 'Yes',
              'quoteOutcomeTokenIds', jsonb_build_object(
                'YES', '59252515735652674747158950210016502214756531287333895140318848923768750410355',
                'NO', '2849827372590072151380088930233312280478318575453624773762283369907909283027'
              ),
              'quoteSource', 'polymarket_official_api_manual_fix',
              'quoteMatchedIdentifier', 'trump-out-as-president-before-2027',
              'quoteMetadataVersion', 'polymarket-trump-office-exit-fix-v1',
              'quoteEnrichedAt', now()::text,
              'imageUrl', 'https://polymarket-upload.s3.us-east-2.amazonaws.com/trump-out-as-president-by-march-31-c3SENQhH7Ao1.jpg',
              'iconUrl', 'https://polymarket-upload.s3.us-east-2.amazonaws.com/trump-out-as-president-by-march-31-c3SENQhH7Ao1.jpg'
            ),
       raw_source_payload = raw_source_payload
         || jsonb_build_object(
              'venueMarketId', 'trump-out-as-president-before-2027',
              'imageUrl', 'https://polymarket-upload.s3.us-east-2.amazonaws.com/trump-out-as-president-by-march-31-c3SENQhH7Ao1.jpg',
              'iconUrl', 'https://polymarket-upload.s3.us-east-2.amazonaws.com/trump-out-as-president-by-march-31-c3SENQhH7Ao1.jpg',
              'quoteEvidence', jsonb_build_object(
                'source', 'polymarket_official_api_manual_fix',
                'conditionId', '0x48b0b0bca515f68fccf95af4793dbd0edbfec1f8ec6e8df2c0f69ba74f8c4722',
                'marketId', '666861',
                'marketSlug', 'trump-out-as-president-before-2027',
                'matchedIdentifier', 'trump-out-as-president-before-2027',
                'outcomeLabels', jsonb_build_array('Yes', 'No'),
                'metadataVersion', 'polymarket-trump-office-exit-fix-v1',
                'enrichedAt', now()::text
              )
            ),
       updated_at = now()
 WHERE venue = 'POLYMARKET'
   AND venue_market_id = 'POLYMARKET:starmer-out-in-2025:OFFICE_EXIT_BY_DATE|USA|US_PRESIDENT|DONALD_TRUMP|2026-12-31|YES';
