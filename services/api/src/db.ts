import { Pool } from 'pg';
import { config } from './config.js';

export const pool = new Pool({ connectionString: config.databaseUrl });

export type DbClient = Pool | import('pg').PoolClient;

export async function tx<T>(fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
