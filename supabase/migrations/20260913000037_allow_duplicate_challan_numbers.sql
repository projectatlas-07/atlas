-- Atlas duplicate Challan numbers: the visible reference is display data, not identity.

alter table public.challans
  drop constraint challans_factory_number_key;

comment on column public.challans.challan_number is
  'Optional operator-entered display/reference value. Duplicates are allowed; the Challan UUID is the only record identity.';
