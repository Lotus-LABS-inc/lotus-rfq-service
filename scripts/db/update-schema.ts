
import pg from 'pg';
const { Pool } = pg;

async function run() {
    const connectionString = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('SUPABASE_DB_URL or DATABASE_URL is required.');
    }
    const pool = new Pool({ connectionString });
    try {
        console.log('Adding columns if missing...');
        await pool.query('ALTER TABLE route_steps ADD COLUMN IF NOT EXISTS rounded_size NUMERIC;');
        await pool.query('ALTER TABLE route_steps ADD COLUMN IF NOT EXISTS target_price NUMERIC;');
        await pool.query('ALTER TABLE route_steps ADD COLUMN IF NOT EXISTS metadata JSONB;');
        console.log('Columns added successfully.');
    } catch (err) {
        console.error('Error adding columns:', err);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

run();
