-- Business logic lives in SECURITY DEFINER RPCs so clients stay thin and rules cannot be bypassed.
-- Errors are short machine codes (e.g. 'already_taken') that the app maps to localized text.

create function is_admin() returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and deleted_at is null) $$;

create function is_shop_staff(p_shop uuid) returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from shop_staff where shop_id = p_shop and user_id = auth.uid())
      or exists (select 1 from shops where id = p_shop and owner_id = auth.uid()) $$;

create function pt(p_lat double precision, p_lng double precision) returns geography language sql immutable as $$
  select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography $$;

create function snap_area(g geography) returns geography language sql immutable as $$
  select st_snaptogrid(g::geometry, 0.005)::geography $$;   -- ~500 m: enough for "2.3 km away", not a house

create function me_provider() returns providers language plpgsql stable security definer set search_path = public, extensions as $$
declare r providers;
begin
  select * into r from providers where id = auth.uid() and status = 'approved';
  if not found then raise exception 'not_approved_provider'; end if;
  return r;
end $$;

-- ---------- home feed: ONE small request (categories + promos + book-again) ----------
create function home_feed() returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id',id,'slug',slug,'name',name,'icon',icon,
        'type',booking_type,'from',from_price_cents,'label',price_label,'repeat',repeat_days) order by sort)
        from categories where enabled), '[]'),
    'promos', coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'img',image_url,'cat',category_id))
        from (select * from promos where active and (ends_at is null or ends_at > now()) order by starts_at desc limit 5) p), '[]'),
    'again', coalesce((select jsonb_agg(jsonb_build_object('id',id,'cat',category_id,'at',created_at))
        from (select distinct on (category_id) id, category_id, created_at from jobs
              where customer_id = auth.uid() and status = 'done' order by category_id, created_at desc) j), '[]'));
$$;

-- ---------- region / dispatch ----------
create function region_for(p_geog geography) returns text language sql stable security definer set search_path = public, extensions as $$
  select code from regions where enabled and st_dwithin(center, p_geog, radius_km * 1000)
  order by st_distance(center, p_geog) limit 1 $$;

-- Expanding-ring dispatch (like ride-hailing): offer the nearest providers within 5 km; if nobody is eligible
-- widen to 10 / 20 / 30 km. Small rings keep the spatial-index scan tiny and put the closest provider first.
create function dispatch_job(p_job uuid, p_n int) returns int language plpgsql security definer set search_path = public, extensions as $$
declare j jobs; priv job_private; ttl interval; added int := 0; rnd int; ring int[] := array[5000, 10000, 20000, 30000];
begin
  select * into j from jobs where id = p_job;
  select * into priv from job_private where job_id = p_job;
  ttl := case j.type when 'instant' then interval '45 seconds' when 'scheduled' then interval '12 hours' else interval '24 hours' end;
  rnd := case when j.type = 'instant' then j.search_round else 3 end;
  loop
    insert into job_offers (job_id, provider_id, distance_m, expires_at)
    select p_job, p.id, st_distance(p.last_geog, priv.geog)::int, now() + ttl
      from providers p
      join provider_categories pc on pc.provider_id = p.id and pc.category_id = j.category_id
     where p.status = 'approved'
       and p.last_geog is not null
       and (j.type <> 'instant' or (p.online and p.last_seen > now() - interval '3 hours'))
       and st_dwithin(p.last_geog, priv.geog, ring[least(rnd, 3) + 1])   -- constant radius: GiST index does the work
       and st_dwithin(p.last_geog, priv.geog, p.radius_km * 1000)        -- then the provider's own service radius
       and not exists (select 1 from job_offers o where o.job_id = p_job and o.provider_id = p.id)
       and (j.type <> 'instant' or not exists (select 1 from jobs a where a.provider_id = p.id
              and a.status in ('accepted','on_the_way','arrived','in_progress')))
     order by st_distance(p.last_geog, priv.geog)
     limit p_n;
    get diagnostics added = row_count;
    rnd := rnd + 1;
    exit when added > 0 or rnd > 3;
  end loop;
  update jobs set search_round = rnd where id = p_job;
  return added;
end $$;

create function create_job(p_category smallint, p_lat double precision, p_lng double precision, p_address text,
    p_phone text, p_description text default null, p_photos text[] default '{}',
    p_scheduled timestamptz default null, p_pay pay_method default 'cash', p_scrap jsonb default null,
    p_id uuid default gen_random_uuid())
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare c categories; g geography := pt(p_lat, p_lng); rc text; jid uuid; st job_status;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  select * into c from categories where id = p_category and enabled;
  if not found or c.booking_type = 'queue' then raise exception 'category_unavailable'; end if;
  rc := region_for(g);
  if rc is null then raise exception 'area_not_served'; end if;
  if c.booking_type = 'scheduled' and (p_scheduled is null or p_scheduled < now() + interval '1 hour') then
    raise exception 'bad_schedule'; end if;
  if c.booking_type = 'quote' and coalesce(array_length(p_photos,1),0) = 0 then raise exception 'photos_required'; end if;
  if c.is_scrap and (p_scrap is null or jsonb_array_length(p_scrap) = 0) then raise exception 'scrap_items_required'; end if;
  st := case c.booking_type when 'instant' then 'searching' when 'quote' then 'quoting' else 'pending' end;

  insert into jobs (id, customer_id, category_id, type, status, region_code, area_geog, description, photos,
                    scheduled_at, pay_method, price_cents)
  values (p_id, auth.uid(), p_category, c.booking_type, st, rc, snap_area(g), p_description, p_photos,
          case when c.booking_type = 'scheduled' then p_scheduled end, p_pay,
          case when c.booking_type = 'instant' then c.from_price_cents end)
  returning id into jid;
  insert into job_private (job_id, address_line, geog, contact_phone) values (jid, p_address, g, p_phone);
  insert into job_events (job_id, actor_id, status) values (jid, auth.uid(), st);

  if c.is_scrap then
    insert into scrap_items (job_id, item_type, est_kg)
    select jid, x->>'item_type', (x->>'est_kg')::numeric from jsonb_array_elements(p_scrap) x;
  end if;
  perform dispatch_job(jid, case c.booking_type when 'instant' then 5 else 10 end);
  return jid;
end $$;

-- ---------- provider side of dispatch ----------
create function accept_offer(p_job uuid) returns void language plpgsql security definer set search_path = public, extensions as $$
declare me providers := me_provider(); j jobs; n int; fp int;
begin
  perform 1 from job_offers where job_id = p_job and provider_id = me.id and status = 'offered' and expires_at > now();
  if not found then raise exception 'offer_expired'; end if;
  select pc.from_price_cents into fp from provider_categories pc
    join jobs jj on jj.category_id = pc.category_id where jj.id = p_job and pc.provider_id = me.id;
  -- first to accept wins: single atomic UPDATE
  update jobs set provider_id = me.id, status = 'accepted', accepted_at = now(),
         price_cents = coalesce(fp, price_cents)
   where id = p_job and provider_id is null and status in ('searching','pending');
  get diagnostics n = row_count;
  if n = 0 then raise exception 'already_taken'; end if;
  update job_offers set status = case when provider_id = me.id then 'accepted'::offer_status else 'expired'::offer_status end
   where job_id = p_job and status = 'offered';
  insert into job_events (job_id, actor_id, status) values (p_job, me.id, 'accepted');
end $$;

create function decline_offer(p_job uuid) returns void language sql security definer set search_path = public, extensions as $$
  update job_offers set status = 'declined' where job_id = p_job and provider_id = auth.uid() and status = 'offered' $$;

create function enforce_max_quotes() returns trigger language plpgsql as $$
begin
  if (select count(*) from quotes where job_id = new.job_id and status in ('sent','accepted')) >= 3 then
    raise exception 'quote_limit'; end if;
  return new;
end $$;
create trigger quotes_max3 before insert on quotes for each row execute function enforce_max_quotes();

create function submit_quote(p_job uuid, p_price integer, p_message text default null) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare me providers := me_provider(); qid uuid;
begin
  perform 1 from job_offers o join jobs j on j.id = o.job_id
   where o.job_id = p_job and o.provider_id = me.id and j.status = 'quoting' and o.status in ('offered','accepted');
  if not found then raise exception 'not_quotable'; end if;
  insert into quotes (job_id, provider_id, price_cents, message) values (p_job, me.id, p_price, p_message)
  on conflict (job_id, provider_id) do update set price_cents = excluded.price_cents, message = excluded.message
  returning id into qid;
  update job_offers set status = 'accepted' where job_id = p_job and provider_id = me.id;
  return qid;
end $$;

create function accept_quote(p_quote uuid) returns void language plpgsql security definer set search_path = public, extensions as $$
declare q quotes; n int;
begin
  select * into q from quotes where id = p_quote and status = 'sent';
  if not found then raise exception 'quote_gone'; end if;
  update jobs set provider_id = q.provider_id, price_cents = q.price_cents, status = 'accepted', accepted_at = now()
   where id = q.job_id and customer_id = auth.uid() and status = 'quoting';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'not_allowed'; end if;
  update quotes set status = case when id = p_quote then 'accepted' else 'rejected' end where job_id = q.job_id and status = 'sent';
  update job_offers set status = 'expired' where job_id = q.job_id and status = 'offered';
  insert into job_events (job_id, actor_id, status) values (q.job_id, auth.uid(), 'accepted');
end $$;

-- ---------- job lifecycle ----------
create function set_job_status(p_job uuid, p_to job_status) returns void language plpgsql security definer set search_path = public, extensions as $$
declare j jobs; is_prov boolean; is_cust boolean; ok boolean; pct numeric; comm int;
begin
  select * into j from jobs where id = p_job for update;
  if not found then raise exception 'not_found'; end if;
  is_prov := j.provider_id = auth.uid(); is_cust := j.customer_id = auth.uid();
  if not (is_prov or is_cust) then raise exception 'not_allowed'; end if;

  ok := (is_prov and ((j.status, p_to) in (('accepted','on_the_way'),('on_the_way','arrived'),('arrived','in_progress'),('in_progress','done'))))
     or ((is_prov or is_cust) and p_to = 'cancelled' and j.status in ('searching','quoting','pending','accepted','on_the_way','arrived'));
  if not ok then raise exception 'bad_transition'; end if;
  if p_to = 'done' and (select is_scrap from categories where id = j.category_id) then raise exception 'use_complete_scrap'; end if;
  if p_to = 'done' and j.price_cents is null then raise exception 'price_required'; end if;

  update jobs set status = p_to,
         started_at   = case when p_to = 'in_progress' then now() else started_at end,
         done_at      = case when p_to = 'done' then now() else done_at end,
         cancelled_at = case when p_to = 'cancelled' then now() else cancelled_at end
   where id = p_job;
  if p_to = 'done' then
    select commission_pct into pct from categories where id = j.category_id;
    comm := round(j.price_cents * pct / 100.0);
    update jobs set commission_cents = comm, pay_status = case when pay_method = 'cash' then 'paid'::pay_status else pay_status end where id = p_job;
    update providers set jobs_done = jobs_done + 1 where id = j.provider_id;
  end if;
  if p_to in ('done','cancelled') then
    delete from job_tracking where job_id = p_job;          -- location stops being shared
    update job_offers set status = 'expired' where job_id = p_job and status = 'offered';
  end if;
  insert into job_events (job_id, actor_id, status) values (p_job, auth.uid(), p_to);
end $$;

create function set_final_price(p_job uuid, p_price integer) returns void language sql security definer set search_path = public, extensions as $$
  update jobs set price_cents = p_price where id = p_job and provider_id = auth.uid()
     and status in ('arrived','in_progress') and p_price > 0 $$;

-- Scrap: provider weighs on site; payout = sum(actual_kg * rate). Customer RECEIVES money.
create function complete_scrap(p_job uuid, p_items jsonb) returns integer language plpgsql security definer set search_path = public, extensions as $$
declare j jobs; x jsonb; rate int; total int; pct numeric;
begin
  select * into j from jobs where id = p_job for update;
  if j.provider_id is distinct from auth.uid() or j.status not in ('arrived','in_progress') then raise exception 'not_allowed'; end if;
  for x in select * from jsonb_array_elements(p_items) loop
    select cents_per_kg into rate from scrap_rates where item_type = x->>'item_type' and active;
    if rate is null then raise exception 'unknown_item'; end if;
    update scrap_items set actual_kg = (x->>'actual_kg')::numeric, cents_per_kg = rate
     where job_id = p_job and item_type = x->>'item_type';
    if not found then
      insert into scrap_items (job_id, item_type, est_kg, actual_kg, cents_per_kg)
      values (p_job, x->>'item_type', greatest((x->>'actual_kg')::numeric, 0.1), (x->>'actual_kg')::numeric, rate);
    end if;
  end loop;
  select coalesce(sum(round(actual_kg * cents_per_kg)), 0)::int into total from scrap_items where job_id = p_job and actual_kg is not null;
  select commission_pct into pct from categories where id = j.category_id;
  -- Assumption (see docs): platform fee = commission_pct of the payout, charged to the provider.
  update jobs set status = 'done', done_at = now(), payout_cents = total, price_cents = 0,
         commission_cents = round(total * pct / 100.0),
         pay_status = case when pay_method = 'cash' then 'payout_done'::pay_status else 'payout_due'::pay_status end
   where id = p_job;
  update providers set jobs_done = jobs_done + 1 where id = auth.uid();
  delete from job_tracking where job_id = p_job;
  insert into job_events (job_id, actor_id, status) values (p_job, auth.uid(), 'done');
  return total;
end $$;

-- Live tracking: only while a job is active. Server-side throttle protects battery/DB.
create function ping_location(p_job uuid, p_lat double precision, p_lng double precision, p_heading smallint default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare g geography := pt(p_lat, p_lng);
begin
  perform 1 from jobs where id = p_job and provider_id = auth.uid() and status in ('accepted','on_the_way','arrived');
  if not found then raise exception 'not_active'; end if;
  insert into job_tracking (job_id, provider_id, geog, lat, lng, heading) values (p_job, auth.uid(), g, p_lat, p_lng, p_heading)
  on conflict (job_id) do update set geog = excluded.geog, lat = excluded.lat, lng = excluded.lng, heading = excluded.heading, updated_at = now()
   where job_tracking.updated_at < now() - interval '4 seconds';
  update providers set last_geog = g, last_seen = now() where id = auth.uid();
end $$;

-- Single position fix when going online / app resume. No background location.
create function set_online(p_online boolean, p_lat double precision default null, p_lng double precision default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform me_provider();
  update providers set online = p_online,
         last_geog = coalesce(case when p_lat is not null then pt(p_lat, p_lng) end, last_geog),
         last_seen = now()
   where id = auth.uid();
end $$;

-- ---------- after the job ----------
create function submit_review(p_job uuid, p_rating smallint, p_comment text default null, p_tip integer default 0)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare j jobs;
begin
  select * into j from jobs where id = p_job and customer_id = auth.uid() and status = 'done';
  if not found then raise exception 'not_allowed'; end if;
  insert into reviews (job_id, customer_id, provider_id, rating, comment) values (p_job, auth.uid(), j.provider_id, p_rating, p_comment);
  update providers set rating_avg = round((rating_avg * rating_count + p_rating) / (rating_count + 1), 2),
                       rating_count = rating_count + 1 where id = j.provider_id;
  if p_tip > 0 then update jobs set tip_cents = p_tip where id = p_job; end if;
end $$;

create function report_problem(p_job uuid, p_reason text) returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare j jobs; rid uuid;
begin
  select * into j from jobs where id = p_job and (customer_id = auth.uid() or provider_id = auth.uid());
  if not found then raise exception 'not_allowed'; end if;
  if now() - coalesce(j.done_at, j.cancelled_at, j.created_at) > interval '7 days' then raise exception 'report_window_closed'; end if;
  insert into reports (job_id, reporter_id, reason) values (p_job, auth.uid(), p_reason) returning id into rid;
  return rid;
end $$;

create function send_sos(p_job uuid, p_lat double precision, p_lng double precision) returns void language sql security definer set search_path = public, extensions as $$
  insert into sos_events (user_id, job_id, geog) values (auth.uid(), p_job, pt(p_lat, p_lng)) $$;

create function repeat_job(p_job uuid, p_every_days smallint, p_auto_book boolean default false) returns void language sql security definer set search_path = public, extensions as $$
  insert into recurring_bookings (customer_id, source_job, every_days, auto_book, next_at)
  select customer_id, id, p_every_days, p_auto_book, (now() at time zone 'Asia/Kuala_Lumpur')::date + p_every_days
    from jobs where id = p_job and customer_id = auth.uid() and status = 'done' $$;

-- ---------- provider onboarding / admin ----------
create function provider_earnings(p_days int default 30) returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object('jobs', count(*), 'gross', coalesce(sum(price_cents),0), 'commission', coalesce(sum(commission_cents),0),
         'tips', coalesce(sum(tip_cents),0), 'scrap_payouts', coalesce(sum(payout_cents),0),
         'net', coalesce(sum(coalesce(price_cents,0) - commission_cents + tip_cents),0))   -- scrap jobs: price 0, so net = -fee
  from jobs where provider_id = auth.uid() and status = 'done' and done_at > now() - make_interval(days => p_days) $$;

create function become_provider(p_categories smallint[], p_radius numeric, p_ic_last4 text, p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if (select pdpa_consent_at from profiles where id = auth.uid()) is null then raise exception 'consent_required'; end if;
  insert into providers (id, radius_km, ic_last4, last_geog) values (auth.uid(), p_radius, p_ic_last4, pt(p_lat, p_lng))
  on conflict (id) do update set radius_km = excluded.radius_km, ic_last4 = excluded.ic_last4;
  insert into provider_categories (provider_id, category_id) select auth.uid(), unnest(p_categories) on conflict do nothing;
  update profiles set role = 'provider' where id = auth.uid() and role = 'customer';
end $$;

create function admin_set_provider_status(p_provider uuid, p_status provider_status) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_admin() then raise exception 'not_allowed'; end if;
  if p_status = 'approved' then
    if exists (select 1 from provider_categories pc join categories c on c.id = pc.category_id
                where pc.provider_id = p_provider and c.license_kind is not null
                  and not exists (select 1 from provider_documents d where d.provider_id = p_provider
                                   and d.kind = c.license_kind and d.status = 'approved')) then
      raise exception 'license_missing'; end if;
  end if;
  update providers set status = p_status, online = online and p_status = 'approved' where id = p_provider;
end $$;

create function demand_heatmap(p_days int default 30) returns table (lat double precision, lng double precision, jobs bigint, category_id smallint)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not is_admin() then raise exception 'not_allowed'; end if;
  return query
  select st_y(st_snaptogrid(area_geog::geometry, 0.01)), st_x(st_snaptogrid(area_geog::geometry, 0.01)), count(*), j.category_id
    from jobs j where created_at > now() - make_interval(days => p_days)
   group by 1, 2, 4;
end $$;

-- ---------- PDPA ----------
create function delete_my_account() returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from addresses where user_id = auth.uid();
  delete from device_tokens where user_id = auth.uid();
  delete from job_private where job_id in (select id from jobs where customer_id = auth.uid());
  update messages set body = '[deleted]' where sender_id = auth.uid();
  update providers set online = false, status = 'suspended', photo_url = null, bio = null, ic_last4 = null, last_geog = null where id = auth.uid();
  update profiles set full_name = 'Deleted user', phone = null, avatar_url = null, deleted_at = now() where id = auth.uid();
  -- Job rows stay (anonymised) for accounting/dispute records; sign-in is disabled.
  update auth.users set phone = null, email = null, banned_until = 'infinity' where id = auth.uid();
end $$;

-- ---------- background sweep (pg_cron, server side; the apps never poll) ----------
create function sweep_jobs() returns void language plpgsql security definer set search_path = public, extensions as $$
declare r record; added int;
begin
  update job_offers set status = 'expired' where status = 'offered' and expires_at < now();
  -- instant: when a ring's offers lapse unanswered, widen to the next ring; after the last ring give up
  for r in select id, search_round from jobs j where type = 'instant' and status = 'searching'
              and not exists (select 1 from job_offers o where o.job_id = j.id and o.status = 'offered') loop
    added := case when r.search_round > 3 then 0 else dispatch_job(r.id, 5) end;
    if added = 0 then
      update jobs set status = 'expired' where id = r.id;
      insert into job_events (job_id, status) values (r.id, 'expired');
    end if;
  end loop;
  update jobs set status = 'expired' where status = 'pending' and scheduled_at < now();
  update jobs set status = 'expired' where status = 'quoting' and created_at < now() - interval '48 hours';
  -- providers who forgot to go offline stop being matched after 8 h
  update providers set online = false where online and last_seen < now() - interval '8 hours';
  -- recurring bookings: auto_book creates + dispatches the next scheduled job; otherwise just remind the customer
  for r in select rb.id, rb.customer_id, rb.next_at, rb.every_days, rb.auto_book, jp.address_line, jp.geog, jp.contact_phone, j.id as src, j.category_id, j.description
             from recurring_bookings rb join jobs j on j.id = rb.source_job join job_private jp on jp.job_id = j.id
            where rb.active and rb.next_at <= (now() at time zone 'Asia/Kuala_Lumpur')::date loop
    update recurring_bookings set next_at = next_at + every_days where id = r.id;
    if r.auto_book and region_for(r.geog) is not null and exists (select 1 from categories c where c.id = r.category_id and c.enabled) then
      declare nid uuid;
      begin
        insert into jobs (customer_id, category_id, type, status, region_code, area_geog, description, scheduled_at, repeat_of)
        values (r.customer_id, r.category_id, 'scheduled', 'pending', region_for(r.geog), snap_area(r.geog), r.description,
                (r.next_at::timestamp + time '10:00') at time zone 'Asia/Kuala_Lumpur', r.src) returning id into nid;
        insert into job_private (job_id, address_line, geog, contact_phone) values (nid, r.address_line, r.geog, r.contact_phone);
        insert into job_events (job_id, actor_id, status) values (nid, r.customer_id, 'pending');
        perform dispatch_job(nid, 10);
        perform notify(r.customer_id, 'repeat_booked', jsonb_build_object('job_id', nid));
      end;
    else
      perform notify(r.customer_id, 'repeat_reminder', jsonb_build_object('category_id', r.category_id, 'source_job', r.src));
    end if;
  end loop;
end $$;

-- ================= SHOP QUEUE =================
create function kl_today() returns date language sql stable as $$ select (now() at time zone 'Asia/Kuala_Lumpur')::date $$;

create function next_number(p_shop uuid, p_count int default 1) returns int language plpgsql security definer set search_path = public, extensions as $$
declare last int;
begin
  insert into queue_counters (shop_id, day, last_number) values (p_shop, kl_today(), p_count)
  on conflict (shop_id, day) do update set last_number = queue_counters.last_number + p_count
  returning last_number into last;
  return last - p_count + 1;                       -- first number of the reserved block
end $$;

create function join_queue(p_shop uuid) returns queue_tickets language plpgsql security definer set search_path = public, extensions as $$
declare t queue_tickets;
begin
  perform 1 from shops where id = p_shop and open;
  if not found then raise exception 'shop_closed'; end if;
  select * into t from queue_tickets where shop_id = p_shop and customer_id = auth.uid() and day = kl_today() and status in ('waiting','called','serving');
  if found then return t; end if;
  insert into queue_tickets (shop_id, number, customer_id, source) values (p_shop, next_number(p_shop), auth.uid(), 'app') returning * into t;
  return t;
end $$;

create function cancel_ticket(p_ticket uuid) returns void language sql security definer set search_path = public, extensions as $$
  update queue_tickets set status = 'cancelled' where id = p_ticket and customer_id = auth.uid() and status in ('waiting','called') $$;

create function queue_snapshot(p_shop uuid) returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'serving', (select max(number) from queue_tickets where shop_id = p_shop and day = kl_today() and status in ('called','serving')),
    'waiting', (select count(*) from queue_tickets where shop_id = p_shop and day = kl_today() and status = 'waiting'),
    'wait_secs', (select count(*) * s.avg_service_secs from queue_tickets t where t.shop_id = p_shop and t.day = kl_today() and t.status = 'waiting'),
    'open', s.open)
  from shops s where s.id = p_shop $$;

create function ticket_position(p_ticket uuid) returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object('number', t.number, 'status', t.status,
    'ahead', case when t.status = 'waiting' then (select count(*) from queue_tickets o where o.shop_id = t.shop_id and o.day = t.day and o.status = 'waiting' and o.number < t.number) end,
    'wait_secs', case when t.status = 'waiting' then (select count(*) + 1 from queue_tickets o where o.shop_id = t.shop_id and o.day = t.day and o.status = 'waiting' and o.number < t.number) * s.avg_service_secs end,
    'serving', (select max(number) from queue_tickets o where o.shop_id = t.shop_id and o.day = t.day and o.status in ('called','serving')))
  from queue_tickets t join shops s on s.id = t.shop_id
  where t.id = p_ticket and t.customer_id = auth.uid() $$;

-- core counter operations (shared by staff app and kiosk)
create function _queue_next(p_shop uuid) returns queue_tickets language plpgsql security definer set search_path = public, extensions as $$
declare cur queue_tickets; nxt queue_tickets;
begin
  for cur in select * from queue_tickets where shop_id = p_shop and day = kl_today() and status in ('called','serving') loop
    update queue_tickets set status = 'done', done_at = now() where id = cur.id;
    if cur.called_at is not null then   -- EMA of service time, clamped to 1..60 min
      update shops set avg_service_secs = greatest(60, least(3600,
        round(0.8 * avg_service_secs + 0.2 * extract(epoch from now() - cur.called_at)))) where id = p_shop;
    end if;
  end loop;
  select * into nxt from queue_tickets where shop_id = p_shop and day = kl_today() and status = 'waiting' order by number limit 1 for update skip locked;
  if found then update queue_tickets set status = 'called', called_at = now() where id = nxt.id returning * into nxt; end if;
  return nxt;
end $$;

create function _queue_skip(p_shop uuid) returns queue_tickets language plpgsql security definer set search_path = public, extensions as $$
begin
  update queue_tickets set status = 'skipped', done_at = now() where shop_id = p_shop and day = kl_today() and status in ('called','serving');
  return _queue_next(p_shop);
end $$;

create function _queue_recall(p_shop uuid) returns queue_tickets language sql security definer set search_path = public, extensions as $$
  update queue_tickets set called_at = now() where shop_id = p_shop and day = kl_today() and status in ('called','serving') returning * $$;

create function queue_next(p_shop uuid)  returns queue_tickets language plpgsql security definer set search_path = public, extensions as $$
begin if not is_shop_staff(p_shop) then raise exception 'not_allowed'; end if; return _queue_next(p_shop); end $$;
create function queue_skip(p_shop uuid)  returns queue_tickets language plpgsql security definer set search_path = public, extensions as $$
begin if not is_shop_staff(p_shop) then raise exception 'not_allowed'; end if; return _queue_skip(p_shop); end $$;
create function queue_recall(p_shop uuid) returns queue_tickets language plpgsql security definer set search_path = public, extensions as $$
begin if not is_shop_staff(p_shop) then raise exception 'not_allowed'; end if; return _queue_recall(p_shop); end $$;

-- ---------- kiosk (Raspberry Pi) ----------
create function _kiosk_shop(p_token text) returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare s uuid;
begin
  update kiosk_devices set last_seen = now()
   where token_hash = encode(digest(p_token, 'sha256'), 'hex') and not revoked returning shop_id into s;
  if s is null then raise exception 'bad_kiosk_token'; end if;
  return s;
end $$;

create function kiosk_pair_start() returns text language plpgsql security definer set search_path = public, extensions as $$
declare c text := upper(encode(gen_random_bytes(5), 'hex'));
begin
  delete from kiosk_pairings where expires_at < now();
  insert into kiosk_pairings (code, expires_at) values (c, now() + interval '10 minutes');
  return c;
end $$;

create function kiosk_pair_claim(p_code text, p_shop uuid, p_name text default 'Kiosk') returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_shop_staff(p_shop) then raise exception 'not_allowed'; end if;
  update kiosk_pairings set shop_id = p_shop, device_name = p_name, claimed_at = now()
   where code = p_code and expires_at > now() and shop_id is null;
  if not found then raise exception 'bad_code'; end if;
end $$;

-- Pi calls this while showing the QR. Returns the secret token exactly once, then the pairing row is deleted.
create function kiosk_pair_poll(p_code text) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare p kiosk_pairings; tok text;
begin
  select * into p from kiosk_pairings where code = p_code and expires_at > now();
  if not found then return jsonb_build_object('status','expired'); end if;
  if p.shop_id is null then return jsonb_build_object('status','waiting'); end if;
  tok := encode(gen_random_bytes(32), 'hex');
  insert into kiosk_devices (shop_id, name, token_hash) values (p.shop_id, coalesce(p.device_name,'Kiosk'), encode(digest(tok, 'sha256'), 'hex'));
  delete from kiosk_pairings where code = p_code;
  return jsonb_build_object('status','paired','token',tok,'shop_id',p.shop_id);
end $$;

create function kiosk_create_ticket(p_token text, p_client_id uuid, p_label text default null) returns queue_tickets
language plpgsql security definer set search_path = public, extensions as $$
declare s uuid := _kiosk_shop(p_token); t queue_tickets;
begin
  select * into t from queue_tickets where client_id = p_client_id;
  if found then return t; end if;                                   -- idempotent retry
  insert into queue_tickets (shop_id, number, label, source, client_id) values (s, next_number(s), p_label, 'kiosk', p_client_id) returning * into t;
  return t;
end $$;

-- Offline support: reserve a block of numbers while online, then issue from it with no connection.
create function kiosk_reserve_block(p_token text, p_size int default 50) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare s uuid := _kiosk_shop(p_token); first int;
begin
  first := next_number(s, least(greatest(p_size,1), 200));
  return jsonb_build_object('first', first, 'last', first + least(greatest(p_size,1),200) - 1, 'day', kl_today());
end $$;

-- Kiosk is authoritative for tickets it issued; replay is idempotent via client_id.
create function kiosk_sync(p_token text, p_tickets jsonb) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare s uuid := _kiosk_shop(p_token); x jsonb; n int := 0;
begin
  for x in select * from jsonb_array_elements(p_tickets) loop
    insert into queue_tickets (shop_id, day, number, label, source, client_id, status, created_at, called_at, done_at)
    values (s, (x->>'day')::date, (x->>'number')::int, x->>'label', 'kiosk', (x->>'client_id')::uuid,
            (x->>'status')::ticket_status, (x->>'created_at')::timestamptz, (x->>'called_at')::timestamptz, (x->>'done_at')::timestamptz)
    on conflict (client_id) do update set status = excluded.status, called_at = excluded.called_at, done_at = excluded.done_at
      where queue_tickets.shop_id = s;
    n := n + 1;
  end loop;
  return jsonb_build_object('synced', n);
end $$;

create function kiosk_call_next(p_token text) returns queue_tickets language plpgsql security definer set search_path = public, extensions as $$
begin return _queue_next(_kiosk_shop(p_token)); end $$;
create function kiosk_recall(p_token text) returns queue_tickets language plpgsql security definer set search_path = public, extensions as $$
begin return _queue_recall(_kiosk_shop(p_token)); end $$;
create function kiosk_snapshot(p_token text) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin return queue_snapshot(_kiosk_shop(p_token)); end $$;


-- ================= app helper RPCs (PostgREST would return raw EWKB for geography columns) =================
create function my_addresses() returns table (id uuid, label text, line text, lat double precision, lng double precision)
language sql stable as $$   -- SECURITY INVOKER: RLS limits rows to the caller
  select id, label, line, st_y(geog::geometry), st_x(geog::geometry) from addresses where user_id = auth.uid() order by created_at desc limit 20 $$;

create function add_address(p_label text, p_line text, p_lat double precision, p_lng double precision) returns uuid
language sql security definer set search_path = public, extensions as $$
  insert into addresses (user_id, label, line, geog) values (auth.uid(), p_label, p_line, pt(p_lat, p_lng)) returning id $$;

-- Exact address/phone: visible only through job_private RLS (customer, or provider once assigned).
create function job_contact(p_job uuid) returns table (address_line text, lat double precision, lng double precision, contact_phone text)
language sql stable as $$
  select address_line, st_y(geog::geometry), st_x(geog::geometry), contact_phone from job_private where job_id = p_job $$;

create function nearby_shops(p_lat double precision default null, p_lng double precision default null, p_limit int default 20, p_offset int default 0)
returns table (id uuid, name text, kind text, address text, open boolean, distance_m integer, waiting integer, wait_secs integer)
language sql stable security definer set search_path = public, extensions as $$
  select s.id, s.name, s.kind, s.address, s.open,
         case when p_lat is not null and s.geog is not null then st_distance(s.geog, pt(p_lat, p_lng))::int end,
         (select count(*)::int from queue_tickets t where t.shop_id = s.id and t.day = kl_today() and t.status = 'waiting'),
         (select count(*)::int * s.avg_service_secs from queue_tickets t where t.shop_id = s.id and t.day = kl_today() and t.status = 'waiting')
    from shops s where s.open
   order by case when p_lat is not null and s.geog is not null then st_distance(s.geog, pt(p_lat, p_lng)) end nulls last, s.name
   limit least(p_limit, 20) offset p_offset $$;

-- Nearest approved providers for a category, public fields only (no exact positions).
create function nearby_providers(p_category smallint, p_lat double precision, p_lng double precision, p_limit int default 10)
returns table (id uuid, full_name text, photo_url text, rating_avg numeric, rating_count int, distance_m integer, from_price_cents integer)
language sql stable security definer set search_path = public, extensions as $$
  select p.id, pr.full_name, p.photo_url, p.rating_avg, p.rating_count, st_distance(p.last_geog, pt(p_lat, p_lng))::int, pc.from_price_cents
    from providers p join profiles pr on pr.id = p.id join provider_categories pc on pc.provider_id = p.id and pc.category_id = p_category
   where p.status = 'approved' and p.last_geog is not null
     and st_dwithin(p.last_geog, pt(p_lat, p_lng), 30000) and st_dwithin(p.last_geog, pt(p_lat, p_lng), p.radius_km * 1000)
   order by p.last_geog <-> pt(p_lat, p_lng) limit least(p_limit, 20) $$;

create function admin_sos() returns table (id uuid, who text, phone text, job_id uuid, lat double precision, lng double precision, created_at timestamptz)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not is_admin() then raise exception 'not_allowed'; end if;
  return query select s.id, p.full_name, p.phone, s.job_id, st_y(s.geog::geometry), st_x(s.geog::geometry), s.created_at
    from sos_events s join profiles p on p.id = s.user_id where not s.resolved order by s.created_at desc limit 50;
end $$;
