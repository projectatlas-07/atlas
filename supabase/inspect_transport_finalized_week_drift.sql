-- Atlas Security 12D1.5D1: read-only historical Transport drift diagnostic.
-- Initial Test scan: zero finalized factory/weeks; no discrepancies observed.
-- Empty scope does not prove historical integrity or concurrency safety.
-- Before authorized production promotion, run this diagnostic separately on
-- Main under separate explicit authorization. No Main access is authorized here.
-- Test Atlas Clean ONLY: nfqdtygpyycaxlaegvcf.
-- Run: npx supabase db query --linked --file supabase/inspect_transport_finalized_week_drift.sql --output json
-- No repair, fixtures, locks, helpers, writing RPCs or schema changes.
-- One SELECT in an explicit read-only REPEATABLE READ snapshot; always roll back.
-- Run as the linked CLI's privileged reader: an RLS-filtered scan is incomplete.
-- Any header finalizes the factory/week, including partially calculated weeks.
-- Monday..Sunday sources and inclusive effective_from/effective_to match the
-- calculator. Attendance is recorded presence, NOT current crew assignments.
-- Attendance and rate history are aggregated independently before comparison.
-- Counts are diagnostic occurrences, NOT mutually exclusive financial incidents:
-- D overlaps F/G; H counts distinct missing workers; I counts distinct entries.
-- Numeric arithmetic/comparisons are exact PostgreSQL NUMERIC. Amounts in the
-- bounded examples are text to prevent client-side floating-point conversion.
-- Fractional residuals are reported separately, only for internally consistent,
-- complete saved entry snapshots. Repeated crew pools are never summed.
begin isolation level repeatable read read only;

with
finalized as (
  select distinct factory_id, week_start from public.transport_weekly_earnings
),
headers as (
  select h.* from public.transport_weekly_earnings h
),
saved as (
  select d.* from public.transport_weekly_earning_details d
  join finalized f using (factory_id, week_start)
),
entries as (
  select e.id as entry_id, e.factory_id, f.week_start, e.transport_crew_id,
    e.work_date, e.paya_quantity, a.attendance_count, r.rate_count,
    r.rate_id, r.rate_per_paya
  from finalized f
  join public.transport_daily_entries e on e.factory_id = f.factory_id
    and e.work_date between f.week_start and f.week_start + 6
  cross join lateral (
    select count(*) as attendance_count from public.transport_daily_attendance a
    where a.factory_id = e.factory_id and a.transport_daily_entry_id = e.id
      and a.transport_crew_id = e.transport_crew_id and a.work_date = e.work_date
  ) a
  cross join lateral (
    select count(*) as rate_count,
      case when count(*) = 1 then min(r.id::text)::uuid end as rate_id,
      case when count(*) = 1 then min(r.rate_per_paya) end as rate_per_paya
    from public.transport_crew_wage_rates r
    where r.factory_id = e.factory_id and r.transport_crew_id = e.transport_crew_id
      and r.effective_from <= e.work_date
      and (r.effective_to is null or r.effective_to >= e.work_date)
  ) r
),
current_contributions as (
  -- Retain attendance even with an unresolved rate; report that limitation
  -- separately instead of silently removing potential missing earnings.
  select e.*, a.transport_worker_id
  from entries e join public.transport_daily_attendance a
    on a.factory_id = e.factory_id and a.transport_daily_entry_id = e.entry_id
    and a.transport_crew_id = e.transport_crew_id and a.work_date = e.work_date
),
compared as (
  select coalesce(s.factory_id, c.factory_id) as factory_id,
    coalesce(s.week_start, c.week_start) as week_start,
    coalesce(s.transport_daily_entry_id, c.entry_id) as entry_id,
    coalesce(s.transport_worker_id, c.transport_worker_id) as worker_id,
    s.id as detail_id, c.entry_id as current_entry_id
  from saved s full outer join current_contributions c
    on c.factory_id = s.factory_id and c.week_start = s.week_start
    and c.entry_id = s.transport_daily_entry_id
    and c.transport_worker_id = s.transport_worker_id
    and c.transport_crew_id = s.transport_crew_id and c.work_date = s.work_date
),
header_sums as (
  select h.id, h.factory_id, h.week_start, h.transport_worker_id, h.total_amount,
    count(d.id) as detail_count,
    coalesce(sum(d.worker_daily_share_snapshot), 0::numeric) as detail_total
  from headers h left join saved d
    on d.transport_weekly_earning_id = h.id and d.factory_id = h.factory_id
    and d.transport_worker_id = h.transport_worker_id and d.week_start = h.week_start
  group by h.id, h.factory_id, h.week_start, h.transport_worker_id, h.total_amount
),
entry_snapshots as (
  select factory_id, week_start, transport_daily_entry_id as entry_id,
    count(*) as saved_worker_count,
    count(distinct (transport_crew_id, work_date, transport_crew_wage_rate_id,
      rate_per_paya_snapshot, paya_quantity_snapshot, attendance_count_snapshot,
      daily_crew_pool_snapshot, worker_daily_share_snapshot)) as variants,
    min(attendance_count_snapshot) as saved_attendance_count,
    min(daily_crew_pool_snapshot) as one_crew_pool,
    sum(worker_daily_share_snapshot) as sum_worker_shares,
    bool_and(daily_crew_pool_snapshot = paya_quantity_snapshot * rate_per_paya_snapshot
      and worker_daily_share_snapshot = daily_crew_pool_snapshot / attendance_count_snapshot)
      as formula_consistent
  from saved group by factory_id, week_start, transport_daily_entry_id
),
findings as (
  select 'A_HEADER_DETAIL'::text as category, factory_id, week_start,
    id as record_id, null::uuid as entry_id, transport_worker_id as worker_id,
    jsonb_build_object('header_total', total_amount::text,
      'detail_total', detail_total::text, 'detail_count', detail_count,
      'difference', (total_amount - detail_total)::text) as evidence
  from header_sums where total_amount <> detail_total
  union all
  select 'B_QUANTITY', s.factory_id, s.week_start, s.id,
    s.transport_daily_entry_id, s.transport_worker_id,
    jsonb_build_object('saved', s.paya_quantity_snapshot::text,
      'current', e.paya_quantity::text, 'work_date', s.work_date)
  from saved s join entries e on e.factory_id = s.factory_id
    and e.week_start = s.week_start and e.entry_id = s.transport_daily_entry_id
    and e.transport_crew_id = s.transport_crew_id and e.work_date = s.work_date
  where s.paya_quantity_snapshot <> e.paya_quantity
  union all
  select 'C_ATTENDANCE_COUNT', s.factory_id, s.week_start, s.id,
    s.transport_daily_entry_id, s.transport_worker_id,
    jsonb_build_object('saved', s.attendance_count_snapshot,
      'current', e.attendance_count, 'work_date', s.work_date)
  from saved s join entries e on e.factory_id = s.factory_id
    and e.week_start = s.week_start and e.entry_id = s.transport_daily_entry_id
    and e.transport_crew_id = s.transport_crew_id and e.work_date = s.work_date
  where s.attendance_count_snapshot <> e.attendance_count
  union all
  select 'D_WORKER_PRESENCE', factory_id, week_start, detail_id, entry_id, worker_id,
    jsonb_build_object('saved_present', detail_id is not null,
      'current_present', current_entry_id is not null)
  from compared where detail_id is null or current_entry_id is null
  union all
  select 'E_RATE', s.factory_id, s.week_start, s.id,
    s.transport_daily_entry_id, s.transport_worker_id,
    jsonb_build_object('saved_rate_id', s.transport_crew_wage_rate_id,
      'current_rate_id', e.rate_id, 'saved_value', s.rate_per_paya_snapshot::text,
      'current_value', e.rate_per_paya::text, 'work_date', s.work_date)
  from saved s join entries e on e.factory_id = s.factory_id
    and e.week_start = s.week_start and e.entry_id = s.transport_daily_entry_id
    and e.transport_crew_id = s.transport_crew_id and e.work_date = s.work_date
  where e.rate_count = 1 and (s.transport_crew_wage_rate_id <> e.rate_id
    or s.rate_per_paya_snapshot <> e.rate_per_paya)
  union all
  select 'F_UNSAVED_CONTRIBUTION', factory_id, week_start, null::uuid,
    entry_id, worker_id, jsonb_build_object('current_presence_without_saved_detail', true)
  from compared where detail_id is null
  union all
  select 'G_SAVED_WITHOUT_SOURCE', factory_id, week_start, detail_id,
    entry_id, worker_id, jsonb_build_object('no_matching_current_entry_worker_contribution', true)
  from compared where current_entry_id is null
  union all
  select 'H_MISSING_WORKER_HEADER', c.factory_id, c.week_start, null::uuid,
    null::uuid, c.transport_worker_id,
    jsonb_build_object('current_contribution_count', count(*))
  from current_contributions c left join headers h on h.factory_id = c.factory_id
    and h.week_start = c.week_start and h.transport_worker_id = c.transport_worker_id
  where h.id is null group by c.factory_id, c.week_start, c.transport_worker_id
  union all
  select 'I_INCONSISTENT_ENTRY_SNAPSHOTS', factory_id, week_start, null::uuid,
    entry_id, null::uuid, jsonb_build_object('snapshot_variants', variants,
      'saved_worker_count', saved_worker_count)
  from entry_snapshots where variants > 1
  union all
  select 'J_SAVED_FORMULA', s.factory_id, s.week_start, s.id,
    s.transport_daily_entry_id, s.transport_worker_id,
    jsonb_build_object('saved_pool', s.daily_crew_pool_snapshot::text,
      'quantity_times_rate', (s.paya_quantity_snapshot * s.rate_per_paya_snapshot)::text,
      'saved_share', s.worker_daily_share_snapshot::text,
      'pool_divided_by_attendance', (s.daily_crew_pool_snapshot / s.attendance_count_snapshot)::text)
  from saved s where s.daily_crew_pool_snapshot <> s.paya_quantity_snapshot * s.rate_per_paya_snapshot
    or s.worker_daily_share_snapshot <> s.daily_crew_pool_snapshot / s.attendance_count_snapshot
  union all
  select case when rate_count = 0 then 'RATE_MISSING' else 'RATE_AMBIGUOUS' end,
    factory_id, week_start, null::uuid, entry_id, null::uuid,
    jsonb_build_object('matching_rates', rate_count, 'work_date', work_date,
      'crew_id', transport_crew_id)
  from entries where rate_count <> 1
  union all
  select 'SOURCE_ZERO_ATTENDANCE', factory_id, week_start, null::uuid, entry_id,
    null::uuid, jsonb_build_object('work_date', work_date, 'crew_id', transport_crew_id)
  from entries where attendance_count = 0
),
ranked_findings as (
  select *, row_number() over (partition by category
    order by factory_id, week_start, entry_id, worker_id, record_id) as example_rank
  from findings
),
categories(category) as (values
  ('A_HEADER_DETAIL'), ('B_QUANTITY'), ('C_ATTENDANCE_COUNT'), ('D_WORKER_PRESENCE'),
  ('E_RATE'), ('F_UNSAVED_CONTRIBUTION'), ('G_SAVED_WITHOUT_SOURCE'),
  ('H_MISSING_WORKER_HEADER'), ('I_INCONSISTENT_ENTRY_SNAPSHOTS'),
  ('J_SAVED_FORMULA'), ('RATE_MISSING'), ('RATE_AMBIGUOUS'), ('SOURCE_ZERO_ATTENDANCE')
),
category_report as (
  select c.category, count(f.category) as occurrences,
    count(distinct (f.factory_id, f.week_start)) filter (where f.category is not null)
      as affected_factory_weeks,
    coalesce(jsonb_agg(jsonb_build_object('factory_id', f.factory_id,
      'week_start', f.week_start, 'record_id', f.record_id, 'entry_id', f.entry_id,
      'worker_id', f.worker_id, 'evidence', f.evidence)
      order by f.example_rank) filter (where f.example_rank <= 3), '[]'::jsonb) as examples
  from categories c left join ranked_findings f using (category) group by c.category
),
fractional_residuals as (
  select *, row_number() over (order by factory_id, week_start, entry_id) as example_rank
  from entry_snapshots where variants = 1 and formula_consistent
    and saved_worker_count = saved_attendance_count
    and one_crew_pool <> sum_worker_shares
)
select jsonb_build_object(
  'safety', jsonb_build_object('read_only', current_setting('transaction_read_only'),
    'isolation', current_setting('transaction_isolation'), 'execution_role', current_user,
    'bypasses_rls', (select rolbypassrls or rolsuper from pg_catalog.pg_roles
      where rolname = current_user), 'snapshot', txid_current_snapshot()::text),
  'scan', jsonb_build_object('finalized_factory_weeks', (select count(*) from finalized),
    'factories', (select count(distinct factory_id) from finalized),
    'headers', (select count(*) from headers), 'saved_details', (select count(*) from saved),
    'current_entries', (select count(*) from entries),
    'current_worker_contributions', (select count(*) from current_contributions)),
  'categories', (select jsonb_agg(to_jsonb(r) order by category) from category_report r),
  'fractional_division_artifacts', jsonb_build_object(
    'entry_count', (select count(*) from fractional_residuals),
    'examples', (select coalesce(jsonb_agg(jsonb_build_object('factory_id', factory_id,
      'week_start', week_start, 'entry_id', entry_id, 'one_crew_pool', one_crew_pool::text,
      'sum_saved_worker_shares', sum_worker_shares::text,
      'residual', (one_crew_pool - sum_worker_shares)::text)
      order by example_rank), '[]'::jsonb) from fractional_residuals where example_rank <= 3))
) as diagnostic;

rollback;
