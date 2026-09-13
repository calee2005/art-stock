#!/usr/bin/env bash
# F-092: SAF grant copies into inbox; revoke stops scan; reclaim leaves pinned.
set -euo pipefail
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
PKG=app.artstock.desktop
MAIN="$PKG/.MainActivity"
ART="${ART_STOCK_ARTIFACTS:-/opt/cursor/artifacts}"
mkdir -p "$ART"

adb shell am force-stop "$PKG" >/dev/null
adb shell run-as "$PKG" mkdir -p files/pinned files/inbox >/dev/null
printf 'keep' | adb shell run-as "$PKG" tee files/pinned/keep.bin >/dev/null
printf '%s' '{"run":true}' | adb shell run-as "$PKG" tee files/pad-saf-e2e.json >/dev/null
cfg=$(adb shell run-as "$PKG" cat files/pad-saf-e2e.json)
[[ "$cfg" != *secretAccessKey* ]]
adb shell run-as "$PKG" rm -f files/pad-saf-e2e-status.json >/dev/null 2>&1 || true

adb shell am start -W -n "$MAIN" >/dev/null
status=""
for _ in $(seq 1 45); do
  status=$(adb shell run-as "$PKG" cat files/pad-saf-e2e-status.json 2>/dev/null || true)
  if [[ "$status" == *'"ok": true'* || "$status" == *'"ok":true'* || "$status" == *'"ok": false'* || "$status" == *'"ok":false'* ]]; then
    break
  fi
  sleep 2
done
printf '%s\n' "$status" > "$ART/f092_pad_saf_e2e_status.json"
[[ "$status" == *secretAccessKey* ]] && { echo "secret leaked"; exit 1; }
[[ "$status" == *'"ok": true'* || "$status" == *'"ok":true'* ]] || { echo "saf e2e not ok: $status"; exit 1; }
[[ "$status" == *copiedAfterRevoke* ]] || { echo "revoke evidence missing"; exit 1; }
pinned=$(adb shell run-as "$PKG" cat files/pinned/keep.bin)
[[ "$pinned" == keep ]] || { echo "pinned was reclaimed"; exit 1; }

adb exec-out screencap -p > "$ART/f092_pad_saf_status.png"
echo "F-092 ok: SAF copy then revoke stopped scan; pinned survived reclaim"
