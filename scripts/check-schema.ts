
import pg from 'pg';
const { Pool } = pg;

async function run() {
    const connectionString = 'postgresql://postgres.qwkstkvsnqtvamjjfhxi:lotusmarkets2669@aws-1-eu-west-1.pooler.supabase.com:5432/postgres';
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
