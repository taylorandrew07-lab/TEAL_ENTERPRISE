// Applies supabase/migrations/*.sql to the database in DATABASE_URL, recording each
// in supabase_migrations.schema_migrations (so the Supabase CLI sees them as applied),
// then applies supabase/seed/seed.sql. Each migration runs atomically.
// Usage: DATABASE_URL=... node scripts/db-migrate.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const migDir = join(root, 'supabase', 'migrations');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
const q = (sql, params) => client.query(sql, params);

async function main() {
  await client.connect();
  await q('create schema if not exists supabase_migrations');
  await q(
    'create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)',
  );
  const applied = new Set(
    (await q('select version from supabase_migrations.schema_migrations')).rows.map((r) => r.version),
  );

  const files = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const version = f.split('_')[0];
    const name = f.replace(/^\d+_/, '').replace(/\.sql$/, '');
    if (applied.has(version)) {
      console.log(`skip   ${f} (already applied)`);
      continue;
    }
    const sql = readFileSync(join(migDir, f), 'utf8');
    process.stdout.write(`apply  ${f} ... `);
    try {
      await q('begin');
      await q(sql);
      await q('insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)', [version, name]);
      await q('commit');
      console.log('OK');
    } catch (e) {
      await q('rollback').catch(() => {});
      console.error('FAILED\n  ' + e.message);
      await client.end();
      process.exit(1);
    }
  }

  const seed = readFileSync(join(root, 'supabase', 'seed', 'seed.sql'), 'utf8');
  process.stdout.write('apply  seed.sql ... ');
  try {
    await q('begin');
    await q(seed);
    await q('commit');
    console.log('OK');
  } catch (e) {
    await q('rollback').catch(() => {});
    console.error('SEED FAILED\n  ' + e.message);
    await client.end();
    process.exit(1);
  }

  await client.end();
  console.log('\nALL MIGRATIONS + SEED APPLIED');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
