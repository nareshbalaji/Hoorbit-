-- End-to-end tests of dispatch, privacy, RLS and queue logic. Runs as real `authenticated` / `anon` roles.
create function t_as(u uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', u::text, false); execute 'set role authenticated'; end $$;
create function t_anon() returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', '', false); execute 'set role anon'; end $$;
create function t_su() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
create function t_set(k text, v text) returns void language sql as $$ select set_config('t.'||k, v, false) $$;
create function t_get(k text) returns text language sql as $$ select current_setting('t.'||k) $$;
create function t_ok(c boolean, label text) returns void language plpgsql as $$ begin
  if c is not true then raise exception 'FAIL: %', label; end if; raise notice 'ok   %', label; end $$;
create function t_err(stmt text, expect text) returns void language plpgsql as $$ begin
  begin execute stmt; exception when others then
    if sqlerrm like '%'||expect||'%' then raise notice 'ok   error "%" for: %', expect, left(stmt,60); return; end if;
    raise exception 'FAIL: wrong error "%" (wanted "%") for %', sqlerrm, expect, stmt; end;
  raise exception 'FAIL: no error (wanted "%") for %', expect, stmt; end $$;

-- handy ids
select t_set('admin','00000000-0000-4000-8000-000000000001'), t_set('c1','00000000-0000-4000-8000-000000000002'),
       t_set('c2','00000000-0000-4000-8000-000000000003'), t_set('staff','00000000-0000-4000-8000-000000000004');
select t_set('shop','10000000-0000-4000-8000-000000000001');

-- ===== 0. launch config =====
select t_ok((select count(*) from categories where enabled) = 3, 'only 3 categories enabled at launch');
select t_ok((select count(*) from providers) = 10, '10 demo providers');
select t_ok((select count(*) from regions where enabled) = 3, 'PJ, Subang, Shah Alam enabled');
select t_ok(length(home_feed()::text) < 50000, 'home_feed far below 50KB: '||length(home_feed()::text)||' bytes');

-- ===== 1. instant scrap job: dispatch, first-accept-wins, privacy =====
select t_as(t_get('c1')::uuid);
select t_set('scrap', create_job((select id from categories where slug='scrap'), 3.1190, 101.6200,
   'No. 12, Jalan SS 2/24, PJ', '+60123456002', 'Old newspapers and iron', '{}', null, 'cash',
   '[{"item_type":"paper","est_kg":20},{"item_type":"iron","est_kg":10}]')::text);
select t_su();
select t_ok((select status from jobs where id = t_get('scrap')::uuid) = 'searching', 'instant job searching');
select t_ok((select count(*) from job_offers where job_id = t_get('scrap')::uuid) between 1 and 5, 'offers sent to <=5 nearest scrap providers');
select t_ok(not exists (select 1 from job_offers o where o.job_id = t_get('scrap')::uuid and o.provider_id in
   ('00000000-0000-4000-8000-000000000109','00000000-0000-4000-8000-000000000110')), 'offline/pending providers not offered');
select t_ok((select area_geog from jobs where id = t_get('scrap')::uuid) <> (select geog from job_private where job_id = t_get('scrap')::uuid), 'public location is snapped, not exact');
select t_set('p1', (select provider_id::text from job_offers where job_id = t_get('scrap')::uuid order by distance_m limit 1));
select t_set('p2', (select provider_id::text from job_offers where job_id = t_get('scrap')::uuid order by distance_m desc limit 1));

select t_as(t_get('c2')::uuid);
select t_ok((select count(*) from jobs where id = t_get('scrap')::uuid) = 0, 'other customer cannot see job');
select t_su();

select t_as(t_get('p1')::uuid);
select t_ok((select count(*) from jobs where id = t_get('scrap')::uuid) = 1, 'offered provider sees job');
select t_ok((select count(*) from job_private) = 0, 'provider CANNOT see address/phone before accepting');
select t_err('select last_geog from providers', 'permission denied');
select accept_offer(t_get('scrap')::uuid);
select t_ok((select count(*) from job_private where job_id = t_get('scrap')::uuid) = 1, 'winner sees address/phone after accepting');
select t_su();

select t_as(t_get('p2')::uuid);
select t_err(format('select accept_offer(%L)', t_get('scrap')), 'offer_expired');   -- loser's offer was expired atomically
select t_ok((select count(*) from jobs where id = t_get('scrap')::uuid) = 0, 'loser no longer sees job');
select t_su();

-- race simulated at SQL level: a fresh offer that is still 'offered' but job already taken
update job_offers set status='offered', expires_at = now()+interval '1 min' where job_id = t_get('scrap')::uuid and provider_id = t_get('p2')::uuid;
select t_as(t_get('p2')::uuid);
select t_err(format('select accept_offer(%L)', t_get('scrap')), 'already_taken');
select t_su();

-- ===== 2. tracking + scrap payout =====
select t_as(t_get('p1')::uuid);
select set_job_status(t_get('scrap')::uuid, 'on_the_way');
select ping_location(t_get('scrap')::uuid, 3.1100, 101.6100);
select t_su();
select t_as(t_get('c1')::uuid);
select t_ok((select count(*) from job_tracking where job_id = t_get('scrap')::uuid) = 1, 'customer sees live provider location');
select t_su();
select t_as(t_get('c2')::uuid);
select t_ok((select count(*) from job_tracking) = 0, 'strangers cannot see tracking');
select t_su();
select t_as(t_get('p1')::uuid);
select set_job_status(t_get('scrap')::uuid, 'arrived');
select t_err(format('select set_job_status(%L, ''done'')', t_get('scrap')), 'bad_transition');
select t_set('payout', complete_scrap(t_get('scrap')::uuid,
   '[{"item_type":"paper","actual_kg":18.5},{"item_type":"iron","actual_kg":12},{"item_type":"copper","actual_kg":0.4}]')::text);
select t_su();
-- 18.5*25 + 12*90 + 0.4*2500 = 462.5 + 1080 + 1000 = 2542.5 -> sum of per-item rounds (463 + 1080 + 1000) = 2543
select t_ok(t_get('payout')::int = 2543, 'scrap payout computed from per-kg list = 2543 sen (RM25.43), got '||t_get('payout'));
select t_ok((select status = 'done' and payout_cents = 2543 and pay_status = 'payout_done' and commission_cents = 254 from jobs where id = t_get('scrap')::uuid), 'scrap job done, customer payout recorded, 10% fee');
select t_ok((select count(*) from job_tracking) = 0, 'tracking row removed after job ends');

-- ===== 3. review, messages, report =====
select t_as(t_get('c1')::uuid);
select submit_review(t_get('scrap')::uuid, 5::smallint, 'Cepat dan jujur', 200);
select t_err(format('select submit_review(%L, 4::smallint)', t_get('scrap')), 'duplicate key');
insert into messages (job_id, sender_id, body) values (t_get('scrap')::uuid, t_get('c1')::uuid, 'Terima kasih!');
select report_problem(t_get('scrap')::uuid, 'Weight seemed low');
select t_su();
select t_as(t_get('c2')::uuid);
select t_err(format('insert into messages (job_id, sender_id, body) values (%L, %L, ''hi'')', t_get('scrap'), t_get('c2')), 'row-level security');
select t_su();
select t_ok((select count(*) from outbox where kind='chat') = 1, 'chat push queued for the other party');
select t_ok((select rating_count from providers where id = t_get('p1')::uuid) > 20, 'provider rating aggregate updated');
update jobs set done_at = now() - interval '8 days' where id = t_get('scrap')::uuid;
select t_as(t_get('c1')::uuid);
select t_err(format('select report_problem(%L, ''late'')', t_get('scrap')), 'report_window_closed');
select t_su();

-- ===== 4. scheduled aircond =====
select t_as(t_get('c1')::uuid);
select t_err('select create_job((select id from categories where slug=''plumber''), 3.119, 101.62, ''x'', ''y'')', 'category_unavailable');
select t_err('select create_job((select id from categories where slug=''aircond''), 5.4141, 100.3288, ''Penang'', ''y'', null, ''{}'', now()+interval ''2 days'')', 'area_not_served');
select t_err('select create_job((select id from categories where slug=''aircond''), 3.119, 101.62, ''x'', ''y'', null, ''{}'', now())', 'bad_schedule');
select t_set('ac', create_job((select id from categories where slug='aircond'), 3.1190, 101.6200, 'No. 12 SS2', '+60123456002',
   '2 wall units', '{}', now() + interval '2 days', 'cash')::text);
select t_su();
select t_ok((select status from jobs where id = t_get('ac')::uuid) = 'pending', 'scheduled job awaits provider confirmation');
select t_set('ap', (select provider_id::text from job_offers where job_id = t_get('ac')::uuid order by distance_m limit 1));
select t_as(t_get('ap')::uuid);
select accept_offer(t_get('ac')::uuid);
select set_job_status(t_get('ac')::uuid, 'on_the_way'); select set_job_status(t_get('ac')::uuid, 'arrived'); select set_job_status(t_get('ac')::uuid, 'in_progress');
select set_job_status(t_get('ac')::uuid, 'done');
select t_su();
select t_ok((select commission_cents = round(price_cents * 0.15) from jobs where id = t_get('ac')::uuid), 'aircond 15% commission');
select t_as(t_get('ap')::uuid);
select t_ok((select count(*) from job_private where job_id = t_get('ac')::uuid) = 1, 'provider still sees address within 7 days of completion');
select t_su();
update jobs set done_at = now() - interval '9 days' where id = t_get('ac')::uuid;
select t_as(t_get('ap')::uuid);
select t_ok((select count(*) from job_private where job_id = t_get('ac')::uuid) = 0, 'provider loses address access 7 days after completion (PDPA)');
select t_su();

-- ===== 5. quote flow (admin enables painting; max 3 quotes) =====
select t_as(t_get('admin')::uuid);
update categories set enabled = true where slug = 'painting';
select t_su();
insert into provider_categories (provider_id, category_id)
  select id, (select id from categories where slug='painting') from providers where status='approved' and id::text like '%10_' limit 4;
select t_as(t_get('c1')::uuid);
select t_err('select create_job((select id from categories where slug=''painting''), 3.119, 101.62, ''x'', ''y'', ''walls'', ''{}'')', 'photos_required');
select t_set('paint', create_job((select id from categories where slug='painting'), 3.1190, 101.6200, 'No 12', '+60123456002', 'Repaint living room', '{"u/p1.webp"}')::text);
select t_su();
select t_ok((select count(*) from job_offers where job_id = t_get('paint')::uuid) = 4, 'quote request sent to nearby providers');
do $$ declare r record; n int := 0; begin
  for r in select provider_id from job_offers where job_id = t_get('paint')::uuid order by distance_m loop
    perform t_as(r.provider_id);
    begin perform submit_quote(t_get('paint')::uuid, 100000 + n * 5000, 'Quote '||n); n := n + 1;
    exception when others then perform t_su(); if sqlerrm = 'quote_limit' then raise notice 'ok   4th quote rejected (max 3)'; else raise; end if; end;
    perform t_su();
  end loop;
  if n <> 3 then raise exception 'FAIL: expected 3 quotes, got %', n; end if;
end $$;
select t_as(t_get('c1')::uuid);
select t_ok((select count(*) from quotes where job_id = t_get('paint')::uuid) = 3, 'customer sees all 3 quotes');
select accept_quote((select id from quotes where job_id = t_get('paint')::uuid order by price_cents limit 1));
select t_su();
select t_ok((select status = 'accepted' and price_cents = 100000 from jobs where id = t_get('paint')::uuid), 'cheapest quote accepted, price locked');
select t_ok((select count(*) from quotes where job_id = t_get('paint')::uuid and status = 'rejected') = 2, 'other quotes rejected');

-- ===== 6. security: privilege escalation & admin =====
select t_as(t_get('c1')::uuid);
select t_err(format('update profiles set role = ''admin'' where id = %L', t_get('c1')), 'permission denied');
select t_err('select dispatch_job(gen_random_uuid(), 5)', 'permission denied');
select t_err('select * from outbox', 'permission denied');
select t_err('select * from demand_heatmap(30)', 'not_allowed');
select t_err(format('select admin_set_provider_status(%L, ''approved'')', '00000000-0000-4000-8000-000000000110'), 'not_allowed');
select t_su();
select t_as(t_get('admin')::uuid);
select t_ok((select count(*) from demand_heatmap(60)) >= 1, 'admin demand heatmap works');
select admin_set_provider_status('00000000-0000-4000-8000-000000000110', 'approved');
select t_su();
select t_ok((select status from providers where id = '00000000-0000-4000-8000-000000000110') = 'approved', 'admin approved pending provider');
-- licence gate
insert into provider_categories values ('00000000-0000-4000-8000-000000000110', (select id from categories where slug='electrician'), null);
select t_as(t_get('admin')::uuid);
select t_err('select admin_set_provider_status(''00000000-0000-4000-8000-000000000110'', ''approved'')', 'license_missing');
select t_su();

-- ===== 7. shop queue =====
select t_as(t_get('c1')::uuid); select t_set('tk1', (join_queue(t_get('shop')::uuid)).id::text);
select t_ok((select id from join_queue(t_get('shop')::uuid)) = t_get('tk1')::uuid, 'joining twice returns same ticket');
select t_su();
select t_as(t_get('c2')::uuid); select t_set('tk2', (join_queue(t_get('shop')::uuid)).id::text); select t_su();
select t_as(t_get('c2')::uuid);
select t_ok((ticket_position(t_get('tk2')::uuid)->>'ahead')::int = 1, 'position: 1 ahead');
select t_ok((ticket_position(t_get('tk2')::uuid)->>'wait_secs')::int = 1800, 'estimated wait = 2 x 900s');
select t_err(format('select queue_next(%L)', t_get('shop')), 'not_allowed');
select t_su();
select t_as(t_get('staff')::uuid);
select t_ok((queue_next(t_get('shop')::uuid)).number = 1, 'NEXT calls ticket #1');
select t_su();
select t_ok(exists (select 1 from outbox where kind='your_turn' and user_id = t_get('c1')::uuid), 'push "your turn" queued');
select t_as(t_get('staff')::uuid);
select t_ok((queue_recall(t_get('shop')::uuid)).number = 1, 'RECALL re-announces #1');
select t_ok((queue_skip(t_get('shop')::uuid)).number = 2, 'SKIP drops #1 and calls #2');
select t_su();
select t_ok((select status from queue_tickets where id = t_get('tk1')::uuid) = 'skipped', 'ticket #1 skipped');

-- kiosk pairing & offline sync
select t_anon(); select t_set('code', kiosk_pair_start()); select t_su();
select t_anon(); select t_ok(kiosk_pair_poll(t_get('code'))->>'status' = 'waiting', 'kiosk waits for pairing'); select t_su();
select t_as(t_get('c1')::uuid); select t_err(format('select kiosk_pair_claim(%L, %L)', t_get('code'), t_get('shop')), 'not_allowed'); select t_su();
select t_as(t_get('staff')::uuid); select kiosk_pair_claim(t_get('code'), t_get('shop')::uuid, 'Front kiosk'); select t_su();
select t_anon(); select t_set('ktok', kiosk_pair_poll(t_get('code'))->>'token');
select t_ok(length(t_get('ktok')) = 64, 'kiosk receives device token once');
select t_ok(kiosk_pair_poll(t_get('code'))->>'status' = 'expired', 'pairing code single-use');
select t_err('select kiosk_snapshot(''wrong'')', 'bad_kiosk_token');
select t_set('cid', gen_random_uuid()::text);
select t_set('kn', (kiosk_create_ticket(t_get('ktok'), t_get('cid')::uuid, 'Walk-in')).number::text);
select t_ok((kiosk_create_ticket(t_get('ktok'), t_get('cid')::uuid, 'Walk-in')).number = t_get('kn')::int, 'kiosk ticket creation is idempotent');
select t_set('blk', kiosk_reserve_block(t_get('ktok'), 20)::text);
select t_su();
select t_ok((t_get('blk')::jsonb->>'first')::int > t_get('kn')::int, 'reserved block starts after existing numbers');
select t_anon();
select kiosk_sync(t_get('ktok'), format('[{"day":"%s","number":%s,"client_id":"%s","status":"done","label":"Offline walk-in","created_at":"%s","called_at":"%s","done_at":"%s"}]',
   (now() at time zone 'Asia/Kuala_Lumpur')::date, (t_get('blk')::jsonb->>'first'), gen_random_uuid(), now(), now(), now())::jsonb);
select t_su();
select t_ok((select count(*) from queue_tickets where source='kiosk') = 2, 'offline kiosk ticket synced');
select t_as(t_get('c1')::uuid); select join_queue(t_get('shop')::uuid); select t_su();
select t_ok((select max(number) from queue_tickets where source='app') > (t_get('blk')::jsonb->>'last')::int, 'app tickets numbered after the reserved block (no clash)');

-- ===== 8. PDPA delete =====
select t_as(t_get('c2')::uuid); select delete_my_account(); select t_su();
select t_ok((select full_name = 'Deleted user' and phone is null from profiles where id = t_get('c2')::uuid), 'account anonymised');
select t_ok((select count(*) from addresses where user_id = t_get('c2')::uuid) = 0, 'saved addresses erased');
select t_ok((select banned_until from auth.users where id = t_get('c2')::uuid) is not null, 'sign-in disabled');

-- ===== 8b. helper RPCs =====
select t_as(t_get('c1')::uuid);
select t_ok((select count(*) from my_addresses()) = 1, 'my_addresses returns saved address as lat/lng');
select t_ok((select count(*) from nearby_shops(3.1186, 101.6224)) = 3, 'nearby_shops lists 3 open shops');
select t_ok((select name from nearby_shops(3.1186, 101.6224) limit 1) = 'Gunting Rambut Ah Seng', 'nearby_shops ordered by distance');
select t_ok((select count(*) from nearby_providers((select id from categories where slug='aircond'), 3.119, 101.62)) >= 2, 'nearby_providers returns public provider cards');
select t_ok((select count(*) from job_contact(t_get('paint')::uuid)) = 1, 'customer reads own job_contact');
select t_su();
select t_as(t_get('c2')::uuid);
select t_ok((select count(*) from job_contact(t_get('paint')::uuid)) = 0, 'stranger gets nothing from job_contact');
select t_su();

-- ===== 8c. SOS =====
select t_as(t_get('c1')::uuid); select send_sos(t_get('paint')::uuid, 3.12, 101.62); select t_err('select * from admin_sos()', 'not_allowed'); select t_su();
select t_as(t_get('admin')::uuid); select t_ok((select count(*) from admin_sos()) = 1, 'admin sees SOS with coordinates'); select t_su();

-- ===== 8d. recurring: reminder vs auto-book =====
select t_as(t_get('c1')::uuid);
select repeat_job(t_get('ac')::uuid, 120::smallint, false);               -- aircond: remind only
select repeat_job(t_get('scrap')::uuid, 7::smallint, true);               -- auto-book (scrap is instant, so it must still work as scheduled copy)
select t_su();
update recurring_bookings set next_at = current_date - 1;
select sweep_jobs();
select t_ok(exists (select 1 from outbox where kind = 'repeat_reminder'), 'reminder-only repeat sends a reminder, books nothing');
select t_ok((select count(*) from jobs where repeat_of = t_get('ac')::uuid) = 0, 'reminder did not create a job');
select t_ok((select count(*) from jobs where repeat_of = t_get('scrap')::uuid and status = 'pending') = 1, 'auto-book created the next job');
select t_ok((select count(*) from job_private where job_id = (select id from jobs where repeat_of = t_get('scrap')::uuid)) = 1, 'auto-booked job has its private address');
select t_ok((select count(*) from job_offers where job_id = (select id from jobs where repeat_of = t_get('scrap')::uuid)) >= 1, 'auto-booked job was dispatched to providers');
select t_ok(exists (select 1 from outbox where kind = 'repeat_booked'), 'customer told about the auto-booking');

-- ===== 8e. idle online providers stay eligible; stale ones are set offline =====
update providers set last_seen = now() - interval '2 hours' where id = '00000000-0000-4000-8000-000000000103';
select t_ok((select online from providers where id = '00000000-0000-4000-8000-000000000103'), 'provider idle 2h is still online');
update providers set last_seen = now() - interval '9 hours' where id = '00000000-0000-4000-8000-000000000103';
select sweep_jobs();
select t_ok(not (select online from providers where id = '00000000-0000-4000-8000-000000000103'), 'provider idle >8h set offline by sweep');
update providers set online = true, last_seen = now() where id = '00000000-0000-4000-8000-000000000103';   -- restore for later tests

-- ===== 9. expanding-ring dispatch + sweep =====
select t_as(t_get('c1')::uuid);
select t_set('far', create_job((select id from categories where slug='scrap'), 3.0733, 101.5185, 'Seksyen 7 Shah Alam', '+60123456002', null, '{}', null, 'cash', '[{"item_type":"paper","est_kg":5}]')::text);
select t_set('near', create_job((select id from categories where slug='scrap'), 3.1190, 101.6200, 'SS2', '+60123456002', null, '{}', null, 'cash', '[{"item_type":"paper","est_kg":5}]')::text);
select t_su();
select t_ok((select count(*) from job_offers where job_id = t_get('far')::uuid) >= 1, 'no one within 5km: ring widened until providers were found');
select t_ok((select search_round from jobs where id = t_get('far')::uuid) >= 3, 'far job reached the 20 km ring');
select t_ok((select max(distance_m) from job_offers where job_id = t_get('near')::uuid) <= 5000, 'near job offered only within 5 km ring');
update job_offers set expires_at = now() - interval '1 second' where job_id = t_get('far')::uuid;
select sweep_jobs();
select t_ok((select status from jobs where id = t_get('far')::uuid) in ('searching','expired'), 'sweep handles lapsed offers');
update jobs set search_round = 4 where id = t_get('far')::uuid;
update job_offers set status = 'expired' where job_id = t_get('far')::uuid;
select sweep_jobs();
select t_ok((select status from jobs where id = t_get('far')::uuid) = 'expired', 'instant job expires after the last ring is exhausted');
select t_ok(exists (select 1 from outbox where kind = 'job_expired'), 'customer notified when no provider found');
select 'ALL FLOW TESTS PASSED' as result;
