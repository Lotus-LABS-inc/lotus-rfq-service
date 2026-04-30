
import pg from 'pg';
const { Pool } = pg;

async function run() {
    const connectionString = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('SUPABASE_DB_URL or DATABASE_URL is required.');
    }
    const pool = new Pool({ connectionString });
    try {
        console.log('Checking columns for route_steps...');
        const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'route_steps'");
        console.log('Columns:');
        res.rows.forEach(r => console.log(` - ${r.column_name}`));
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

run();
