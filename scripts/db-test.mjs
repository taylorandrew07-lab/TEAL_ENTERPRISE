// Runs a SQL test file against DATABASE_URL, streaming RAISE NOTICE output and
// failing the process if any assertion raises. The test file is expected to manage
// its own begin/rollback. Usage: DATABASE_URL=... node scripts/db-test.mjs <file>
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const file = process.argv[2] ?? 'supabase/tests/accounting_engine_test.sql';
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
client.on('notice', (n) => console.log('  ' + (n.message ?? n)));

async function main() {
  await client.connect();
  const sql = readFileSync(resolve(file), 'utf8');
  try {
    await client.query(sql);
    console.log('\nTEST FILE COMPLETED (rolled back, no data persisted)');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    console.error('\nTEST FAILED: ' + e.message);
    await client.end();
    process.exit(1);
  }
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
