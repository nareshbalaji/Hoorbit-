-- Backend benchmark on synthetic data (run via tests/perf.sh after tests/run.sh). Not part of the normal test run.
\timing off
-- 20,000 approved providers scattered over Klang Valley (lat 2.7..3.5, lng 101.2..102.0, about 90 x 90 km), 15% online.
insert into auth.users (id, aud, role, phone, phone_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select gen_random_uuid(), 'authenticated', 'authenticated', '6019' || lpad(g::text, 7, '0'), now(), '{}', '{}', now(), now() from generate_series(1, 20000) g;
insert into providers (id, status, radius_km, online, last_geog, last_seen)
select p.id, 'approved', 10, random() < 0.15, pt(2.7 + random() * 0.8, 101.2 + random() * 0.8), now()
  from profiles p where p.phone like '6019%';
insert into provider_categories select id, 3, null from providers where id in (select id from profiles where phone like '6019%');
insert into auth.users (id, aud, role, phone, phone_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-0000000000aa', 'authenticated', 'authenticated', '60190000000', now(), '{}', '{}', now(), now());
analyze;

\echo '--- 1. nearest providers query plan (must use providers_geo_idx / spatial index) ---'
explain (analyze, costs off, timing on, summary on)
select p.id, st_distance(p.last_geog, pt(3.119, 101.62))
  from providers p join provider_categories pc on pc.provider_id = p.id and pc.category_id = 3
 where p.status = 'approved' and p.online and p.last_geog is not null
   and st_dwithin(p.last_geog, pt(3.119, 101.62), 5000) and st_dwithin(p.last_geog, pt(3.119, 101.62), p.radius_km * 1000)
 order by st_distance(p.last_geog, pt(3.119, 101.62)) limit 5;

\echo '--- 2. end-to-end create_job (instant scrap) incl. dispatch, 20k providers ---'
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000aa', false);
do $$ declare t0 timestamptz; i int; j uuid; ms numeric[] := '{}'; begin
  for i in 1..30 loop
    t0 := clock_timestamp();
    j := create_job(3::smallint, 3.119 + random()*0.01, 101.62 + random()*0.01, 'x', '+60190000000', null, '{}', null, 'cash', '[{"item_type":"paper","est_kg":5}]');
    ms := ms || (extract(epoch from clock_timestamp() - t0) * 1000)::numeric;
  end loop;
  raise notice 'create_job x30: median % ms, max % ms', (select percentile_cont(0.5) within group (order by m) from unnest(ms) m)::numeric(8,2), (select max(m) from unnest(ms) m)::numeric(8,2);
end $$;

\echo '--- 3. indexes: every filtered column in the hot queries ---'
select relname as table, indexrelname as index from pg_stat_user_indexes where schemaname = 'public' and relname in ('jobs','job_offers','providers','queue_tickets') order by 1, 2;
