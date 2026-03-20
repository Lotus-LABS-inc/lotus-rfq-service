
import { Pool } from "pg";
import path from "node:path";
import { existsSync } from "node:fs";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const tables = ['historical_market_states', 'historical_simulation_runs', 'historical_simulation_results', 'resolution_profiles', 'resolution_risk_assessments'];
  for (const table of tables) {
    console.log(`\nTable: ${table}`);
    const res = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = $1
    `, [table]);
    res.rows.forEach(row => console.log(` - ${row.column_name} (${row.data_type})`));
  }
  await pool.end();
}

run().catch(console.error);
