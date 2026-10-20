# GiliranBox

Grab-style app (Android + iOS) for booking local services **and** joining shop queues in Malaysia.
Flutter app + Supabase (Postgres/PostGIS, Auth, Realtime, Storage) + Firebase push + a static admin panel + a Raspberry Pi queue kiosk.
Performance-first: small binary, cached/offline-first screens, tiny payloads, realtime only where a screen is watching.

> **Read [`docs/STATUS.md`](docs/STATUS.md) first** — it lists exactly what has been verified, what has not (no APK was built or
> timed on a device in the environment this was written in), and what is a placeholder.

## Repository layout

| Path | What |
|---|---|
| `app/` | Flutter app (customer + provider mode + shop-staff counter). 34 Dart files (~3,100 lines), 14 direct dependencies, system fonts. |
| `supabase/migrations/` | `001` schema · `002` business-logic RPCs · `003` RLS + grants + push outbox · `004` realtime/storage/cron |
| `supabase/seed.sql` | Launch config + 10 providers around Petaling Jaya + demo customers/admin/shops |
| `supabase/tests/` | 83 SQL assertions (`run.sh`), backend benchmark (`perf.sh`) |
| `supabase/functions/` | `push` (outbox → FCM, BM/EN/中文), `mask-call` (placeholder) |
| `admin/` | Admin web panel (static HTML + ES module, no build step) |
| `kiosk/` | Raspberry Pi kiosk (ticket button, ESC/POS printer, TV display, offline-first sync) + 10 tests |
| `tools/` | `build_release.sh` (15 MB gate), `measure_android.sh` (on-device proof), `gen_api_docs.py` |
| `docs/` | SETUP, API, API_RPC (generated), DATABASE, KIOSK, PERFORMANCE, COMPLIANCE, STATUS |

## Launch configuration (as requested)

* **Regions enabled:** Petaling Jaya, Subang Jaya, Shah Alam (`regions.enabled`). A booking outside them fails with `area_not_served`.
* **Categories enabled:** Aircond servicing (scheduled), House cleaning (scheduled), Scrap & recycling pickup (instant, customer is *paid*).
  The other 17 categories are seeded but `enabled = false` — hidden from the app (RLS hides them from non-admins) until an admin ticks them in the panel.
* **Queue at a shop** is a separate entry on Home (not a grid category); any shop with `open = true` appears. Three demo shops are seeded.
* Booking types: `instant` (nearest providers, first-accept wins, live map) · `scheduled` (date + 2 h slot, provider confirms) · `quote` (photos + description, ≤ 3 quotes, customer picks).

## Quick start (about 15 minutes)

```bash
# 1. Database (any Postgres 15+ with PostGIS, or a Supabase project in ap-southeast-1 / Singapore)
supabase/tests/run.sh                      # local proof: applies migrations + seed, runs all SQL tests
# on Supabase: paste supabase/migrations/*.sql then supabase/seed.sql into the SQL editor (or `supabase db push`)

# 2. App
cd app && flutter pub get
flutter run --dart-define=SUPABASE_URL=https://<ref>.supabase.co --dart-define=SUPABASE_ANON_KEY=<anon>
#   demo login: +60 12-345 6002 (customer), OTP 123456   |  provider: +60 12-345 7001 .. 7010  |  admin: +60 12-345 6001
```

Full steps (Firebase, Google Maps keys, Edge Functions, webhook, admin hosting, kiosk): [`docs/SETUP.md`](docs/SETUP.md).

## Demo accounts (after `seed.sql` + `config.toml` test OTPs; OTP is always `123456`)

| Phone | Role |
|---|---|
| +60 12-345 6001 | Admin (web panel) |
| +60 12-345 6002 · 6003 | Customers (Aisyah in PJ, Mei Ling in USJ) |
| +60 12-345 6004 | Shop staff (counter screen for the 3 demo shops) |
| +60 12-345 7001 … 7010 | 10 providers (#7010 is *pending* so you can demo approval; #7006 and #7009 are offline) |

Remove the `[auth.sms.test_otp]` block before production.

## Run the tests

```bash
supabase/tests/run.sh                         # 83 SQL assertions (RLS, dispatch, scrap payout, queue, kiosk, PDPA)
supabase/tests/perf.sh                        # backend benchmark on 20,000 synthetic providers
cd kiosk && python3 -m unittest test_kiosk test_integration    # offline/online kiosk logic (+ against the real SQL)
node --experimental-strip-types supabase/functions/push/messages.test.ts
cd app && flutter analyze && flutter test
```
