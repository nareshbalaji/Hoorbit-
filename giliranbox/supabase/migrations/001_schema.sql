-- GiliranBox schema. Supabase (Singapore region). Timezone: Asia/Kuala_Lumpur.
-- Every filtered / joined / ordered column has an index (see bottom of each table).

-- Extensions live in the `extensions` schema (Supabase default) so PostgREST does not expose PostGIS/pgcrypto
-- functions as public RPCs. Supabase's default search_path already includes it.
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------- enums ----------
create type user_role     as enum ('customer','provider','admin');
create type booking_type  as enum ('instant','scheduled','quote','queue');
create type job_status    as enum ('searching','quoting','pending','accepted','on_the_way',
                                   'arrived','in_progress','done','cancelled','expired');
create type provider_status as enum ('pending','approved','rejected','suspended');
create type offer_status  as enum ('offered','accepted','declined','expired');
create type pay_method    as enum ('cash','duitnow','fpx');
create type pay_status    as enum ('unpaid','paid','refunded','payout_due','payout_done');
create type ticket_status as enum ('waiting','called','serving','done','skipped','cancelled');

-- ---------- regions (launch config: only enabled regions accept bookings) ----------
create table regions (
  code       text primary key,
  name       text not null,
  center     geography(point,4326) not null,
  radius_km  numeric not null default 10,
  enabled    boolean not null default false
);
create index regions_geo_idx on regions using gist (center);

-- ---------- users ----------
create table profiles (
  id               uuid primary key references auth.users on delete cascade,
  role             user_role not null default 'customer',
  full_name        text,
  phone            text,
  lang             text not null default 'ms' check (lang in ('ms','en','zh')),
  avatar_url       text,
  pdpa_consent_at  timestamptz,
  pdpa_version     text,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index profiles_role_idx on profiles (role);

create table addresses (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references profiles on delete cascade,
  label    text not null,
  line     text not null,
  geog     geography(point,4326) not null,
  created_at timestamptz not null default now()
);
create index addresses_user_idx on addresses (user_id);

create table device_tokens (
  token    text primary key,
  user_id  uuid not null references profiles on delete cascade,
  platform text not null check (platform in ('android','ios','web')),
  updated_at timestamptz not null default now()
);
create index device_tokens_user_idx on device_tokens (user_id);

-- ---------- catalogue ----------
create table categories (
  id               smallint generated always as identity primary key,
  slug             text unique not null,
  name             jsonb not null,                  -- {"en":..,"ms":..,"zh":..}
  icon             text not null default 'build',   -- material icon name, no image download
  booking_type     booking_type not null,
  enabled          boolean not null default false,  -- admin switch; hidden when false
  is_scrap         boolean not null default false,
  commission_pct   numeric not null default 15 check (commission_pct between 0 and 50),
  from_price_cents integer,                         -- "from RMxx" shown upfront
  price_label      jsonb,                           -- {"en":"Wall unit from","ms":"Unit dinding dari"}
  license_kind     text,                            -- e.g. 'electrical_competency'
  repeat_days      smallint,                        -- suggested reminder, e.g. 120 for aircond
  sort             smallint not null default 100
);
create index categories_enabled_idx on categories (enabled, sort);

create table scrap_rates (                          -- per-kg price list (customer payout)
  id            smallint generated always as identity primary key,
  item_type     text unique not null,
  name          jsonb not null,
  cents_per_kg  integer not null check (cents_per_kg >= 0),
  active        boolean not null default true
);

create table promos (
  id        uuid primary key default gen_random_uuid(),
  title     jsonb not null,
  code      text unique,
  image_url text,
  category_id smallint references categories,
  discount_pct numeric,
  starts_at timestamptz not null default now(),
  ends_at   timestamptz,
  active    boolean not null default true
);
create index promos_active_idx on promos (active, ends_at);

-- ---------- providers ----------
create table providers (
  id            uuid primary key references profiles on delete cascade,
  status        provider_status not null default 'pending',
  ic_last4      text,                                -- IC verification placeholder (no full IC stored)
  ic_verified   boolean not null default false,
  photo_url     text,
  bio           text,
  radius_km     numeric not null default 10 check (radius_km between 1 and 30),   -- 30 km = global dispatch cap (see dispatch_job)
  online        boolean not null default false,
  last_geog     geography(point,4326),
  last_seen     timestamptz,
  rating_avg    numeric(3,2) not null default 0,
  rating_count  integer not null default 0,
  jobs_done     integer not null default 0,
  created_at    timestamptz not null default now()
);
create index providers_geo_idx    on providers using gist (last_geog);
create index providers_match_idx  on providers (status, online);
-- partial spatial index: instant dispatch only ever scans approved + online providers
create index providers_online_geo_idx on providers using gist (last_geog) where status = 'approved' and online;

create table provider_categories (
  provider_id uuid references providers on delete cascade,
  category_id smallint references categories on delete cascade,
  from_price_cents integer,
  primary key (provider_id, category_id)
);
create index provider_categories_cat_idx on provider_categories (category_id);

create table provider_prices (
  id          uuid primary key default gen_random_uuid(),
  provider_id uuid not null references providers on delete cascade,
  category_id smallint not null references categories,
  item        text not null,
  price_cents integer not null check (price_cents >= 0)
);
create index provider_prices_idx on provider_prices (provider_id, category_id);

create table provider_documents (
  id          uuid primary key default gen_random_uuid(),
  provider_id uuid not null references providers on delete cascade,
  kind        text not null,                          -- ic_front, electrical_competency, pest_license ...
  file_path   text not null,                          -- storage path (private bucket)
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at  timestamptz not null default now()
);
create index provider_documents_idx on provider_documents (provider_id, status);

-- ---------- jobs ----------
create table jobs (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references profiles,
  provider_id    uuid references providers,
  category_id    smallint not null references categories,
  type           booking_type not null,
  status         job_status not null,
  region_code    text references regions,
  area_geog      geography(point,4326) not null,      -- snapped to ~500m grid; exact point is in job_private
  description    text,
  photos         text[] not null default '{}',        -- storage paths, WebP <300KB
  scheduled_at   timestamptz,
  price_cents    integer,                             -- agreed / final price
  payout_cents   integer,                             -- scrap: amount customer receives
  tip_cents      integer not null default 0,
  commission_cents integer not null default 0,
  pay_method     pay_method not null default 'cash',
  pay_status     pay_status not null default 'unpaid',
  repeat_of      uuid references jobs,
  search_round   smallint not null default 0,         -- instant dispatch ring: 0=5km 1=10km 2=20km 3=30km
  created_at     timestamptz not null default now(),
  accepted_at    timestamptz,
  started_at     timestamptz,
  done_at        timestamptz,
  cancelled_at   timestamptz
);
create index jobs_customer_idx  on jobs (customer_id, created_at desc);
create index jobs_provider_idx  on jobs (provider_id, status, created_at desc);
create index jobs_status_idx    on jobs (status, created_at desc);
create index jobs_category_idx  on jobs (category_id);
create index jobs_sched_idx     on jobs (scheduled_at) where scheduled_at is not null;
create index jobs_area_idx      on jobs using gist (area_geog);

-- Hidden until accepted: exact address, phone. RLS exposes it only to customer and assigned provider.
create table job_private (
  job_id        uuid primary key references jobs on delete cascade,
  address_line  text not null,
  geog          geography(point,4326) not null,
  contact_phone text
);

create table job_offers (
  job_id      uuid references jobs on delete cascade,
  provider_id uuid references providers on delete cascade,
  status      offer_status not null default 'offered',
  distance_m  integer not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  primary key (job_id, provider_id)
);
create index job_offers_provider_idx on job_offers (provider_id, status, expires_at);

create table quotes (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references jobs on delete cascade,
  provider_id uuid not null references providers,
  price_cents integer not null check (price_cents > 0),
  message     text,
  status      text not null default 'sent' check (status in ('sent','accepted','rejected','withdrawn')),
  created_at  timestamptz not null default now(),
  unique (job_id, provider_id)
);
create index quotes_job_idx on quotes (job_id, status);

create table scrap_items (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references jobs on delete cascade,
  item_type    text not null references scrap_rates (item_type),
  est_kg       numeric not null check (est_kg > 0),
  actual_kg    numeric check (actual_kg >= 0),
  cents_per_kg integer                                -- snapshot of rate at weigh-in
);
create index scrap_items_job_idx on scrap_items (job_id);

create table job_tracking (                           -- 1 row per active job, upserted every 5-10 s
  job_id     uuid primary key references jobs on delete cascade,
  provider_id uuid not null references providers,
  geog       geography(point,4326) not null,
  lat        double precision not null,                -- plain numbers so realtime payloads are directly usable
  lng        double precision not null,
  heading    smallint,
  updated_at timestamptz not null default now()
);

create table job_events (
  id         bigint generated always as identity primary key,
  job_id     uuid not null references jobs on delete cascade,
  actor_id   uuid,
  status     job_status not null,
  created_at timestamptz not null default now()
);
create index job_events_job_idx on job_events (job_id, id);

create table messages (
  id         bigint generated always as identity primary key,
  job_id     uuid not null references jobs on delete cascade,
  sender_id  uuid not null references profiles,
  body       text not null check (length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index messages_job_idx on messages (job_id, id desc);

create table reviews (
  job_id      uuid primary key references jobs on delete cascade,
  customer_id uuid not null references profiles,
  provider_id uuid not null references providers,
  rating      smallint not null check (rating between 1 and 5),
  comment     text,
  created_at  timestamptz not null default now()
);
create index reviews_provider_idx on reviews (provider_id, created_at desc);

create table reports (                                -- "report a problem" within 7 days; also disputes/refunds
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references jobs,
  reporter_id   uuid not null references profiles,
  reason        text not null,
  status        text not null default 'open' check (status in ('open','investigating','resolved','refunded','rejected')),
  refund_cents  integer not null default 0,
  admin_note    text,
  created_at    timestamptz not null default now()
);
create index reports_status_idx on reports (status, created_at desc);

create table sos_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles,
  job_id     uuid references jobs,
  geog       geography(point,4326),
  resolved   boolean not null default false,
  created_at timestamptz not null default now()
);
create index sos_open_idx on sos_events (resolved, created_at desc);

create table recurring_bookings (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles on delete cascade,
  source_job  uuid not null references jobs,
  every_days  smallint not null check (every_days between 1 and 730),
  auto_book   boolean not null default false,          -- true: create the next booking; false: just remind the customer
  next_at     date not null,
  active      boolean not null default true
);
create index recurring_due_idx on recurring_bookings (next_at) where active;

create table payments (                               -- placeholder for DuitNow / FPX gateway
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references jobs,
  method     pay_method not null,
  amount_cents integer not null,
  status     text not null default 'pending',
  gateway_ref text,
  created_at timestamptz not null default now()
);
create index payments_job_idx on payments (job_id);

-- ---------- shop queue ----------
create table shops (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references profiles,
  name        text not null,
  kind        text not null default 'other',          -- clinic*, workshop, pharmacy, barber (*non-medical-service, queue only)
  address     text,
  geog        geography(point,4326),
  open        boolean not null default true,
  avg_service_secs integer not null default 300,       -- rolling average, updated when tickets complete
  created_at  timestamptz not null default now()
);
create index shops_geo_idx on shops using gist (geog);
create index shops_owner_idx on shops (owner_id);

create table shop_staff (
  shop_id uuid references shops on delete cascade,
  user_id uuid references profiles on delete cascade,
  primary key (shop_id, user_id)
);
create index shop_staff_user_idx on shop_staff (user_id);

create table queue_counters (
  shop_id     uuid references shops on delete cascade,
  day         date not null,
  last_number integer not null default 0,
  primary key (shop_id, day)
);

create table queue_tickets (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references shops on delete cascade,
  day         date not null default (now() at time zone 'Asia/Kuala_Lumpur')::date,
  number      integer not null,
  customer_id uuid references profiles,
  label       text,                                    -- walk-in name / phone tail
  source      text not null default 'app' check (source in ('app','kiosk','staff')),
  client_id   uuid unique,                             -- idempotency key from offline kiosk
  status      ticket_status not null default 'waiting',
  created_at  timestamptz not null default now(),
  called_at   timestamptz,
  done_at     timestamptz,
  unique (shop_id, day, number)
);
create index queue_waiting_idx on queue_tickets (shop_id, day, status, number);
create index queue_customer_idx on queue_tickets (customer_id, created_at desc);

create table kiosk_pairings (                         -- QR payload = code; staff scans in app, Pi polls claim endpoint
  code       text primary key,
  shop_id    uuid references shops on delete cascade,  -- null until claimed by staff
  device_name text,
  token_hash text,                                    -- sha256 of kiosk token once claimed
  expires_at timestamptz not null,
  claimed_at timestamptz
);

create table kiosk_devices (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references shops on delete cascade,
  name       text not null,
  token_hash text not null unique,
  last_seen  timestamptz,
  revoked    boolean not null default false
);
create index kiosk_devices_shop_idx on kiosk_devices (shop_id);

-- ---------- signup hook: profile row for every auth user ----------
create function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, phone) values (new.id, new.phone) on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();
