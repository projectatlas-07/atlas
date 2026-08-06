create table public.factory_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  factory_id uuid not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint factory_users_user_id_key unique (user_id),
  constraint factory_users_user_factory_key unique (user_id, factory_id),
  constraint factory_users_user_id_fkey
    foreign key (user_id)
    references auth.users (id) on delete cascade,
  constraint factory_users_factory_id_fkey
    foreign key (factory_id)
    references public.factories (id) on delete restrict
);

create trigger factory_users_set_updated_at before update on public.factory_users
for each row execute function public.set_updated_at();

alter table public.factory_users enable row level security;
