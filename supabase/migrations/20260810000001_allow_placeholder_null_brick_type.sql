alter table public.labourers
  add constraint labourers_brick_type_required_unless_placeholder_check
  check (is_placeholder or assigned_brick_type_id is not null);

alter table public.labourers
  alter column assigned_brick_type_id drop not null;
