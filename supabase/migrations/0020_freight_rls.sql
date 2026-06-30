-- =============================================================================
-- TEAL Enterprise — Migration 0020: Freight Forwarding RLS, grants, audit
-- -----------------------------------------------------------------------------
-- Enables RLS on every freight table. Tenant policies mirror the accounting/cargo
-- style: SELECT requires active company membership (or super admin); INSERT/UPDATE/
-- DELETE require the relevant freight.* permission on the row's company. Helpers are
-- wrapped in scalar sub-selects so they evaluate once per statement, not per row.
-- Tenant isolation is never weakened. See docs/freight/_FREIGHT-SPEC.md §8 and
-- docs/security-and-permissions.md.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schema + object grants. RLS does the gating; grants merely allow the
-- authenticated role to attempt access. anon gets nothing; service_role bypasses.
-- -----------------------------------------------------------------------------
grant usage on schema freight to authenticated;
grant select, insert, update, delete on all tables in schema freight to authenticated;

-- -----------------------------------------------------------------------------
-- Standard tenant tables: read = active membership; write = relevant permission.
-- (table, write-permission) — every table carries company_id.
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select * from (values
      -- CRM
      ('contacts',                 'freight.contacts.manage'),
      ('contact_people',           'freight.contacts.manage'),
      -- shipments & operations
      ('shipments',                'freight.shipments.manage'),
      ('shipment_parties',         'freight.shipments.manage'),
      ('milestones',               'freight.shipments.manage'),
      ('tasks',                    'freight.shipments.manage'),
      ('task_comments',            'freight.shipments.manage'),
      -- quotes
      ('quote_requests',           'freight.quotes.manage'),
      ('quote_request_recipients', 'freight.quotes.manage'),
      ('supplier_quotes',          'freight.quotes.manage'),
      ('customer_quotes',          'freight.quotes.manage'),
      ('quote_lines',              'freight.quotes.manage'),
      -- containers
      ('containers',               'freight.containers.manage'),
      -- communications & email
      ('communications',           'freight.comms.manage'),
      ('mailboxes',                'freight.comms.manage'),
      ('email_links',              'freight.comms.manage'),
      -- finance
      ('charges',                  'freight.finance.manage'),
      -- AI seams
      ('prompts',                  'freight.ai.manage'),
      ('ai_jobs',                  'freight.ai.manage')
    ) as t(tbl, perm)
  loop
    execute format('alter table freight.%I enable row level security', r.tbl);

    execute format(
      'create policy %I on freight.%I for select using ((select core.is_super_admin()) or company_id in (select core.user_companies()))',
      r.tbl || '_sel', r.tbl);

    execute format(
      'create policy %I on freight.%I for insert with check ((select core.has_permission(company_id, %L)))',
      r.tbl || '_ins', r.tbl, r.perm);

    execute format(
      'create policy %I on freight.%I for update using ((select core.has_permission(company_id, %L))) with check ((select core.has_permission(company_id, %L)))',
      r.tbl || '_upd', r.tbl, r.perm, r.perm);

    execute format(
      'create policy %I on freight.%I for delete using ((select core.has_permission(company_id, %L)))',
      r.tbl || '_del', r.tbl, r.perm);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Audit coverage for security-significant freight tables. Same SECURITY DEFINER
-- core.audit_trigger() used by accounting/cargo, so the operational + financial
-- trail (shipments, customer quotes, charges, mailboxes, AI jobs, comms) is
-- tamper-evident.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'shipments', 'customer_quotes', 'charges', 'mailboxes', 'ai_jobs', 'communications'
  ] loop
    execute format(
      'create trigger trg_audit after insert or update or delete on freight.%I for each row execute function core.audit_trigger()',
      t);
  end loop;
end $$;
