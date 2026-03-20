-- Phase 4: Add granular canonical_market_id
ALTER TABLE resolution_profiles ADD COLUMN canonical_market_id TEXT;
ALTER TABLE resolution_risk_assessments ADD COLUMN canonical_market_id TEXT;

-- Update existing records - casting UUID to TEXT
UPDATE resolution_profiles SET canonical_market_id = canonical_event_id::text WHERE canonical_market_id IS NULL;
UPDATE resolution_risk_assessments SET canonical_market_id = canonical_event_id::text WHERE canonical_market_id IS NULL;

-- Make it NOT NULL for future safety
ALTER TABLE resolution_profiles ALTER COLUMN canonical_market_id SET NOT NULL;
ALTER TABLE resolution_risk_assessments ALTER COLUMN canonical_market_id SET NOT NULL;

-- Update unique constraint on assessments to includes market identity
ALTER TABLE resolution_risk_assessments DROP CONSTRAINT IF EXISTS uq_resolution_risk_assessment_pair_version;
ALTER TABLE resolution_risk_assessments ADD CONSTRAINT uq_resolution_risk_assessment_pair_version 
    UNIQUE (canonical_event_id, canonical_market_id, market_a_profile_id, market_b_profile_id, version);
