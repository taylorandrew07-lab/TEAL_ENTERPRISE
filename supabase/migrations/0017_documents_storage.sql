-- =============================================================================
-- TEAL Enterprise — Migration 0017: Documents storage bucket + company-scoped RLS
-- -----------------------------------------------------------------------------
-- Closes audit gap H1 (no Storage RLS). Creates a PRIVATE 'documents' bucket and
-- storage.objects policies that scope every file to a company by its first path
-- segment: objects live at <company_id>/<doc_id>/<filename>. Reads require active
-- membership of that company; writes additionally require documents.manage. core's
-- SECURITY DEFINER helpers (user_companies / has_permission) do the checks, so the
-- policy never trusts a client-supplied company id.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 26214400)  -- private, 25 MB cap
on conflict (id) do nothing;

-- Read: members of the company that owns the object's first path segment.
drop policy if exists "documents read by company members" on storage.objects;
create policy "documents read by company members" on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and exists (
      select 1 from core.user_companies() uc
      where uc::text = (storage.foldername(name))[1]
    )
  );

-- Write (insert/update/delete): documents.manage in that company.
drop policy if exists "documents insert with permission" on storage.objects;
create policy "documents insert with permission" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and exists (
      select 1 from core.user_companies() uc
      where uc::text = (storage.foldername(name))[1]
        and core.has_permission(uc, 'documents.manage')
    )
  );

drop policy if exists "documents update with permission" on storage.objects;
create policy "documents update with permission" on storage.objects for update to authenticated
  using (
    bucket_id = 'documents'
    and exists (
      select 1 from core.user_companies() uc
      where uc::text = (storage.foldername(name))[1]
        and core.has_permission(uc, 'documents.manage')
    )
  );

drop policy if exists "documents delete with permission" on storage.objects;
create policy "documents delete with permission" on storage.objects for delete to authenticated
  using (
    bucket_id = 'documents'
    and exists (
      select 1 from core.user_companies() uc
      where uc::text = (storage.foldername(name))[1]
        and core.has_permission(uc, 'documents.manage')
    )
  );
