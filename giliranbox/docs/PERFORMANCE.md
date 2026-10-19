# Performance

Target device: **2 GB RAM, Android 9, slow 4G**. Budgets from the brief, how each is met in the design, and the evidence so far.

> **The on-device proof (APK size, cold start, frame rate, memory) has NOT been produced yet.**
> The environment this project was written in could not download the Android SDK (`dl.google.com` was blocked), so no APK/AAB was built and no phone was available.
> Everything below marked **MEASURED** was executed; everything marked **DESIGNED** is an engineering decision that still needs the device run described in
> [Producing the proof](#producing-the-proof). Do not call the app finished until the table at the bottom is filled in from `tools/measure_android.sh`.

## Budget → mechanism → status

| Budget | How it is met | Status |
|---|---|---|
| Download < 15 MB (AAB, per-ABI) | `--split-per-abi`, AAB with abi+density splits, R8 minify + `shrinkResources`, `--tree-shake-icons`, `--obfuscate`, no x86, **14 direct dependencies**, no UI kit / animation / analytics / font packages, system fonts, icons only from a const map. `tools/build_release.sh` **fails the build** if any per-ABI APK ≥ 15 MB. | DESIGNED — not built |
| Cold start → usable home < 2 s | Only `shared_preferences` + `Supabase.initialize` before `runApp`; Firebase/push init runs after the first frame; tabs are built lazily; home = **one** RPC (`home_feed`, **1,208 bytes**) rendered from the SQLite cache first; static (non-animated) skeletons; deferred libraries for maps, provider signup, staff counter. Marker `home_ready` logged for measurement. | DESIGNED — not measured |
| Screens open < 300 ms, 60 fps scroll | `ListView.builder`/`SliverGrid.builder` everywhere, 20 rows/page, `cacheWidth` decoded thumbnails, const widgets, Material 3 without custom shaders, fade transition only. Cached first paint means navigation never waits on the network. | DESIGNED — not measured |
| Home < 50 KB | `home_feed` returns categories + promos + book-again only: **1.2 KB** with 3 categories (asserted `< 50000` in the SQL tests). Images are lazy thumbnails fetched separately. | **MEASURED** (payload) |
| Weak signal / offline viewing | SQLite `kv` cache with stale-while-revalidate (`Swr`, `PagedList`): home, activity, account, active ticket, job detail show last known data with an "Offline" banner. Optimistic status buttons/chat/online toggle. | DESIGNED — unit-level only |
| Maps only on 2 screens | `google_maps_flutter` is imported only by `address_picker.dart` and `tracking_map.dart`, both loaded with `deferred as`; elsewhere distance is text (`2.3 km away`). (Verified by grep.) Note: Dart *deferred loading* moves code out of the startup path; it does not shrink the base APK (that needs Play Feature Delivery). | **MEASURED** (import graph) |
| Location every 5–10 s, only during a job | `JobLocationSession` (Android `intervalDuration` 7 s + 6 s client throttle + 4 s server throttle), started on accept, **stopped** when in-progress/done/cancelled; idle providers give a single fix on going online / resume. Server also deletes the tracking row. No background-location permission. | DESIGNED + SQL-verified (throttle, cleanup, access) |
| Images WebP, compressed, CDN | Buckets accept `image/webp` ≤ 300 KB only; client compression ladder (1280px/q78 → 480px/q35) before upload; CDN via `CDN_BASE`. | DESIGNED (bucket limits SQL-defined) |
| Lists paginated at 20, only needed fields | `pageSize = 20`, keyset cursors, explicit `select=` column lists on every screen. | DESIGNED |
| Realtime only on active job / queue screens | Channels opened in `initState`, `removeChannel` in `dispose`; everything else is push. No timers/polling in the app (the kiosk, a mains-powered Pi, polls its own server). | DESIGNED |
| Supabase Singapore, PostGIS + spatial index, indexes on every filtered column | Setup doc pins `ap-southeast-1`; indexes listed in `DATABASE.md`; benchmark below. | **MEASURED** (queries) |
| Memory < 150 MB | Decoded-size thumbnails, lazy tabs, bounded lists, controllers/subscriptions disposed. | DESIGNED — not measured |

## Backend benchmark (MEASURED, `supabase/tests/perf.sh`)
Postgres 16 + PostGIS 3 on a 4-vCPU 2.1 GHz Xeon sandbox (not a Supabase instance — treat as indicative). 20,000 approved providers spread over ~90 × 90 km, 15 % online.

| Test | Result |
|---|---|
| "Nearest 5 online providers within 5 km" | **6.3 ms**, plan = *Bitmap Index Scan on `providers_online_geo_idx`* (partial GiST) → index-only join to `provider_categories` |
| `create_job` (validate + insert + dispatch to ≤ 5 providers), 30 runs | **median 1.2 ms, max 6.6 ms** |
| SQL correctness suite | **91 assertions** pass (`supabase/tests/run.sh`) |

What the benchmark taught us (and was fixed): the first version filtered on each provider's own `radius_km`, which a spatial index cannot use — it fell back to a btree scan + per-row distance. Dispatch now uses **expanding constant rings (5/10/20/30 km)** that the partial GiST index serves, then re-checks the provider's own radius.

## Other things verified
* `flutter analyze`: 0 issues · `flutter test`: 5 tests (formatting, KL timezone, translation completeness BM/EN/中文, skeleton) pass.
* Kiosk: 10 tests incl. one against the real SQL functions.

## Producing the proof
1. Pick a real low-end phone (2 GB RAM, Android 9). Enable USB debugging, `adb devices`.
2. `PERF_LOG=1 MAPS_API_KEY=… SUPABASE_URL=… SUPABASE_ANON_KEY=… tools/build_release.sh` → prints each per-ABI APK size and fails if ≥ 15 MB. Also run `bundletool get-size total` on the AAB for the Play download size.
3. `adb install -r app/build/app/outputs/flutter-apk/app-arm64-v8a-release.apk` (use `armeabi-v7a` on 32-bit phones); open once, sign in with a demo number, return to home. Throttle the network (Android *Developer options*, or `adb shell cmd netpolicy`/a throttling AP) to ~1 Mbps for a "slow 4G" run.
4. `tools/measure_android.sh 10 > docs/PERFORMANCE_RESULTS.md` → cold-start medians (activity displayed / first frame / usable home), jank percentiles over 24 scroll swipes, PSS memory.
5. Also record: bytes transferred for the home screen (`adb shell dumpsys netstats detail` or Charles/mitmproxy), screen-open times for Activity / Job / Queue (screen recording at 60 fps, frame-count to first content), and offline behaviour (airplane mode → Activity and an active ticket still render).
6. Paste the results into the table below and attach `PERFORMANCE_RESULTS.md`.

## Release checklist (fill in from the device run)

| # | Check | Target | Result | Device / build | Pass |
|---|---|---|---|---|---|
| 1 | arm64-v8a APK size | < 15 MB | _TBD_ | | ☐ |
| 2 | armeabi-v7a APK size | < 15 MB | _TBD_ | | ☐ |
| 3 | AAB per-device download size (bundletool) | < 15 MB | _TBD_ | | ☐ |
| 4 | Cold start → usable home (median of 10) | < 2000 ms | _TBD_ | | ☐ |
| 5 | Home data transferred (cold, no cache) | < 50 KB | _TBD_ (payload 1.2 KB + thumbnails) | | ☐ |
| 6 | Screen open time: Activity / Job / Booking / Queue | < 300 ms | _TBD_ | | ☐ |
| 7 | Scroll: janky frames, p90 frame time | ≤ 16.6 ms | _TBD_ | | ☐ |
| 8 | Peak PSS memory over a 10-minute session | < 150 MB | _TBD_ | | ☐ |
| 9 | Offline: Activity, active ticket, job detail render in airplane mode | works | _TBD_ | | ☐ |
| 10 | Location updates every 5–10 s during a job, none after | verified with `adb shell dumpsys location` | _TBD_ | | ☐ |
| 11 | No wakeups/polling when idle (battery historian or `dumpsys batterystats`) | none | _TBD_ | | ☐ |

If a budget fails, the likely levers are, in order: drop `cached_network_image` for a minimal image loader, replace `supabase_flutter` with a thin REST/WebSocket client, move Firebase to a Play Feature Delivery component, and ship `armeabi-v7a`+`arm64-v8a` as separate Play tracks.
