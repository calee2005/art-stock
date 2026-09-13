#!/usr/bin/env bash
# F-033: shared image lands in Pad inbox then archives to the asset library (locked).
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
  (cd "$ROOT" && S3_MOCK_PORT=19001 node --experimental-strip-types packages/s3/src/mock-cli.ts >"$ART/f033_s3_mock.log" 2>&1) &
  for _ in $(seq 1 30); do
    curl -sf -o /dev/null -X OPTIONS "http://127.0.0.1:19001/art/" 2>/dev/null && break
    sleep 0.2
  done
fi

python3 - "$ART/f033_from_gallery.png" <<'PY'
from pathlib import Path
import sys
Path(sys.argv[1]).write_bytes(bytes([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00,
    0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
    0x00, 0x00, 0x03, 0x00, 0x01, 0x18, 0xDD, 0x8D, 0xB0, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
]))
PY

adb reverse tcp:19001 tcp:19001 >/dev/null
adb shell am force-stop "$PKG" >/dev/null
adb shell am start -W -n "$ACT" --es op set --es key accessKeyId --es value AKIATEST >/dev/null
adb shell am start -W -n "$ACT" --es op set --es key secretAccessKey --es value super-secret-oss >/dev/null

adb shell run-as "$PKG" mkdir -p /data/user/0/app.artstock.desktop/files/inbox >/dev/null
adb push "$ART/f033_from_gallery.png" /data/local/tmp/from-gallery.png >/dev/null
adb shell "cat /data/local/tmp/from-gallery.png | run-as $PKG sh -c 'cat > /data/user/0/app.artstock.desktop/files/inbox/from-gallery.png'"
printf '%s' '{"importTo":"assets"}' | adb shell run-as "$PKG" tee /data/user/0/app.artstock.desktop/files/pad-share-e2e.json >/dev/null
cfg=$(adb shell run-as "$PKG" cat files/pad-share-e2e.json)
[[ "$cfg" != *secretAccessKey* ]]
adb shell run-as "$PKG" rm -f files/pad-share-e2e-status.json >/dev/null 2>&1 || true

adb shell am start -W -n "$MAIN" >/dev/null
status=""
for _ in $(seq 1 45); do
  status=$(adb shell run-as "$PKG" cat files/pad-share-e2e-status.json 2>/dev/null || true)
  if [[ "$status" == *'"ok": true'* || "$status" == *'"ok":true'* || "$status" == *'"ok": false'* || "$status" == *'"ok":false'* ]]; then
    break
  fi
  sleep 2
done
printf '%s\n' "$status" > "$ART/f033_pad_share_e2e_status.json"
[[ "$status" == *secretAccessKey* ]] && { echo "secret leaked"; exit 1; }
[[ "$status" == *'"ok": true'* || "$status" == *'"ok":true'* ]] || { echo "share e2e not ok: $status"; exit 1; }
[[ "$status" == *from-gallery.png* ]] || { echo "inbox name missing"; exit 1; }
[[ "$status" == *importedTo* ]] || { echo "archive target missing"; exit 1; }

adb exec-out screencap -p > "$ART/f033_pad_share_inbox.png"
echo "F-033 ok: share inbox archived to assets under withRemoteLock"
