import pg from 'pg';
const { Client } = pg;

async function run() {
  const connectionString = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('SUPABASE_DB_URL or DATABASE_URL is required.');
  }
  const c = new Client({connectionString});
  await c.connect();
  const cryptoEventId = '22222222-2222-4222-8222-222222222222';

    const profileBTC90KPoly = {
      id: "33333333-3333-4333-8333-333333333333",
      venue: "POLYMARKET",
      venue_market_id: "polymarket-crypto-btc-60k",
      canonical_event_id: cryptoEventId,
      canonical_market_id: "POLYMARKET-BTC-ALL-TIME-HIGH-BY-2026-03-31",
      oracle_type: "ORACLE",
      oracle_name: "POLYMARKET",
      resolution_authority_type: "CENTRAL",
      primary_resolution_text: "Bitcoin all time high by March 31, 2026?",
      market_type: "BINARY"
    };

    const profileBTC90KLim = {
      id: "44444444-4444-4444-8444-444444444444",
      venue: "LIMITLESS",
      venue_market_id: "limitless-crypto-btc-60k",
      canonical_event_id: cryptoEventId,
      canonical_market_id: "LIMITLESS-BTC-ABOVE-90K",
      oracle_type: "ORACLE",
      oracle_name: "LIMITLESS",
      resolution_authority_type: "CENTRAL",
      primary_resolution_text: "BTC over $90k",
      market_type: "BINARY"
    };

    const profileBTC90KLegacy = {
      id: "55555555-5555-4555-8555-555555555555",
      venue: "POLYMARKET",
      venue_market_id: "polymarket-crypto-btc-90k-deprecated",
      canonical_event_id: cryptoEventId,
      canonical_market_id: "BTC-90K-LEGACY",
      oracle_type: "ORACLE",
      oracle_name: "POLYMARKET",
      resolution_authority_type: "CENTRAL",
      primary_resolution_text: "BTC over $90k (Legacy Contract)",
      market_type: "BINARY"
    };

    for (const p of [profileBTC90KPoly, profileBTC90KLim, profileBTC90KLegacy]) {
      await c.query(`
        INSERT INTO resolution_profiles 
        (id, venue, venue_market_id, canonical_event_id, canonical_market_id, oracle_type, oracle_name, resolution_authority_type, primary_resolution_text, market_type)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET 
          canonical_market_id = EXCLUDED.canonical_market_id,
          primary_resolution_text = EXCLUDED.primary_resolution_text
      `, [p.id, p.venue, p.venue_market_id, p.canonical_event_id, p.canonical_market_id, p.oracle_type, p.oracle_name, p.resolution_authority_type, p.primary_resolution_text, p.market_type]);
    }

  console.log('Seeded.');
  await c.end();
}
run();
