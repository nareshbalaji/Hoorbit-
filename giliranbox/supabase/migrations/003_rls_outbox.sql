-- Row Level Security. Default-deny: no table privileges except what is granted below.
-- Writes go through RPCs (002_functions.sql); direct writes are limited to a few self-owned tables.

revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

create function can_see_job(p_job uuid) returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from jobs j where j.id = p_job and (
       j.customer_id = auth.uid() or j.provider_id = auth.uid()
    or exists (select 1 from job_offers o where o.job_id = j.id and o.provider_id = auth.uid() and o.status in ('offered','accepted'))))
  or is_admin() $$;

create function is_participant(p_job uuid) returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from jobs j where j.id = p_job and (j.customer_id = auth.uid() or j.provider_id = auth.uid())) $$;

-- ---------- public catalogue ----------
alter table categories enable row level security;
alter table scrap_rates enable row level security;
alter table promos enable row level security;
alter table regions enable row level security;
grant select on categories, scrap_rates, promos, regions to anon, authenticated;
grant insert, update, delete on categories, scrap_rates, promos, regions to authenticated;
create policy cat_read   on categories for select using (enabled or is_admin());
create policy cat_admin  on categories for all    using (is_admin()) with check (is_admin());
create policy rate_read  on scrap_rates for select using (active or is_admin());
create policy rate_admin on scrap_rates for all    using (is_admin()) with check (is_admin());
create policy promo_read on promos for select using (active or is_admin());
create policy promo_admin on promos for all    using (is_admin()) with check (is_admin());
create policy region_read on regions for select using (true);
create policy region_admin on regions for all    using (is_admin()) with check (is_admin());

-- ---------- profiles ----------
alter table profiles enable row level security;
grant select on profiles to authenticated;
grant update (full_name, lang, avatar_url, phone, pdpa_consent_at, pdpa_version) on profiles to authenticated;  -- NOT role
create policy prof_read on profiles for select using (
     id = auth.uid() or is_admin()
  or exists (select 1 from jobs j where (j.customer_id = profiles.id and j.provider_id = auth.uid())
                                      or (j.provider_id = profiles.id and j.customer_id = auth.uid()))
  or exists (select 1 from quotes q join jobs j on j.id = q.job_id where q.provider_id = profiles.id and j.customer_id = auth.uid()));
create policy prof_update on profiles for update using (id = auth.uid()) with check (id = auth.uid());

alter table addresses enable row level security;
grant select, insert, update, delete on addresses to authenticated;
create policy addr_own on addresses for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table device_tokens enable row level security;
grant select, insert, update, delete on device_tokens to authenticated;
create policy tok_own on device_tokens for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- providers ----------
alter table providers enable row level security;
-- last_geog and ic_last4 are deliberately not selectable by clients
grant select (id, status, ic_verified, photo_url, bio, radius_km, online, rating_avg, rating_count, jobs_done, created_at) on providers to authenticated;
grant update (photo_url, bio, radius_km) on providers to authenticated;
create policy prov_read   on providers for select using (status = 'approved' or id = auth.uid() or is_admin());
create policy prov_update on providers for update using (id = auth.uid()) with check (id = auth.uid());

alter table provider_categories enable row level security;
grant select, insert, delete on provider_categories to authenticated;
create policy pc_read  on provider_categories for select using (true);
create policy pc_write on provider_categories for insert with check (provider_id = auth.uid());
create policy pc_del   on provider_categories for delete using (provider_id = auth.uid());

alter table provider_prices enable row level security;
grant select, insert, update, delete on provider_prices to authenticated;
create policy pp_read  on provider_prices for select using (true);
create policy pp_own   on provider_prices for all using (provider_id = auth.uid()) with check (provider_id = auth.uid());

alter table provider_documents enable row level security;
grant select, insert on provider_documents to authenticated;
grant update (status) on provider_documents to authenticated;
create policy pd_read   on provider_documents for select using (provider_id = auth.uid() or is_admin());
create policy pd_insert on provider_documents for insert with check (provider_id = auth.uid() and status = 'pending');
create policy pd_admin  on provider_documents for update using (is_admin()) with check (is_admin());

-- ---------- jobs & friends ----------
alter table jobs enable row level security;
grant select on jobs to authenticated;
create policy jobs_read on jobs for select using (can_see_job(id));

alter table job_private enable row level security;
grant select on job_private to authenticated;
-- exact address/phone: customer always; provider only once assigned, and only until 7 days after completion
create policy jp_read on job_private for select using (exists (select 1 from jobs j where j.id = job_id and (
     j.customer_id = auth.uid()
  or (j.provider_id = auth.uid() and (j.status not in ('done','cancelled') or coalesce(j.done_at, j.cancelled_at) > now() - interval '7 days')))));

alter table job_offers enable row level security;
grant select on job_offers to authenticated;
create policy off_read on job_offers for select using (provider_id = auth.uid() or is_admin());

alter table quotes enable row level security;
grant select on quotes to authenticated;
create policy q_read on quotes for select using (provider_id = auth.uid()
  or exists (select 1 from jobs j where j.id = job_id and j.customer_id = auth.uid()) or is_admin());

alter table scrap_items enable row level security;
grant select on scrap_items to authenticated;
create policy si_read on scrap_items for select using (can_see_job(job_id));

alter table job_tracking enable row level security;
grant select on job_tracking to authenticated;
create policy jt_read on job_tracking for select using (provider_id = auth.uid()
  or exists (select 1 from jobs j where j.id = job_id and j.customer_id = auth.uid()));

alter table job_events enable row level security;
grant select on job_events to authenticated;
create policy je_read on job_events for select using (is_participant(job_id) or is_admin());

alter table messages enable row level security;
grant select, insert on messages to authenticated;
create policy msg_read   on messages for select using (is_participant(job_id) or is_admin());
create policy msg_insert on messages for insert with check (sender_id = auth.uid() and is_participant(job_id)
  and exists (select 1 from jobs j where j.id = job_id and j.provider_id is not null and j.status not in ('cancelled','expired')
              and coalesce(j.done_at, now()) > now() - interval '7 days'));

alter table reviews enable row level security;
grant select on reviews to authenticated;
create policy rev_read on reviews for select using (true);

alter table reports enable row level security;
grant select on reports to authenticated;
grant update (status, refund_cents, admin_note) on reports to authenticated;
create policy rep_read  on reports for select using (reporter_id = auth.uid() or is_admin());
create policy rep_admin on reports for update using (is_admin()) with check (is_admin());

alter table sos_events enable row level security;
grant select on sos_events to authenticated;
grant update (resolved) on sos_events to authenticated;
create policy sos_read  on sos_events for select using (is_admin());
create policy sos_admin on sos_events for update using (is_admin()) with check (is_admin());

alter table recurring_bookings enable row level security;
grant select, update on recurring_bookings to authenticated;
create policy rb_own on recurring_bookings for all using (customer_id = auth.uid()) with check (customer_id = auth.uid());

alter table payments enable row level security;
grant select on payments to authenticated;
create policy pay_read on payments for select using (is_participant(job_id) or is_admin());

-- ---------- shop queue ----------
alter table shops enable row level security;
grant select on shops to authenticated;
grant insert, update on shops to authenticated;
create policy shop_read   on shops for select using (open or owner_id = auth.uid() or is_admin());
create policy shop_admin  on shops for all using (is_admin()) with check (is_admin());
create policy shop_owner  on shops for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

alter table shop_staff enable row level security;
grant select, insert, delete on shop_staff to authenticated;
create policy ss_read  on shop_staff for select using (user_id = auth.uid() or is_shop_staff(shop_id) or is_admin());
create policy ss_admin on shop_staff for all using (is_admin() or exists (select 1 from shops s where s.id = shop_id and s.owner_id = auth.uid()))
                                       with check (is_admin() or exists (select 1 from shops s where s.id = shop_id and s.owner_id = auth.uid()));

alter table queue_counters enable row level security;     -- no policies: RPC only
alter table queue_tickets enable row level security;
grant select on queue_tickets to authenticated;
create policy qt_read on queue_tickets for select using (customer_id = auth.uid() or is_shop_staff(shop_id) or is_admin());

alter table kiosk_pairings enable row level security;      -- no policies: RPC only
alter table kiosk_devices enable row level security;
grant select (id, shop_id, name, last_seen, revoked) on kiosk_devices to authenticated;
grant update (revoked) on kiosk_devices to authenticated;
create policy kd_read   on kiosk_devices for select using (is_shop_staff(shop_id) or is_admin());
create policy kd_revoke on kiosk_devices for update using (is_shop_staff(shop_id)) with check (is_shop_staff(shop_id));

-- ---------- function privileges ----------
grant execute on all functions in schema public to authenticated;
revoke execute on function dispatch_job(uuid,int), sweep_jobs(), next_number(uuid,int), _queue_next(uuid), _queue_skip(uuid),
  _queue_recall(uuid), _kiosk_shop(text), handle_new_user(), enforce_max_quotes() from authenticated;
-- the Pi kiosk is unauthenticated at the Supabase-JWT level; it authenticates with its own device token
grant execute on function kiosk_pair_start(), kiosk_pair_poll(text), kiosk_create_ticket(text,uuid,text), kiosk_reserve_block(text,int),
  kiosk_sync(text,jsonb), kiosk_call_next(text), kiosk_recall(text), kiosk_snapshot(text), queue_snapshot(uuid) to anon;

-- ---------- push outbox (an Edge Function drains it; see supabase/functions/push) ----------
create table outbox (
  id       bigint generated always as identity primary key,
  user_id  uuid not null references profiles on delete cascade,
  kind     text not null,
  data     jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table outbox enable row level security;               -- service role only

create function notify(p_user uuid, p_kind text, p_data jsonb) returns void language sql security definer set search_path = public, extensions as $$
  insert into outbox (user_id, kind, data) values (p_user, p_kind, p_data) $$;
revoke execute on function notify(uuid,text,jsonb) from public, anon, authenticated;

create function trg_offer_notify() returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin perform notify(new.provider_id, 'new_job', jsonb_build_object('job_id', new.job_id, 'distance_m', new.distance_m)); return new; end $$;
create trigger offer_notify after insert on job_offers for each row execute function trg_offer_notify();

create function trg_job_notify() returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.status is distinct from old.status then
    if new.status in ('accepted','on_the_way','arrived','in_progress','done','expired') then
      perform notify(new.customer_id, 'job_' || new.status, jsonb_build_object('job_id', new.id)); end if;
    if new.status = 'cancelled' and new.provider_id is not null then
      perform notify(case when auth.uid() = new.customer_id then new.provider_id else new.customer_id end, 'job_cancelled', jsonb_build_object('job_id', new.id)); end if;
  end if;
  return new;
end $$;
create trigger job_notify after update of status on jobs for each row execute function trg_job_notify();

create function trg_quote_notify() returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin perform notify((select customer_id from jobs where id = new.job_id), 'new_quote', jsonb_build_object('job_id', new.job_id, 'price_cents', new.price_cents)); return new; end $$;
create trigger quote_notify after insert on quotes for each row execute function trg_quote_notify();

create function trg_msg_notify() returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare j jobs;
begin
  select * into j from jobs where id = new.job_id;
  perform notify(case when new.sender_id = j.customer_id then j.provider_id else j.customer_id end, 'chat', jsonb_build_object('job_id', new.job_id));
  return new;
end $$;
create trigger msg_notify after insert on messages for each row execute function trg_msg_notify();

create function trg_ticket_notify() returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare third uuid;
begin
  if new.status = 'called' and new.customer_id is not null and (tg_op = 'INSERT' or old.status is distinct from 'called' or old.called_at is distinct from new.called_at) then
    perform notify(new.customer_id, 'your_turn', jsonb_build_object('ticket_id', new.id, 'number', new.number));
  end if;
  if tg_op = 'UPDATE' and new.status = 'called' and old.status = 'waiting' then
    select customer_id into third from queue_tickets where shop_id = new.shop_id and day = new.day and status = 'waiting'
     and customer_id is not null order by number offset 2 limit 1;
    if third is not null then perform notify(third, 'almost_turn', jsonb_build_object('shop_id', new.shop_id)); end if;
  end if;
  return new;
end $$;
create trigger ticket_notify after insert or update on queue_tickets for each row execute function trg_ticket_notify();
