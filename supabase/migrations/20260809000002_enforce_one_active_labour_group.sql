do $$
declare
  conflicting_factory_id uuid;
begin
  select labour_groups.factory_id
    into conflicting_factory_id
    from public.labour_groups
    where labour_groups.is_active
    group by labour_groups.factory_id
    having count(*) > 1
    limit 1;

  if conflicting_factory_id is not null then
    raise exception 'Cannot enforce one active labour group: factory % currently has multiple active groups.', conflicting_factory_id
      using errcode = 'P0001';
  end if;
end;
$$;

create unique index labour_groups_one_active_per_factory_idx
  on public.labour_groups (factory_id)
  where is_active;
