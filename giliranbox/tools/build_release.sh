#!/bin/sh
# Release build with every size/perf flag, then a hard size gate (each per-ABI APK must be < 15 MB).
# Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... [CDN_BASE=...] [MAPS_API_KEY=...] tools/build_release.sh
set -e
cd "$(dirname "$0")/../app"
: "${SUPABASE_URL:?set SUPABASE_URL}" "${SUPABASE_ANON_KEY:?set SUPABASE_ANON_KEY}"
DEFS="--dart-define=SUPABASE_URL=$SUPABASE_URL --dart-define=SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY --dart-define=CDN_BASE=${CDN_BASE:-} ${PERF_LOG:+--dart-define=PERF_LOG=true}"
FLAGS="--release --obfuscate --split-debug-info=build/symbols --tree-shake-icons"
flutter build appbundle $FLAGS $DEFS            # Play Store: per-ABI / density splits are applied by Play
flutter build apk $FLAGS --split-per-abi $DEFS  # sideload / measurement: one APK per ABI
echo "== APK sizes =="
fail=0
for f in build/app/outputs/flutter-apk/app-*-release.apk; do
  bytes=$(wc -c < "$f"); mb=$(echo "scale=2; $bytes/1048576" | bc)
  echo "$(basename "$f"): ${mb} MB"
  [ "$bytes" -lt 15728640 ] || { echo "  ^ OVER the 15 MB budget"; fail=1; }
done
echo "AAB: $(du -h build/app/outputs/bundle/release/app-release.aab | cut -f1)  (device download size: bundletool get-size total --apks=...)"
exit $fail
