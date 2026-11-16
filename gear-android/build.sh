#!/usr/bin/env bash
# 构建器材库 APK：把 ../gear 网页应用打包进一个 WebView 外壳。
# 需要 JDK、python3，以及 TOOLS 目录里的四个 jar（都来自 Maven Central）：
#   apktool-lib.jar  org.apktool:apktool-lib:3.0.3                         （内含 aapt2）
#   dx.jar           com.jakewharton.android.repackaged:dalvik-dx:16.0.1
#   android-all.jar  org.robolectric:android-all:15-robolectric-14663667   （Android 框架）
#   apksig.jar       com.android.tools.build:apksig:2.3.0
set -euo pipefail
cd "$(dirname "$0")"
TOOLS=${TOOLS:?请设置 TOOLS 为存放上述 jar 的目录}
VERSION_CODE=${VERSION_CODE:-1}; VERSION_NAME=${VERSION_NAME:-1.0}
B=build; rm -rf $B; mkdir -p $B/assets/gear $B/classes $B/sign
export JAVA_TOOL_OPTIONS=

[ -x "$TOOLS/aapt2" ] || { unzip -oqj "$TOOLS/apktool-lib.jar" prebuilt/linux/aapt2 -d "$TOOLS"; chmod +x "$TOOLS/aapt2"; }
cp -r ../gear/. $B/assets/gear/

"$TOOLS/aapt2" compile --dir res -o $B/res.zip
"$TOOLS/aapt2" link -o $B/base.apk -I "$TOOLS/android-all.jar" --manifest AndroidManifest.xml -A $B/assets \
  --min-sdk-version 29 --target-sdk-version 34 --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" $B/res.zip

javac -nowarn -source 8 -target 8 -cp "$TOOLS/android-all.jar" -d $B/classes src/app/gearkit/*.java
java -cp "$TOOLS/dx.jar" com.android.dx.command.Main --dex --min-sdk-version=26 --output=$B/classes.dex $B/classes
(cd $B && zip -qj base.apk classes.dex)

python3 tools/zipalign.py $B/base.apk $B/aligned.apk
javac -cp "$TOOLS/apksig.jar" -d $B/sign tools/Sign.java
java --add-exports java.base/sun.security.x509=ALL-UNNAMED --add-exports java.base/sun.security.pkcs=ALL-UNNAMED -cp "$TOOLS/apksig.jar:$B/sign" Sign gearkit.keystore gearkit gearkit $B/aligned.apk "gearkit-$VERSION_NAME.apk"
ls -l "gearkit-$VERSION_NAME.apk"
