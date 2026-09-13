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
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
mkdir -p "$ART"

read_probe() { adb shell run-as "$PKG" cat files/probe-status.txt; }

if ! curl -sf -o /dev/null -X OPTIONS "http://127.0.0.1:19001/art/" 2>/dev/null; then
  echo "starting S3 mock on :19001..."
  (cd "$ROOT" && S3_MOCK_PORT=19001 node --experimental-strip-types packages/s3/src/mock-cli.ts >"$ART/f023_s3_mock.log" 2>&1) &
  for _ in $(seq 1 30); do
    if curl -sf -o /dev/null -X OPTIONS "http://127.0.0.1:19001/art/" 2>/dev/null; then
      break
    fi
    sleep 0.2
  done
fi
curl -sf -o /dev/null -X OPTIONS "http://127.0.0.1:19001/art/"

echo "seeding Keystore (no log of secret values)..."
adb reverse tcp:19001 tcp:19001 >/dev/null
adb shell am force-stop "$PKG" >/dev/null
adb shell am start -W -n "$ACT" --es op set --es key accessKeyId --es value AKIATEST >/dev/null
adb shell am start -W -n "$ACT" --es op set --es key secretAccessKey --es value super-secret-oss >/dev/null
adb shell am start -W -n "$ACT" --es op assert-no-plaintext --es needle super-secret-oss >/dev/null
plain=$(read_probe)
[[ "$plain" == "no-plaintext" ]]

echo "writing public pad-e2e.json..."
printf '%s' '{"endpoint":"http://127.0.0.1:19001","bucket":"art","forcePathStyle":true,"libraryName":"Pad库"}' | adb shell run-as "$PKG" tee /data/user/0/app.artstock.desktop/files/pad-e2e.json >/dev/null
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
for _ in $(seq 1 45); do
  status=$(adb shell run-as "$PKG" cat files/pad-e2e-status.json 2>/dev/null || true)
  if [[ "$status" == *'"ok": true'* || "$status" == *'"ok":true'* ]]; then
    break
  fi
  if [[ "$status" == *'"ok": false'* || "$status" == *'"ok":false'* ]]; then
    break
  fi
  sleep 2
done

printf '%s\n' "$status" > "$ART/f023_pad_e2e_status.json"
[[ "$status" == *secretAccessKey* ]] && { echo "secret leaked in status"; exit 1; }
[[ "$status" == *'"ok": true'* || "$status" == *'"ok":true'* ]] || { echo "e2e status not ok: $status"; exit 1; }
[[ "$status" == *Pad库* ]] || { echo "library missing: $status"; exit 1; }
[[ "$status" == *lockSeenDuringPut* ]] || { echo "lock evidence missing"; exit 1; }

adb exec-out screencap -p > "$ART/f023_pad_landscape.png"

adb shell wm user-rotation lock 0 >/dev/null || adb shell settings put system user_rotation 0 >/dev/null
sleep 2
adb exec-out screencap -p > "$ART/f023_pad_portrait.png"

echo "F-023 ok: Keystore + browse library + locked upload (landscape/portrait screenshots)"
