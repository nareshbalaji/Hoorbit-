# API

GiliranBox has no custom server: the API is **Supabase PostgREST + RPC + Realtime + Storage**, secured by Row Level Security.
Base URL `https://<ref>.supabase.co`. Every request carries `apikey: <anon key>`; signed-in calls add `Authorization: Bearer <user JWT>`.
Money is integer **sen** (RM1 = 100). Times are UTC `timestamptz`; display in Asia/Kuala_Lumpur (UTC+8, no DST).

* **All writes with business rules are RPCs** → [`API_RPC.md`](API_RPC.md) (generated from the live schema; 40+ functions).
* **Reads use table endpoints** with `select=` (request only the columns a screen needs) and `limit=20` + keyset cursors.
* Errors: HTTP 400 `{"message":"<code>"}`; codes are stable machine strings (`already_taken`, `area_not_served`, …) the app maps to BM/EN/中文.

## Auth (phone + OTP)
```bash
curl -X POST $URL/auth/v1/otp -H "apikey: $ANON" -H 'content-type: application/json' -d '{"phone":"+60123456002"}'
curl -X POST $URL/auth/v1/verify -H "apikey: $ANON" -H 'content-type: application/json' -d '{"type":"sms","phone":"+60123456002","token":"123456"}'
# → { "access_token": "...", "user": { "id": "..." } }
```
PDPA consent is stored on `profiles.pdpa_consent_at` right after verification; `become_provider` refuses without it.

## Typical flows

**Instant (scrap pickup)**
```bash
# 1. customer
POST /rest/v1/rpc/create_job   {"p_category":3,"p_lat":3.119,"p_lng":101.62,"p_address":"No 12, SS2","p_phone":"+60123456002",
                                "p_scrap":[{"item_type":"paper","est_kg":20},{"item_type":"iron","est_kg":10}]}      → job uuid
# 2. nearest ≤5 online providers get a push + a realtime INSERT on job_offers (rings widen to 10/20/30 km if nobody is eligible)
# 3. provider: first call wins, the rest get 'already_taken'
POST /rest/v1/rpc/accept_offer {"p_job":"<uuid>"}
# 4. provider streams location every 5–10 s ONLY while accepted/on_the_way/arrived
POST /rest/v1/rpc/ping_location {"p_job":"<uuid>","p_lat":3.11,"p_lng":101.61}
POST /rest/v1/rpc/set_job_status {"p_job":"<uuid>","p_to":"on_the_way"}      # → arrived
# 5. provider weighs on site; payout = Σ round(kg × per-kg rate); customer is PAID
POST /rest/v1/rpc/complete_scrap {"p_job":"<uuid>","p_items":[{"item_type":"paper","actual_kg":18.5},{"item_type":"iron","actual_kg":12}]}   → 1543
```
**Scheduled (aircond / cleaning)** — `create_job` with `p_scheduled` (≥ 1 h ahead) → offers to nearby providers (12 h) → `accept_offer` confirms → `set_job_status`.
**Quote (painting, moving, repairs)** — `create_job` with `p_photos` (≥ 1) → providers `submit_quote` (max 3, DB-enforced) → customer `accept_quote`.

## Tables readable through PostgREST (RLS)
| Table | Who can read | Notes |
|---|---|---|
| `categories` `scrap_rates` `promos` | everyone (only `enabled`/`active` rows) | admin sees all and can write |
| `regions` | everyone | admin writes |
| `profiles` | self; counterpart on a shared job/quote; admin | `role` is not client-writable (column grants) |
| `providers` | approved providers; self; admin | `last_geog`, `ic_last4` are **not selectable** |
| `jobs` | customer; assigned provider; providers holding an open offer; admin | public location snapped to ~500 m |
| `job_private` (address, phone) | customer; **assigned provider only**, until 7 days after completion | use RPC `job_contact` for lat/lng |
| `job_offers` | the offered provider | |
| `quotes` | the job's customer; the quoting provider | providers never see each other's quotes |
| `job_tracking` | the job's customer; the provider | one row per active job, deleted when the job ends |
| `messages` | the two participants | writable by participants while job active/≤7 days after |
| `queue_tickets` | ticket owner; shop staff | everyone else gets numbers only via `queue_snapshot` |
| `outbox`, `queue_counters`, `kiosk_pairings` | nobody (service role / RPC only) | |

## Realtime (opened only by a screen that needs it, closed on dispose)
| Channel | Subscribed by | Event |
|---|---|---|
| `postgres_changes` `jobs` `id=eq.<job>` | customer job screen | status changes |
| `postgres_changes` `quotes` INSERT `job_id=eq.<job>` | customer job screen while `quoting` | new quote |
| `postgres_changes` `job_tracking` `job_id=eq.<job>` | tracking map (`on_the_way` only) | `{lat,lng}` every 5–10 s |
| `postgres_changes` `job_offers` INSERT `provider_id=eq.<me>` | provider home tab | new job (rings) |
| `postgres_changes` `messages` INSERT `job_id=eq.<job>` | chat screen | new message |
| `postgres_changes` `queue_tickets` UPDATE `id=eq.<ticket>` / `shop_id=eq.<shop>` | customer ticket / staff counter | own ticket / all tickets |
| **broadcast** `shop:<shop uuid>` event `call` `{number, recall_at}` | ticket screen, Pi TV | public, **no personal data** |
Everything else (status updates when the app is closed, new quotes, chat, "your turn") is a **push notification** drained from `outbox`.

## Storage
| Bucket | Access | Path |
|---|---|---|
| `public-img` | public via CDN | `<uid>/avatar/<ts>.webp`, promo images — WebP, ≤ 300 KB |
| `job-photos` | private; owner, offered/assigned providers (via `can_see_job`), admin | `<customer uid>/<job uuid>/<ts>.webp` |
| `provider-docs` | private; owner + admin (signed URLs) | `<uid>/<doc kind>/<ts>.webp` |

## Shop-queue REST for the Raspberry Pi kiosk
The kiosk is not a Supabase user; it authenticates with a **device token** minted once at QR pairing and stored as a SHA-256 hash.
All calls are `POST /rest/v1/rpc/<fn>` with only the anon key.
```bash
# pair (Pi shows QR giliranbox://pair?code=<code>; staff scans it in the app → kiosk_pair_claim)
curl -X POST $URL/rest/v1/rpc/kiosk_pair_start -H "apikey: $ANON" -d '{}'                         # → "9F3A1C07BE"
curl -X POST $URL/rest/v1/rpc/kiosk_pair_poll  -H "apikey: $ANON" -H 'content-type: application/json' -d '{"p_code":"9F3A1C07BE"}'
#   → {"status":"waiting"} … then once: {"status":"paired","token":"<64 hex>","shop_id":"…"}
# work online
… /rpc/kiosk_create_ticket {"p_token":"…","p_client_id":"<uuid>","p_label":"Walk-in"}              # idempotent
… /rpc/kiosk_call_next     {"p_token":"…"}     …/rpc/kiosk_recall {"p_token":"…"}     …/rpc/kiosk_snapshot {"p_token":"…"}
# work offline: reserve numbers while online, issue locally, replay later
… /rpc/kiosk_reserve_block {"p_token":"…","p_size":100}                                           # → {"first":1,"last":100,"day":"2026-…"}
… /rpc/kiosk_sync          {"p_token":"…","p_tickets":[{"client_id":"…","day":"…","number":7,"status":"done","label":"…","created_at":"…","called_at":"…","done_at":"…"}]}
```
Revoke a kiosk: `PATCH /rest/v1/kiosk_devices?id=eq.<id>` `{"revoked":true}` as shop staff (no app button yet) → next call returns `bad_kiosk_token` and the Pi re-pairs.
