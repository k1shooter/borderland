const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    const sql = fs.readFileSync(
      path.join(__dirname, '..', 'db', 'migrations', '001_initial.sql'),
      'utf8'
    );
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    process.stdout.write('Migration complete\n');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
