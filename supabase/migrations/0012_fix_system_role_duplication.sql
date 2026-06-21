-- =============================================================================
-- TEAL Enterprise — Migration 0012: de-duplicate system roles + idempotent re-seed
-- -----------------------------------------------------------------------------
-- core.roles has UNIQUE (company_id, key). System roles use company_id = NULL, and
-- Postgres treats NULLs as DISTINCT in a unique index — so the seed's
-- `on conflict (company_id, key) do nothing` never matched system roles, and every
-- re-run of the seed (i.e. every deploy) inserted a fresh full set of them. Over ~10
-- deploys that produced 10 copies of every system role (and bloated role_permissions
-- via the cross-join grants).
--
-- This migration collapses each system role to a single canonical row (the lowest id
-- per key — uuid has no min() aggregate, so we use `order by id limit 1`), repoints all
-- references to it, and adds a PARTIAL unique index on (key) where company_id is null so
-- future re-seeds are idempotent. Re-running the whole migration is itself safe.
-- =============================================================================

-- 1. Repoint memberships from duplicate system roles to the canonical row.
update core.company_memberships m
set role_id = (
  select r2.id from core.roles r2
  where r2.company_id is null and r2.key = dup.key
  order by r2.id limit 1
)
from core.roles dup
where m.role_id = dup.id
  and dup.company_id is null
  and dup.id <> (
    select r2.id from core.roles r2
    where r2.company_id is null and r2.key = dup.key
    order by r2.id limit 1
  );

-- 2. Drop grants attached to duplicate system roles (the canonical row keeps its own).
delete from core.role_permissions rp
using core.roles dup
where rp.role_id = dup.id
  and dup.company_id is null
  and dup.id <> (
    select r2.id from core.roles r2
    where r2.company_id is null and r2.key = dup.key
    order by r2.id limit 1
  );

-- 3. Delete the duplicate system role rows.
delete from core.roles dup
where dup.company_id is null
  and dup.id <> (
    select r2.id from core.roles r2
    where r2.company_id is null and r2.key = dup.key
    order by r2.id limit 1
  );

-- 4. Prevent recurrence: a normal UNIQUE(company_id, key) cannot dedupe NULL company_id,
--    so enforce system-role key uniqueness with a partial unique index. The seed's
--    role inserts use `on conflict (key) where company_id is null do nothing` against it.
create unique index if not exists roles_system_key_uniq on core.roles (key) where company_id is null;
