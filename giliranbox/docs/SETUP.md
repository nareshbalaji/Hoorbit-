# Setup

## 0. Prerequisites
Flutter ≥ 3.35 (Dart 3.9), Android Studio / Xcode, a Supabase account, a Firebase project, a Google Cloud project (Maps SDK for Android + iOS), Node/Deno only if you deploy Edge Functions with the Supabase CLI.

## 1. Supabase project
1. Create a project in region **Southeast Asia (Singapore) – `ap-southeast-1`** (closest to Malaysia).
2. Database → Extensions: enable `postgis`, `pgcrypto` (the migration does this into the `extensions` schema) and **`pg_cron`** (needed for the 1-minute dispatch/expiry sweep).
3. Apply SQL in order — SQL editor, or `supabase link --project-ref <ref> && supabase db push`:
   `001_schema.sql` → `002_functions.sql` → `003_rls_outbox.sql` → `004_realtime_storage_cron.sql` → `seed.sql`.
   (`004` creates the 3 Storage buckets, publishes the realtime tables, and schedules `sweep_jobs()` when `pg_cron` is present.)
4. Authentication → Providers → **Phone**: connect an SMS provider (Twilio/MessageBird/Vonage) that delivers to `+60`.
   For the demo, `supabase/config.toml` lists test numbers that accept OTP `123456` — in the hosted dashboard add them under *Phone → Test numbers*. Remove in production.
5. Authentication → URL config: site URL `giliranbox://auth`.
6. **Create your first admin** (after you sign in once with your own number):
   `update profiles set role = 'admin' where phone = '+60XXXXXXXXXX';`
7. API → Settings: copy *Project URL* and *anon key*.
8. Storage: set the `public-img` bucket behind a CDN (Supabase Smart CDN is on by default; or point `CDN_BASE` at Cloudflare in front of it). Uploaded images must be WebP ≤ 300 KB (bucket limits enforce it).

### Turning services/regions on
Admin panel → *Categories* (tick `Enabled`, set commission % and "from" price) and *Regions*. Providers must be approved (*Providers* tab) before they can go online.

## 2. Push notifications (Firebase)
1. Firebase console → add Android app `my.giliranbox.giliranbox` and iOS app (same bundle id). Download `google-services.json` → `app/android/app/` and `GoogleService-Info.plist` → `app/ios/Runner/`. (Without them the app still works, minus push.)
2. iOS: upload your APNs key in Firebase → Cloud Messaging; enable *Push Notifications* + *Background Modes* capabilities in Xcode.
3. Deploy the push function and wire the outbox:
   ```bash
   supabase functions deploy push --no-verify-jwt
   supabase secrets set WEBHOOK_SECRET=<random> FCM_SERVICE_ACCOUNT="$(cat service-account.json)"
   ```
   Dashboard → Database → **Webhooks** → create: table `outbox`, event `INSERT`, type *HTTP request* → `POST https://<ref>.functions.supabase.co/push`, header `x-webhook-secret: <same random>`.
   Every booking/queue event inserts an `outbox` row (database triggers in `003`); the function localises it (BM/EN/中文) and sends via FCM HTTP v1.
4. Job-alert sound: pushes are sent `HIGH` priority with the default sound; while the provider tab is open the app also rings via realtime.
   For a custom ringtone add a notification channel with your sound file (Android) / bundled `.caf` (iOS).

## 3. Google Maps
Create an API key restricted to your Android package + iOS bundle. Android: `-PMAPS_API_KEY=<key>` (or env `MAPS_API_KEY`) is injected into the manifest. iOS: add `GMSServices.provideAPIKey("<key>")` in `ios/Runner/AppDelegate.swift`.
The Maps SDK is only ever instantiated on the **address picker** and **live tracking** screens.

## 4. Build the app
```bash
cd app && flutter pub get
export SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon> CDN_BASE=<optional>
MAPS_API_KEY=<key> ../tools/build_release.sh      # AAB + split-per-abi APKs, obfuscated, tree-shaken, 15 MB gate
```
Release signing: create `app/android/key.properties` (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`); without it the build is debug-signed.
iOS: `flutter build ipa --release --obfuscate --split-debug-info=build/symbols --dart-define=...`.
Keep `build/symbols` — you need it to de-obfuscate crash traces.

## 5. Admin panel
Edit `admin/config.js` (URL + anon key) and host the `admin/` folder on any static host (Cloudflare Pages, Netlify, Supabase Storage). Sign in with an admin phone + OTP.

## 6. Masked calls (optional until launch)
Deploy `supabase/functions/mask-call` and set `PROXY_NUMBER_POOL`. It currently returns a configured proxy number after verifying the caller is on the job; a real telephony proxy session (Twilio Proxy etc.) still has to be wired in — see the TODO in the function. Until then the Call button shows "not configured".

## 7. Raspberry Pi kiosk
See [`KIOSK.md`](KIOSK.md).

## Environment variables recap
| Where | Name | Purpose |
|---|---|---|
| app `--dart-define` | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | backend |
| app `--dart-define` | `CDN_BASE`, `PRIVACY_URL`, `PERF_LOG` | image CDN, privacy policy link, startup markers for `measure_android.sh` |
| gradle / env | `MAPS_API_KEY` | Google Maps |
| Edge secrets | `FCM_SERVICE_ACCOUNT`, `WEBHOOK_SECRET`, `PROXY_NUMBER_POOL` | push + masked call |
