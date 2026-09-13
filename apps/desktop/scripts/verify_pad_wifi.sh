#!/usr/bin/env bash
# F-046: Pad wifi-only originals — cellular fetch blocked, metadata still listed.
set -euo pipefail
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
PKG=app.artstock.desktop
ACT="$PKG/.SecretProbeActivity"
MAIN="$PKG/.MainActivity"
ART="${ART_STOCK_ARTIFACTS:-/opt/cursor/artifacts}"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
mkdir -p "$ART"

if ! curl -sf -o /dev/null -X OPTIONS "http://127.0.0.1:19001/art/" 2>/dev/null; then
  (cd "$ROOT" && S3_MOCK_PORT=19001 node --experimental-strip-types packages/s3/src/mock-cli.ts >"$ART/f046_s3_mock.log" 2>&1) &
  for _ in $(seq 1 30); do
    curl -sf -o /dev/null -X OPTIONS "http://127.0.0.1:19001/art/" 2>/dev/null && break
    sleep 0.2
  done
fi

adb reverse tcp:19001 tcp:19001 >/dev/null
adb shell am force-stop "$PKG" >/dev/null
adb shell am start -W -n "$ACT" --es op set --es key accessKeyId --es value AKIATEST >/dev/null
adb shell am start -W -n "$ACT" --es op set --es key secretAccessKey --es value super-secret-oss >/dev/null
printf '%s' '{"endpoint":"http://127.0.0.1:19001","bucket":"art","forcePathStyle":true,"libraryName":"Pad库"}' | adb shell run-as "$PKG" tee /data/user/0/app.artstock.desktop/files/pad-e2e.json >/dev/null
printf '%s' '{"network":"cellular"}' | adb shell run-as "$PKG" tee /data/user/0/app.artstock.desktop/files/pad-wifi-e2e.json >/dev/null
cfg=$(adb shell run-as "$PKG" cat files/pad-wifi-e2e.json)
[[ "$cfg" != *secretAccessKey* ]]
adb shell run-as "$PKG" rm -f files/pad-wifi-e2e-status.json >/dev/null 2>&1 || true

adb shell am start -W -n "$MAIN" >/dev/null
status=""
for _ in $(seq 1 45); do
  status=$(adb shell run-as "$PKG" cat files/pad-wifi-e2e-status.json 2>/dev/null || true)
  if [[ "$status" == *'"ok": true'* || "$status" == *'"ok":true'* || "$status" == *'"ok": false'* || "$status" == *'"ok":false'* ]]; then
    break
  fi
  sleep 2
done
printf '%s\n' "$status" > "$ART/f046_pad_wifi_e2e_status.json"
[[ "$status" == *secretAccessKey* ]] && { echo "secret leaked"; exit 1; }
[[ "$status" == *'"ok": true'* || "$status" == *'"ok":true'* ]] || { echo "wifi e2e not ok: $status"; exit 1; }
[[ "$status" == *cellular* ]] || { echo "cellular network missing"; exit 1; }
[[ "$status" == *metadataCount* ]] || { echo "metadata evidence missing"; exit 1; }

adb exec-out screencap -p > "$ART/f046_pad_wifi_only.png"
echo "F-046 ok: cellular original download blocked; metadata still listed"
