-- Shared suppliers remain one identity while module-specific roles control
-- Coal Seller and Garage selection.

begin;

create table public.supplier_roles (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete restrict,
  supplier_id uuid not null,
  role text not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  constraint supplier_roles_id_factory_key unique (id, factory_id),
  constraint supplier_roles_supplier_factory_fkey
    foreign key (supplier_id, factory_id)
    references public.suppliers(id, factory_id) on delete restrict,
  constraint supplier_roles_supplier_role_key unique (supplier_id, role),
  constraint supplier_roles_role_check check (role in ('COAL_SELLER', 'GARAGE'))
);

create index supplier_roles_factory_role_supplier_idx
  on public.supplier_roles(factory_id, role, supplier_id);

alter table public.supplier_roles enable row level security;
revoke all on public.supplier_roles from public, anon, authenticated;
grant select on public.supplier_roles to authenticated;

create policy "Authenticated users can read their factory supplier roles"
  on public.supplier_roles for select to authenticated
  using (exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = supplier_roles.factory_id
      and factory_users.is_active = true
  ));

-- Current test data can be classified safely from its structured module use.
insert into public.supplier_roles(factory_id, supplier_id, role, created_by)
select distinct coal.factory_id, records.supplier_id, 'COAL_SELLER', coal.created_by
from public.coal_purchases as coal
join public.expense_records as records
  on records.id = coal.id and records.factory_id = coal.factory_id
where records.supplier_id is not null
on conflict (supplier_id, role) do nothing;

insert into public.supplier_roles(factory_id, supplier_id, role, created_by)
select distinct maintenance.factory_id, records.supplier_id, 'GARAGE', maintenance.created_by
from public.vehicle_maintenance_records as maintenance
join public.expense_records as records
  on records.id = maintenance.id and records.factory_id = maintenance.factory_id
where records.supplier_id is not null
on conflict (supplier_id, role) do nothing;

create or replace function public.list_suppliers_by_role(
  p_factory_id uuid,
  p_role text
)
returns setof public.suppliers
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_role text := upper(btrim(coalesce(p_role, '')));
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then raise exception 'You do not have access to this factory.' using errcode = '42501'; end if;
  if normalized_role not in ('COAL_SELLER', 'GARAGE') then
    raise exception 'Supplier role is invalid.' using errcode = 'P4401';
  end if;
  return query
  select suppliers.*
  from public.supplier_roles as roles
  join public.suppliers as suppliers
    on suppliers.id = roles.supplier_id and suppliers.factory_id = roles.factory_id
  where roles.factory_id = p_factory_id and roles.role = normalized_role
  order by suppliers.name, suppliers.id;
end;
$$;

create or replace function public.create_or_assign_supplier_role(
  p_factory_id uuid,
  p_role text,
  p_name text,
  p_address text,
  p_mobile text
)
returns public.suppliers
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_role text := upper(btrim(coalesce(p_role, '')));
  normalized_name text := btrim(regexp_replace(coalesce(p_name, ''), '[[:space:]]+', ' ', 'g'));
  normalized_address text := nullif(btrim(regexp_replace(coalesce(p_address, ''), '[[:space:]]+', ' ', 'g')), '');
  normalized_mobile text := nullif(btrim(regexp_replace(coalesce(p_mobile, ''), '[[:space:]]+', ' ', 'g')), '');
  matching_ids uuid[];
  saved_supplier public.suppliers%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.factory_users
    where factory_users.user_id = auth.uid()
      and factory_users.factory_id = p_factory_id
      and factory_users.is_active = true
  ) then raise exception 'You do not have access to this factory.' using errcode = '42501'; end if;
  if normalized_role not in ('COAL_SELLER', 'GARAGE') then
    raise exception 'Supplier role is invalid.' using errcode = 'P4401';
  end if;
  if normalized_name = '' or length(normalized_name) > 200 or normalized_name ~ '[[:cntrl:]]' then
    raise exception 'Supplier name is required and must be at most 200 characters.' using errcode = '22023';
  end if;
  if normalized_address is not null
    and (length(normalized_address) > 500 or normalized_address ~ '[[:cntrl:]]') then
    raise exception 'Supplier address must be at most 500 characters.' using errcode = '22023';
  end if;
  if normalized_mobile is not null
    and (length(normalized_mobile) > 50 or normalized_mobile ~ '[[:cntrl:]]') then
    raise exception 'Supplier mobile must be at most 50 characters.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_factory_id::text || ':' || lower(normalized_name), 0
  ));
  select array_agg(suppliers.id order by suppliers.created_at, suppliers.id)
  into matching_ids
  from public.suppliers
  where suppliers.factory_id = p_factory_id
    and lower(suppliers.name) = lower(normalized_name);

  if coalesce(cardinality(matching_ids), 0) > 1 then
    raise exception 'Multiple suppliers already use this name. Select an existing supplier before assigning a role.'
      using errcode = 'P4404';
  elsif coalesce(cardinality(matching_ids), 0) = 1 then
    select * into saved_supplier from public.suppliers where id = matching_ids[1];
  else
    insert into public.suppliers(factory_id, name, address, mobile)
    values (p_factory_id, normalized_name, normalized_address, normalized_mobile)
    returning * into saved_supplier;
  end if;

  insert into public.supplier_roles(factory_id, supplier_id, role, created_by)
  values (p_factory_id, saved_supplier.id, normalized_role, auth.uid())
  on conflict (supplier_id, role) do nothing;
  return saved_supplier;
end;
$$;

create or replace function public.require_coal_supplier_role()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  selected_supplier_id uuid;
begin
  select records.supplier_id into selected_supplier_id
  from public.expense_records as records
  where records.id = new.id and records.factory_id = new.factory_id;
  if not exists (
    select 1 from public.supplier_roles as roles
    where roles.factory_id = new.factory_id
      and roles.supplier_id = selected_supplier_id
      and roles.role = 'COAL_SELLER'
  ) then raise exception 'Choose a supplier assigned as a Coal Seller.' using errcode = 'P4402'; end if;
  return new;
end;
$$;

create or replace function public.require_maintenance_garage_role()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  selected_supplier_id uuid;
begin
  select records.supplier_id into selected_supplier_id
  from public.expense_records as records
  where records.id = new.id and records.factory_id = new.factory_id;
  if not exists (
    select 1 from public.supplier_roles as roles
    where roles.factory_id = new.factory_id
      and roles.supplier_id = selected_supplier_id
      and roles.role = 'GARAGE'
  ) then raise exception 'Choose a supplier assigned as a Garage.' using errcode = 'P4403'; end if;
  return new;
end;
$$;

create trigger coal_purchases_require_supplier_role
before insert or update on public.coal_purchases
for each row execute function public.require_coal_supplier_role();
create trigger vehicle_maintenance_require_garage_role
before insert or update on public.vehicle_maintenance_records
for each row execute function public.require_maintenance_garage_role();

revoke all on function public.require_coal_supplier_role()
  from public, anon, authenticated;
revoke all on function public.require_maintenance_garage_role()
  from public, anon, authenticated;
revoke all on function public.list_suppliers_by_role(uuid, text)
  from public, anon, authenticated;
grant execute on function public.list_suppliers_by_role(uuid, text) to authenticated;
revoke all on function public.create_or_assign_supplier_role(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_or_assign_supplier_role(uuid, text, text, text, text)
  to authenticated;

comment on table public.supplier_roles is
  'Factory-owned multi-role classification for the single shared supplier identity.';
comment on function public.create_or_assign_supplier_role(uuid, text, text, text, text) is
  'Reuses one unambiguous same-name supplier or creates it, then idempotently assigns a module role.';

commit;
