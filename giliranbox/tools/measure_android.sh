#!/bin/sh
# Measures startup, jank and memory on a CONNECTED Android device (use a real low-end phone: 2 GB RAM, Android 9).
# Build the app with PERF_LOG=true so it prints GB_PERF markers, install the release APK, sign in once, then run:
#   tools/measure_android.sh [runs=10] > docs/PERFORMANCE_RESULTS.md
# Needs: adb. Prints a markdown report. Nothing is estimated: every number comes from the device.
set -e
PKG=my.giliranbox.giliranbox
RUNS=${1:-10}
ADB="adb"
$ADB get-state >/dev/null || { echo "no device"; exit 1; }
MODEL=$($ADB shell getprop ro.product.model | tr -d '\r'); AND=$($ADB shell getprop ro.build.version.release | tr -d '\r')
RAM_KB=$($ADB shell "grep MemTotal /proc/meminfo" | awk '{print $2}')
median() { sort -n | awk '{a[NR]=$1} END{print (NR%2)?a[(NR+1)/2]:(a[NR/2]+a[NR/2+1])/2}'; }

echo "# GiliranBox on-device results"
echo
echo "- Device: $MODEL, Android $AND, RAM $((RAM_KB/1024)) MB"
echo "- App: $($ADB shell dumpsys package $PKG | grep versionName | head -1 | tr -d '\r ')"
echo "- APK installed size: $($ADB shell pm path $PKG | head -1 | sed 's/package://' | tr -d '\r' | xargs -I{} $ADB shell stat -c %s {} | awk '{printf "%.2f MB", $1/1048576}')"
echo

# --- cold start: process killed, then launched; first_frame and home_ready come from GB_PERF logcat markers
FIRST=""; HOME=""; TOTAL=""
for i in $(seq 1 "$RUNS"); do
  $ADB shell am force-stop $PKG; sleep 2; $ADB logcat -c
  T0=$($ADB shell date +%s%3N | tr -d '\r')
  OUT=$($ADB shell am start -W -n $PKG/.MainActivity | tr -d '\r')
  TOTAL="$TOTAL $(echo "$OUT" | awk '/TotalTime/{print $2}')"
  sleep 4
  LOG=$($ADB logcat -d -s flutter | tr -d '\r')
  F=$(echo "$LOG" | sed -n 's/.*GB_PERF first_frame epoch=\([0-9]*\).*/\1/p' | head -1)
  H=$(echo "$LOG" | sed -n 's/.*GB_PERF home_ready epoch=\([0-9]*\).*/\1/p' | head -1)
  [ -n "$F" ] && FIRST="$FIRST $((F-T0))"
  [ -n "$H" ] && HOME="$HOME $((H-T0))"
done
echo "## Cold start ($RUNS runs, median) — target: usable home < 2000 ms"
echo
echo "| Metric | Median ms | Runs |"; echo "|---|---|---|"
echo "| am start TotalTime (activity displayed) | $(echo $TOTAL | tr ' ' '\n' | median) | $(echo $TOTAL) |"
echo "| first Flutter frame | $(echo $FIRST | tr ' ' '\n' | median) | $(echo $FIRST) |"
echo "| usable home (categories painted) | $(echo $HOME | tr ' ' '\n' | median) | $(echo $HOME) |"
echo

# --- scroll smoothness: reset frame stats, scroll the home grid + activity list, read janky-frame stats
$ADB shell am start -n $PKG/.MainActivity >/dev/null; sleep 3
$ADB shell dumpsys gfxinfo $PKG reset >/dev/null
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do $ADB shell input swipe 540 1500 540 500 250; $ADB shell input swipe 540 500 540 1500 250; done
GFX=$($ADB shell dumpsys gfxinfo $PKG | tr -d '\r')
echo "## Scrolling (24 swipes) — target: 60 fps, p90 frame time <= 16.6 ms"
echo
echo '```'; echo "$GFX" | grep -E "Total frames rendered|Janky frames|50th|90th|95th|99th"; echo '```'
echo

# --- memory
echo "## Memory — target: < 150 MB"
echo
echo '```'; $ADB shell dumpsys meminfo $PKG | tr -d '\r' | grep -E "TOTAL PSS|TOTAL RSS|Java Heap|Native Heap|Graphics" | head -6; echo '```'
