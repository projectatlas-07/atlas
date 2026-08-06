revoke select, insert, update on public.production_entries from anon;

drop policy if exists "Development anonymous production entry select"
  on public.production_entries;

drop policy if exists "Development anonymous production entry insert"
  on public.production_entries;

drop policy if exists "Development anonymous production entry update"
  on public.production_entries;
