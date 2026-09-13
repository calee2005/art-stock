#!/usr/bin/env bash
# F-021: store OSS keys in Android Keystore, force-stop, reread, probe mock S3.
# Does not print secret material. Requires: emulator + debug APK installed, mock on :19000.
set -euo pipefail
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
PKG=app.artstock.desktop
ACT="$PKG/.SecretProbeActivity"
read_status() { adb shell run-as "$PKG" cat files/probe-status.txt; }
adb reverse tcp:19000 tcp:19000 >/dev/null
adb shell am force-stop "$PKG"
adb shell am start -W -n "$ACT" --es op set --es key accessKeyId --es value AKIATEST >/dev/null
adb shell am start -W -n "$ACT" --es op set --es key secretAccessKey --es value super-secret-oss >/dev/null
adb shell am start -W -n "$ACT" --es op assert-no-plaintext --es needle super-secret-oss >/dev/null
plain=$(read_status)
[[ "$plain" == "no-plaintext" ]]
adb shell am force-stop "$PKG"
sleep 1
adb shell am start -W -n "$ACT" --es op get-hash --es key secretAccessKey >/dev/null
hash=$(read_status)
[[ "$hash" == "get-hash 5824557d81a6ecd30d2898835fe02eedd71dd69dbd800e424a55a81175585cc8" ]]
adb shell am start -W -n "$ACT" --es op probe-oss --es endpoint http://127.0.0.1:19000 --es bucket art >/dev/null
oss=$(read_status)
[[ "$oss" == "oss-ok" ]]
echo "F-021 ok: ciphertext prefs, survive force-stop, OSS probe"
