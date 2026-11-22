#!/usr/bin/env bash
# Packages ../index.html into an Android APK (a WebView shell). No Gradle needed.
# Requires: JDK, and an Android SDK with platforms;android-34 and build-tools;34.0.0.
#   ANDROID_HOME  path to the SDK
#   KEYSTORE      signing keystore (created on first run if missing). Keep the same
#                 file for every release, or phones will refuse to update the app.
#   KS_PASS       keystore password (default: android)
set -euo pipefail
cd "$(dirname "$0")"

VERSION_CODE=1
VERSION_NAME=1.0
: "${ANDROID_HOME:?set ANDROID_HOME to the Android SDK path}"
KEYSTORE=${KEYSTORE:-$HOME/.climb-checkin.jks}
KS_PASS=${KS_PASS:-android}
BT=$ANDROID_HOME/build-tools/34.0.0
JAR=$ANDROID_HOME/platforms/android-34/android.jar

rm -rf build && mkdir -p build/assets build/gen build/classes build/dex
cp ../index.html build/assets/

"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -o build/unsigned.apk -I "$JAR" --manifest AndroidManifest.xml \
  -A build/assets --java build/gen build/res.zip \
  --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME"

javac -source 8 -target 8 -Xlint:-options -classpath "$JAR" -d build/classes \
  $(find src build/gen -name '*.java')
"$BT/d8" --lib "$JAR" --min-api 24 --output build/dex $(find build/classes -name '*.class')
(cd build/dex && zip -q -j ../unsigned.apk classes.dex)

"$BT/zipalign" -f 4 build/unsigned.apk build/aligned.apk
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias climb -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Climb Checkin"
fi
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" \
  --out "build/climb-checkin-$VERSION_NAME.apk" build/aligned.apk
"$BT/apksigner" verify "build/climb-checkin-$VERSION_NAME.apk"
echo "Built build/climb-checkin-$VERSION_NAME.apk"
