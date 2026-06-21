// Quick post-deploy sanity check: prints reference-data counts and a couple of
// integrity checks against DATABASE_URL.
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

const checks = [
  ['accounting.currencies', 'select count(*) from accounting.currencies'],
  ['accounting.account_types', 'select count(*) from accounting.account_types'],
  ['core.permissions', 'select count(*) from core.permissions'],
  ['core.roles (system)', "select count(*) from core.roles where is_system"],
  ['core.role_permissions', 'select count(*) from core.role_permissions'],
  ['core.modules', 'select count(*) from core.modules'],
  ['cargo.cargo_types', 'select count(*) from cargo.cargo_types'],
];

async function main() {
  await client.connect();
  console.log('Reference data on the live DB:');
  for (const [label, sql] of checks) {
    const n = (await client.query(sql)).rows[0].count;
    console.log(`  ${label.padEnd(26)} ${n}`);
  }
  // super_admin must hold every permission (the cross-join grant).
  const sa = (
    await client.query(
      "select (select count(*) from core.permissions) = (select count(*) from core.role_permissions rp join core.roles r on r.id = rp.role_id where r.key = 'super_admin') as ok",
    )
  ).rows[0].ok;
  console.log(`\n  super_admin holds all permissions: ${sa}`);
  // table counts per schema (proves the schemas built out)
  for (const sch of ['core', 'accounting', 'cargo']) {
    const n = (
      await client.query("select count(*) from information_schema.tables where table_schema = $1 and table_type='BASE TABLE'", [sch])
    ).rows[0].count;
    console.log(`  ${sch} base tables: ${n}`);
  }
  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
