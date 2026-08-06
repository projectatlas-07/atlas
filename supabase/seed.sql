do $$
declare
  development_factory_id uuid;
  factory_count bigint;
begin
  select count(*) into factory_count from public.factories;

  if factory_count <> 1 then
    raise exception 'Expected exactly one development factory, found %', factory_count;
  end if;

  select id into strict development_factory_id from public.factories;

  insert into public.brick_types (id, factory_id, name, is_active)
  values (
    'dfd3f3a1-ec04-4d70-ac23-76988d5bac02',
    development_factory_id,
    'Standard Red Brick',
    true
  )
  on conflict (id) do update
  set
    factory_id = excluded.factory_id,
    name = excluded.name,
    is_active = excluded.is_active;

  insert into public.labourers (id, factory_id, name, assigned_brick_type_id, is_active)
  values
    ('8b75dbd5-982d-4182-b6eb-03f4b8f2a003', development_factory_id, 'Ramesh Kumar', 'dfd3f3a1-ec04-4d70-ac23-76988d5bac02', true),
    ('b93e4b20-d54d-47af-96de-833d7050b004', development_factory_id, 'Suresh Yadav', 'dfd3f3a1-ec04-4d70-ac23-76988d5bac02', true),
    ('a23c8643-82c0-4efc-b0b9-3c95bf689005', development_factory_id, 'Mahesh Singh', 'dfd3f3a1-ec04-4d70-ac23-76988d5bac02', true),
    ('5c48fe0a-9e91-4c2a-963e-c60388d9f006', development_factory_id, 'Rajesh Kumar', 'dfd3f3a1-ec04-4d70-ac23-76988d5bac02', true),
    ('25c50617-c66d-4d10-b4d0-7e4799eaa007', development_factory_id, 'Vikram Patel', 'dfd3f3a1-ec04-4d70-ac23-76988d5bac02', true)
  on conflict (id) do update
  set
    factory_id = excluded.factory_id,
    name = excluded.name,
    assigned_brick_type_id = excluded.assigned_brick_type_id,
    is_active = excluded.is_active;
end
$$;
