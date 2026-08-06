alter table public.production_entries
  drop constraint production_entries_factory_labourer_brick_type_date_key;

alter table public.production_entries
  add constraint production_entries_factory_labourer_date_key
  unique (factory_id, labourer_id, production_date);
