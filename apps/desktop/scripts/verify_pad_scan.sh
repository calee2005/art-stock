#!/usr/bin/env bash
# F-045: Pad inbox scan imports new files and snapshots size changes under the lock.
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
  (cd "$ROOT" && S3_MOCK_PORT=19001 node --experimental-strip-types packages/s3/src/mock-cli.ts >"$ART/f045_s3_mock.log" 2>&1) &
  for _ in $(seq 1 30); do
    curl -sf -o /dev/null -X OPTIONS "http://127.0.0.1:19001/art/" 2>/dev/null && break
    sleep 0.2
  done
fi

adb reverse tcp:19001 tcp:19001 >/dev/null
adb shell am force-stop "$PKG" >/dev/null
adb shell am start -W -n "$ACT" --es op set --es key accessKeyId --es value AKIATEST >/dev/null
adb shell am start -W -n "$ACT" --es op set --es key secretAccessKey --es value super-secret-oss >/dev/null

python3 - <<'PY'
from pathlib import Path
png = bytes([
    0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,
    0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,0x08,0x02,0x00,0x00,0x00,0x90,0x77,0x53,
    0xDE,0x00,0x00,0x00,0x0C,0x49,0x44,0x41,0x54,0x08,0xD7,0x63,0xF8,0xCF,0xC0,0x00,
    0x00,0x00,0x03,0x00,0x01,0x00,0x05,0xFE,0xD4,0xEF,0x00,0x00,0x00,0x00,0x49,0x45,
    0x4E,0x44,0xAE,0x42,0x60,0x82,
])
Path("/tmp/scan-v1.png").write_bytes(png)
print("v1", len(png))
PY
adb push /tmp/scan-v1.png /sdcard/Download/scan-v1.png >/dev/null
adb shell run-as "$PKG" mkdir -p files/inbox >/dev/null
adb shell "cat /sdcard/Download/scan-v1.png | run-as $PKG tee files/inbox/scan-work.png" >/dev/null

printf '%s' '{"endpoint":"http://127.0.0.1:19001","bucket":"art","forcePathStyle":true,"libraryName":"Pad扫描"}' | adb shell run-as "$PKG" tee files/pad-e2e.json >/dev/null
printf '%s' '{"libraryName":"Pad扫描","snapshotPolicy":{"mode":"auto-on-save","minIntervalMs":0}}' | adb shell run-as "$PKG" tee files/pad-scan-e2e.json >/dev/null
cfg=$(adb shell run-as "$PKG" cat files/pad-scan-e2e.json)
[[ "$cfg" != *secretAccessKey* ]]
adb shell run-as "$PKG" rm -f files/pad-scan-e2e-status.json >/dev/null 2>&1 || true

adb shell am start -W -n "$MAIN" >/dev/null
status=""
for _ in $(seq 1 45); do
  status=$(adb shell run-as "$PKG" cat files/pad-scan-e2e-status.json 2>/dev/null || true)
  if [[ "$status" == *'"ok": true'* || "$status" == *'"ok":true'* || "$status" == *'"ok": false'* || "$status" == *'"ok":false'* ]]; then
    break
  fi
  sleep 2
done
printf '%s\n' "$status" > "$ART/f045_pad_scan_e2e_status_pass1.json"
[[ "$status" == *secretAccessKey* ]] && { echo "secret leaked"; exit 1; }
[[ "$status" == *'"ok": true'* || "$status" == *'"ok":true'* ]] || { echo "scan pass1 not ok: $status"; exit 1; }
[[ "$status" == *imported* ]] || { echo "imported missing: $status"; exit 1; }

python3 - <<'PY'
from pathlib import Path
png = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000020000000108020000009b9a0c170000000c4944415408d763f8cfc0c00000000300010018dd8d170000000049454e44ae426082"
)
Path("/tmp/scan-v2.png").write_bytes(png)
print("v2", len(png))
PY
adb push /tmp/scan-v2.png /sdcard/Download/scan-v2.png >/dev/null
adb shell "cat /sdcard/Download/scan-v2.png | run-as $PKG tee files/inbox/scan-work.png" >/dev/null
adb shell am force-stop "$PKG" >/dev/null
adb shell run-as "$PKG" rm -f files/pad-e2e.json files/pad-e2e-status.json files/pad-scan-e2e-status.json >/dev/null 2>&1 || true
adb shell am start -W -n "$MAIN" >/dev/null
status2=""
for _ in $(seq 1 45); do
  status2=$(adb shell run-as "$PKG" cat files/pad-scan-e2e-status.json 2>/dev/null || true)
  if [[ "$status2" == *'"ok": true'* || "$status2" == *'"ok":true'* || "$status2" == *'"ok": false'* || "$status2" == *'"ok":false'* ]]; then
    break
  fi
  sleep 2
done
printf '%s\n' "$status2" > "$ART/f045_pad_scan_e2e_status.json"
[[ "$status2" == *secretAccessKey* ]] && { echo "secret leaked"; exit 1; }
[[ "$status2" == *'"ok": true'* || "$status2" == *'"ok":true'* ]] || { echo "scan pass2 not ok: $status2"; exit 1; }
[[ "$status2" == *snapshotted* ]] || { echo "snapshotted missing: $status2"; exit 1; }
python3 - <<'PY'
import json, pathlib
raw = pathlib.Path("/opt/cursor/artifacts/f045_pad_scan_e2e_status.json").read_text()
data = json.loads(raw)
assert data.get("ok") is True, data
assert int(data.get("snapshotted") or 0) >= 1, data
print("scan e2e ok", data)
PY

adb exec-out screencap -p > "$ART/f045_pad_inbox_scan.png"
echo "F-045 ok: inbox scan imported then snapshotted under lock"
