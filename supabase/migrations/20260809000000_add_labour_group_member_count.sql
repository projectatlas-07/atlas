alter table public.labour_groups
  add column member_count integer;

alter table public.labour_groups
  add constraint labour_groups_member_count_check
  check (member_count is null or member_count > 0);
