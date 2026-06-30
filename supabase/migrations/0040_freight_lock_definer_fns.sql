-- =============================================================================
-- TEAL Enterprise — Migration 0040: lock internal SECURITY DEFINER functions
-- + tighten AI-settings read (independent code review — P0 + a config-read tighten)
-- -----------------------------------------------------------------------------
-- P0: freight.enqueue_notification is SECURITY DEFINER and, like every freshly
-- created function, had EXECUTE granted to PUBLIC — so ANY caller (verified: even
-- anonymous, via POST /rest/v1/rpc/enqueue_notification) could enqueue
-- attacker-controlled in-app notifications and customer emails for any shipment.
-- It is only ever meant to be called BY the notification triggers (which run as the
-- function owner and are unaffected by these revokes). Mirrors the 0031 lock of
-- freight.next_reference. seed_task/seed_milestone get the same treatment (internal
-- helpers, only called by apply_stage_automation).
-- =============================================================================

revoke execute on function freight.enqueue_notification(uuid, uuid, freight.notification_kind, text, text) from public;
revoke execute on function freight.enqueue_notification(uuid, uuid, freight.notification_kind, text, text) from anon;
revoke execute on function freight.enqueue_notification(uuid, uuid, freight.notification_kind, text, text) from authenticated;

revoke execute on function freight.seed_task(uuid, uuid, text, text, freight.task_priority) from public;
revoke execute on function freight.seed_task(uuid, uuid, text, text, freight.task_priority) from anon;
revoke execute on function freight.seed_task(uuid, uuid, text, text, freight.task_priority) from authenticated;

revoke execute on function freight.seed_milestone(uuid, uuid, freight.milestone_key) from public;
revoke execute on function freight.seed_milestone(uuid, uuid, freight.milestone_key) from anon;
revoke execute on function freight.seed_milestone(uuid, uuid, freight.milestone_key) from authenticated;

-- Tighten freight.ai_task_settings SELECT: it was readable by any active company
-- member (company_id in core.user_companies()), broader than the freight.ai.manage
-- gate that protects writes. Restrict reads to the same permission.
drop policy if exists ai_task_settings_sel on freight.ai_task_settings;
create policy ai_task_settings_sel on freight.ai_task_settings for select
  using ((select core.is_super_admin()) or (select core.has_permission(company_id, 'freight.ai.manage')));
