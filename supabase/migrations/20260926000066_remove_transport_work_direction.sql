alter table public.transport_crews
  drop constraint transport_crews_work_direction_check;

alter table public.transport_crews
  drop column work_direction;
