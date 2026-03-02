const { Pool } = require('pg');
const config = require('../config');

let pool = null;

function getPool() {
  if (!config.databaseUrl) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

async function query(text, params = []) {
  const activePool = getPool();
  if (!activePool) {
    throw new Error('DATABASE_URL is not configured');
  }
  return activePool.query(text, params);
}

async function transaction(work) {
  const activePool = getPool();
  if (!activePool) {
    throw new Error('DATABASE_URL is not configured');
  }
  const client = await activePool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getPool,
  query,
  transaction,
};
