// One-time owner bootstrap: creates a single super-admin auth user (confirmed) and
// the owner's real company, membership, and enabled modules — so the owner can sign
// in and audit the app. No public signup; this is the only account until more are
// invited later. Idempotent (re-running resets the password and reuses the company).
//
// Env: SB_URL, SB_SERVICE_KEY, DATABASE_URL, ADMIN_EMAIL, [ADMIN_PASSWORD], [COMPANY_NAME]
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import crypto from 'node:crypto';

const SB_URL = process.env.SB_URL;
const SB_KEY = process.env.SB_SERVICE_KEY;
const DB = process.env.DATABASE_URL;
const email = process.env.ADMIN_EMAIL;
const companyName = process.env.COMPANY_NAME || 'Taylor Engineering Agencies Limited';
let password = process.env.ADMIN_PASSWORD;
if (!password) {
  password = 'Teal-' + crypto.randomBytes(12).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 14);
}

if (!SB_URL || !SB_KEY || !DB || !email) {
  console.error('Missing env (need SB_URL, SB_SERVICE_KEY, DATABASE_URL, ADMIN_EMAIL)');
  process.exit(1);
}

const sb = createClient(SB_URL, SB_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

// 1) auth user (create or reset password)
let userId;
const { data: created, error } = await sb.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: 'Andrew Taylor' },
});
if (error) {
  if (/registered|already|exists/i.test(error.message)) {
    const { data: list } = await sb.auth.admin.listUsers();
    const u = list.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
    if (!u) { console.error('user exists but not found in list'); process.exit(1); }
    userId = u.id;
    await sb.auth.admin.updateUserById(userId, { password, email_confirm: true });
    console.log('• auth user existed → password reset');
  } else {
    console.error('createUser failed:', error.message);
    process.exit(1);
  }
} else {
  userId = created.user.id;
  console.log('• created auth user', userId);
}

// 2) profile + company + membership + modules
const c = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
await c.connect();

await c.query(
  `insert into core.users (id, email, full_name, is_super_admin) values ($1, $2, 'Andrew Taylor', true)
   on conflict (id) do update set is_super_admin = true, email = excluded.email`,
  [userId, email],
);

let companyId = (await c.query('select id from core.companies where name = $1 limit 1', [companyName])).rows[0]?.id;
if (!companyId) {
  companyId = (
    await c.query(
      `insert into core.companies (name, legal_name, base_currency_code, country_code)
       values ($1, $1, 'TTD', 'TT') returning id`,
      [companyName],
    )
  ).rows[0].id;
  console.log('• created company', companyName);
} else {
  console.log('• company exists', companyName);
}

const roleId = (await c.query("select id from core.roles where key = 'company_admin' and is_system limit 1")).rows[0].id;
await c.query(
  `insert into core.company_memberships (user_id, company_id, role_id, status)
   values ($1, $2, $3, 'active') on conflict (user_id, company_id) do nothing`,
  [userId, companyId, roleId],
);

await c.query(
  `insert into core.company_modules (company_id, module_id, enabled)
   select $1, m.id, true from core.modules m where m.key in ('accounting', 'cargo_assurance')
   on conflict (company_id, module_id) do update set enabled = true`,
  [companyId],
);

const n = (await c.query(
  'select (select count(*)::int from core.users where is_super_admin) admins, (select count(*)::int from core.companies) companies',
)).rows[0];
await c.end();

console.log(`• super admins: ${n.admins} | companies: ${n.companies}`);
console.log('\n=== ACCESS READY ===');
console.log('Sign in : https://teal-enterprise.vercel.app/sign-in');
console.log('Email   :', email);
console.log('Password:', password);
