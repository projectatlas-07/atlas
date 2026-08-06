grant select on public.labourers to anon;
grant select on public.brick_types to anon;

do $$
begin
  if exists (
    select 1
    from pg_class
    where oid = 'public.labourers'::regclass
      and relrowsecurity
  ) and not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'labourers'
      and cmd in ('SELECT', 'ALL')
      and roles && array['anon', 'public']::name[]
  ) then
    create policy "Development anonymous labourer select"
      on public.labourers
      for select
      to anon
      using (true);
  end if;

  if exists (
    select 1
    from pg_class
    where oid = 'public.brick_types'::regclass
      and relrowsecurity
  ) and not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'brick_types'
      and cmd in ('SELECT', 'ALL')
      and roles && array['anon', 'public']::name[]
  ) then
    create policy "Development anonymous brick type select"
      on public.brick_types
      for select
      to anon
      using (true);
  end if;
end
$$;
