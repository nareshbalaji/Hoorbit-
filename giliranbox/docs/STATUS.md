# Status: what is verified, what is not, what is a placeholder

## Verified (actually executed)
| What | How |
|---|---|
| Schema, 4 migrations, seed load cleanly | Postgres 16 + PostGIS 3.4 (`supabase/tests/run.sh`) with a **stubbed** `auth` schema and real `anon`/`authenticated` roles |
| 91 behavioural assertions | RLS & privacy (address/phone hidden until accept, tracking visibility, role escalation blocked, hidden columns, 7-day windows), instant dispatch with expanding rings, first-accept-wins, scheduled flow + commission, quote flow (max 3), **scrap payout maths**, queue NEXT/RECALL/SKIP, kiosk pairing/offline blocks/sync, recurring (auto-book vs reminder), idle-provider handling, SOS, admin gates & licence gate, PDPA deletion, push-outbox rows |
| Backend speed | `perf.sh`: 20k providers → nearest-5 in 6.3 ms using the partial GiST index; `create_job` median 1.2 ms |
| Kiosk logic | 9 unit tests (fake server) + 1 end-to-end test against the real SQL functions; HTTP layer smoke-tested with curl (PIN gate, ticket, next) |
| Push copy | BM/EN/中文 for 14 event kinds (Node test) |
| Flutter code | `flutter analyze` 0 issues; 5 tests (formatting, KL time, translation completeness, skeleton widget) |
| Maps only in deferred libs | import-graph grep |

## NOT verified — please do before launch
1. **No APK/AAB/IPA was built.** The Android SDK could not be downloaded in the authoring environment. APK size, cold start, FPS, memory and low-end-device behaviour are therefore **unmeasured** (see `PERFORMANCE.md`; scripts are ready).
2. **The app has never run against a live Supabase project or on a device/emulator**, and no screen has been rendered or screenshotted. Compile-level correctness is covered by the analyzer; runtime behaviour of the UI is not. Likely first-run issues: PostgREST embed syntax in a few `select()` strings (`provider:providers(...)`, `profiles!jobs_customer_id_fkey(...)`), Realtime filters, Storage policy paths. The FK constraint names used were verified to exist.
3. **Supabase-hosted pieces untested**: Auth phone provider (stubbed in tests), Realtime (publication + `realtime.send` broadcast trigger are guarded and untested), Storage policies, `pg_cron` schedule, Edge Functions `push` (FCM v1 JWT flow) and `mask-call`.
4. **Firebase/APNs** not configured (needs your `google-services.json` / `GoogleService-Info.plist`); iOS never built (Maps key must be added to `AppDelegate`).
5. **Admin panel** was syntax-checked only, never loaded in a browser.
6. CI workflow (`.github/workflows/giliranbox.yml`) has not been run.

## Placeholders (by design, per the brief)
* **Payments**: DuitNow / FPX are disabled radio options + enum values + a `payments` table. Cash only. Tips are recorded, not charged. Refunds are recorded in *Disputes*; paying them out is manual.
* **IC verification**: only the last 4 digits are collected; `ic_verified` is set by seed/admin, no eKYC.
* **Masked calls**: edge function returns a configured proxy number after authorising the caller; no telephony session is created yet.
* **SMS delivery** for OTP: configure a provider that supports +60.

## Decisions & assumptions you should confirm
* **Scrap economics**: customer receives the payout; platform fee = category `commission_pct` of the payout, charged to the provider (statement shows it negative). 
* **Category booking types at launch**: Aircond = scheduled, Cleaning = scheduled, Scrap = instant. No enabled category uses *quote*, so that flow is exercised by tests (painting enabled temporarily) and becomes visible when an admin enables painting/movers/handyman/etc.
* **"Queue at a shop"** is a separate Home entry driven by `shops.open`, not by the category switch, so the three-category launch restriction doesn't hide it. Medical services are not offered; clinic queues are ticketing only.
* **Provider location when idle**: one fix at "go online" and on app resume (not continuous). A provider who stays online with the app closed keeps the position from their last foreground use and is dropped after 3 h (instant matching) / 8 h (set offline). This trades some matching accuracy for the "no background location" rule.
* **Deferred loading** is Dart-level (keeps maps/signup/counter out of startup). It does not shrink the base APK; true on-demand delivery would need Play Feature Delivery.
* `search_round`-based dispatch caps provider radius at 30 km.
* Kiosk revoke has RLS support but no button in the app yet.
* Region enable/disable is by `regions` circles (centre + radius), a simplification of true district polygons.
* Delete-account keeps anonymised job rows for accounting; add a retention purge that matches your policy.
