# Database

PostgreSQL 15+ with PostGIS (extensions live in the `extensions` schema so PostgREST does not expose them). Source of truth: `supabase/migrations/`.

```
auth.users ─1:1─ profiles(role: customer|provider|admin, lang, pdpa_consent_at)
profiles ─1:n─ addresses · device_tokens
profiles ─1:1─ providers(status pending|approved|rejected|suspended, radius_km≤30, online, last_geog)
providers ─n:m─ categories (provider_categories.from_price_cents) · provider_prices · provider_documents(kind, status)
categories(booking_type instant|scheduled|quote|queue, enabled, commission_pct, from_price_cents, license_kind, repeat_days)
regions(code, center, radius_km, enabled)                ← launch switch: PJ, SUBANG, SHAH enabled
jobs(status, type, area_geog snapped, price, commission, payout, pay_status, search_round)
  ├─ job_private (exact address, geog, phone)             ← RLS: customer + assigned provider only
  ├─ job_offers (instant/scheduled/quote dispatch)  ├─ quotes (≤3)  ├─ scrap_items (est/actual kg, rate snapshot)
  ├─ job_tracking (1 row, live lat/lng)  ├─ job_events  ├─ messages  ├─ reviews  ├─ reports(disputes/refunds)  ├─ payments (placeholder)
sos_events · recurring_bookings(auto_book) · promos · scrap_rates
shops ─ shop_staff · queue_counters · queue_tickets(client_id idempotency) · kiosk_pairings · kiosk_devices(token_hash)
outbox (push queue)  ← written by triggers, drained by the `push` Edge Function
```

## Indexes (every filtered / joined / sorted column)
`jobs`: (customer_id, created_at desc), (provider_id, status, created_at desc), (status, created_at desc), (category_id), partial (scheduled_at), GiST (area_geog) ·
`providers`: GiST (last_geog), (status, online), **partial GiST (last_geog) WHERE approved AND online** — what instant dispatch scans ·
`job_offers`: (provider_id, status, expires_at) · `quotes`: (job_id, status) · `messages`: (job_id, id desc) ·
`queue_tickets`: (shop_id, day, status, number), (customer_id, created_at desc), unique (shop_id, day, number), unique (client_id) ·
`categories`: (enabled, sort) · `reviews`: (provider_id, created_at desc) · `reports`: (status, created_at desc) · `recurring_bookings`: partial (next_at) WHERE active.

## Matching ("nearest providers")
`dispatch_job` uses **expanding rings** (5 → 10 → 20 → 30 km). Each ring is a constant-radius `ST_DWithin` that the partial GiST index serves, then the provider's own `radius_km`, then `ORDER BY distance LIMIT 5`. Instant jobs only consider online providers seen in the last 3 h who are not already on a job. `sweep_jobs()` (pg_cron, every minute) widens to the next ring when offers lapse (45 s), expires exhausted jobs, creates repeat bookings and sets providers idle > 8 h offline.

## Security model
* RLS on every table; `anon`/`authenticated` start with **no** privileges (`revoke all`), then the minimum is granted: column-level grants hide `providers.last_geog`/`ic_last4` and make `profiles.role` immutable from clients.
* Business writes are `SECURITY DEFINER` RPCs with `search_path` pinned; internal helpers (`dispatch_job`, `_queue_*`, `notify`, `sweep_jobs`) are not executable by clients.
* **Customer phone/address hidden until accepted**: `jobs` (visible to offered providers) carries only a ~500 m-snapped point; `job_private` becomes readable to the provider only after `accept_offer`/`accept_quote` assigns them, and again closes 7 days after completion.
* Kiosk tokens are random 256-bit values; only the SHA-256 is stored.

## Money
Commission = `round(price × categories.commission_pct / 100)` stored on the job at completion. **Scrap assumption:** the customer receives `payout_cents` (cash, from the provider); the platform fee is `commission_pct` of that payout, charged to the provider (it appears as a negative amount in their statement). Change `complete_scrap` if your business model differs.
Cash jobs are marked `paid` when the provider completes them; DuitNow/FPX are enum values and a `payments` table only — **no gateway is implemented**.
