begin;

-- security: harden public default privileges and excess ACLs
-- Atlas migration creator is postgres. Preserve supabase_admin defaults.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- Future function default hardening is PARTIAL: built-in PUBLIC EXECUTE remains.
-- Every future Atlas function-creating migration must explicitly revoke unwanted
-- PUBLIC/anon/authenticated access on that exact function, then grant as needed.
-- Deliberately do not change postgres owner-wide defaults or managed schemas.

revoke all privileges on table public.factory_users from anon;
revoke all privileges on table public.labourers from anon;
revoke all privileges on table public.production_entries from anon;

-- Exact Atlas trigger functions only. Preserve authenticated/service_role grants,
-- bodies, ownership, SECURITY DEFINER, search_path and trigger definitions.
revoke execute on function public.audit_mud_accounting_state_transition() from public, anon;
revoke execute on function public.initialize_mud_accounting_state() from public, anon;
revoke execute on function public.prevent_staff_payment_mutation() from public, anon;
revoke execute on function public.prevent_staff_worker_reassignment() from public, anon;
revoke execute on function public.protect_mud_accounting_state_transition() from public, anon;
revoke execute on function public.reject_mud_settlement_mutation() from public, anon;
revoke execute on function public.reject_production_settlement_mutation() from public, anon;
revoke execute on function public.set_updated_at() from public, anon;

commit;
