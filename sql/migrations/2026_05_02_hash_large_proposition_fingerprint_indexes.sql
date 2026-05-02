-- Large live-market fingerprint keys can exceed Postgres btree tuple limits when
-- indexed as raw text. Keep the existing index names for operator checks, but
-- index fixed-width MD5 digests so canonical graph ingestion does not crash on
-- long proposition fingerprints.

DROP INDEX IF EXISTS idx_proposition_fingerprints_broad_key;
DROP INDEX IF EXISTS idx_proposition_fingerprints_strict_key;

CREATE INDEX IF NOT EXISTS idx_proposition_fingerprints_broad_key
    ON proposition_fingerprints((md5(broad_fingerprint_key)));

CREATE INDEX IF NOT EXISTS idx_proposition_fingerprints_strict_key
    ON proposition_fingerprints((md5(strict_fingerprint_key)));
