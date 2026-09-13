#!/usr/bin/env bash
# F-023: Pad APK configures OSS (Keystore), lists libraries, locked upload.
# Does not print secret material. Requires: Pixel Tablet emulator + debug APK.
set -euo pipefail
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
PKG=app.artstock.desktop
ACT="$PKG/.SecretProbeActivity"
MAIN="$PKG/.MainActivity"
ART="${ART_STOCK_ARTIFACTS:-/opt/cursor/artifacts}"
mkdir -p "$ART"

read_probe() { adb shell run-as "$PKG" cat files/probe-status.txt; }

echo "seeding Keystore (no log of secret values)..."
adb reverse tcp:19001 tcp:19001 >/dev/null
adb shell am force-stop "$PKG" >/dev/null
adb shell am start -W -n "$ACT" --es op set --es key accessKeyId --es value AKIATEST >/dev/null
adb shell am start -W -n "$ACT" --es op set --es key secretAccessKey --es value super-secret-oss >/dev/null
adb shell am start -W -n "$ACT" --es op assert-no-plaintext --es needle super-secret-oss >/dev/null
plain=$(read_probe)
[[ "$plain" == "no-plaintext" ]]

echo "writing public pad-e2e.json..."
adb shell run-as "$PKG" /system/bin/sh -c 'cat > files/pad-e2e.json' <<'JSON'
{"endpoint":"http://127.0.0.1:19001","bucket":"art","forcePathStyle":true,"libraryName":"Pad库"}
JSON
cfg=$(adb shell run-as "$PKG" cat files/pad-e2e.json)
[[ "$cfg" != *secretAccessKey* ]]
[[ "$cfg" != *super-secret* ]]

adb shell rm -f /data/local/tmp/pad-e2e-status.json >/dev/null 2>&1 || true
adb shell run-as "$PKG" rm -f files/pad-e2e-status.json >/dev/null 2>&1 || true

echo "launching Pad WebView..."
adb shell settings put system accelerometer_rotation 0 >/dev/null
adb shell wm user-rotation lock 1 >/dev/null || adb shell settings put system user_rotation 1 >/dev/null
adb shell am start -W -n "$MAIN" >/dev/null

status=""
for _ in $(seq 1 40); do
  status=$(adb shell run-as "$PKG" cat files/pad-e2e-status.json 2>/dev/null || true)
  if [[ "$status" == *'"ok": true'* || "$status" == *'"ok":true'* ]]; then
    break
  fi
  sleep 2
done

echo "$status" > "$ART/f023_pad_e2e_status.json"
[[ "$status" == *secretAccessKey* ]] && { echo "secret leaked in status"; exit 1; }
[[ "$status" == *'"ok": true'* || "$status" == *'"ok":true'* ]] || { echo "e2e status not ok: $status"; exit 1; }
[[ "$status" == *Pad库* ]] || { echo "library missing: $status"; exit 1; }
[[ "$status" == *lockSeenDuringPut* ]] || { echo "lock evidence missing"; exit 1; }

adb exec-out screencap -p > "$ART/f023_pad_landscape.png"

adb shell wm user-rotation lock 0 >/dev/null || adb shell settings put system user_rotation 0 >/dev/null
sleep 2
adb exec-out screencap -p > "$ART/f023_pad_portrait.png"

echo "F-023 ok: Keystore + browse library + locked upload (landscape/portrait screenshots)"
