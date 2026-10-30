#!/bin/bash
# Builds EquipRite for Android (android/), signed, into desktop/phone-app/EquipRite.apk, where the desktop app serves
# it to a phone on the Wi-Fi. Plain framework code (no Gradle, no libraries), so it builds with Ubuntu's packages:
#   sudo apt-get install android-sdk-platform-23 aapt dalvik-exchange zipalign apksigner openjdk-21-jdk-headless
# Signing: the key in $EQP_ANDROID_KEYSTORE (a PKCS#12 file; password in $EQP_ANDROID_KEYPASS), else one made once in
# ~/.equiprite/android-signing.p12. Keep it: an update installs over the app only when signed with the same key.
# The key never goes in the project.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
SDK="${ANDROID_PLATFORM_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"
OUT="${EQP_APK_OUT:-$ROOT/desktop/phone-app/EquipRite.apk}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
KEY="${EQP_ANDROID_KEYSTORE:-$HOME/.equiprite/android-signing.p12}"
PASS="${EQP_ANDROID_KEYPASS:-equiprite-android}"

for t in aapt javac dalvik-exchange zipalign apksigner keytool; do
  command -v "$t" >/dev/null || { echo "Missing $t: see the top of $0"; exit 1; }
done
[ -f "$SDK" ] || { echo "Missing $SDK: sudo apt-get install android-sdk-platform-23"; exit 1; }

if [ ! -f "$KEY" ]; then
  mkdir -p "$(dirname "$KEY")"
  keytool -genkeypair -keystore "$KEY" -storetype PKCS12 -storepass "$PASS" -alias equiprite -keyalg RSA -keysize 3072 \
    -validity 10000 -dname "CN=EquipRite, O=EquipRite" >/dev/null
  echo "Made a signing key: $KEY (keep it for updates)"
fi

mkdir -p "$WORK/gen" "$WORK/classes" "$(dirname "$OUT")"
aapt package -f -m -J "$WORK/gen" -M "$HERE/AndroidManifest.xml" -S "$HERE/res" -I "$SDK" -F "$WORK/app.unsigned.apk"
javac --release 8 -nowarn -Xlint:-options -encoding UTF-8 -classpath "$SDK" -d "$WORK/classes" \
  $(find "$HERE/src" "$WORK/gen" -name '*.java')
dalvik-exchange --dex --min-sdk-version=24 --output="$WORK/classes.dex" "$WORK/classes"
(cd "$WORK" && zip -q -j app.unsigned.apk classes.dex)
zipalign -f -p 4 "$WORK/app.unsigned.apk" "$WORK/app.aligned.apk"
apksigner sign --v4-signing-enabled false --ks "$KEY" --ks-pass "pass:$PASS" --ks-key-alias equiprite --out "$OUT" "$WORK/app.aligned.apk"
apksigner verify "$OUT"
echo "Built $OUT ($(wc -c < "$OUT") bytes)"
