#!/usr/bin/env bash
# 不依赖 Android Studio 的最小 APK 构建。
# 需要：JDK 17+、python3、pip、curl。工具会下载到 $SDK（默认 android/.sdk）。
# 签名密钥：$KEYSTORE（默认 android/nuanliu.p12，不存在时自动生成）。
#   同一个密钥签出来的 APK 才能覆盖安装、保留数据，请务必保管好这个文件。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
SDK="${SDK:-$HERE/.sdk}"
KEYSTORE="${KEYSTORE:-$HERE/nuanliu.p12}"
KEYPASS="${KEYPASS:-nuanliu}"
OUT="${OUT:-$HERE/build}"
CENTRAL=https://repo.maven.apache.org/maven2

mkdir -p "$SDK" "$OUT"
fetch() { [ -s "$2" ] || curl -fsSL -o "$2" "$1"; }

# ---- 工具 ----
fetch "$CENTRAL/org/robolectric/android-all/14-robolectric-10818077/android-all-14-robolectric-10818077.jar" "$SDK/android-all.jar"
fetch "$CENTRAL/com/jakewharton/android/repackaged/dalvik-dx/14.0.0_r21/dalvik-dx-14.0.0_r21.jar" "$SDK/dx.jar"
fetch "$CENTRAL/com/android/tools/build/apksig/2.3.0/apksig-2.3.0.jar" "$SDK/apksig.jar"
if [ ! -x "$SDK/aapt2" ]; then
  pip download aapt2==0.2.1 --no-deps -q -d "$SDK/pip"
  python3 -c "import zipfile,sys,glob; z=zipfile.ZipFile(glob.glob(sys.argv[1]+'/pip/aapt2-*.whl')[0]); open(sys.argv[1]+'/aapt2','wb').write(z.read('aapt2/bin/Linux/aapt2'))" "$SDK"
  chmod +x "$SDK/aapt2"
fi

WORK="$OUT/work"
mkdir -p "$WORK"
STAGE="$WORK/$(date +%s)"
mkdir -p "$STAGE/assets/www" "$STAGE/res/mipmap-xxxhdpi" "$STAGE/res/drawable-xxhdpi" "$STAGE/gen" "$STAGE/classes" "$STAGE/dex"

# ---- 界面文件与图标 ----
cp -r "$ROOT/index.html" "$ROOT/manifest.webmanifest" "$ROOT/css" "$ROOT/js" "$ROOT/icons" "$STAGE/assets/www/"
cp "$ROOT/icons/icon-192.png" "$STAGE/res/mipmap-xxxhdpi/ic_launcher.png"
cp "$ROOT/icons/badge.png" "$STAGE/res/drawable-xxhdpi/ic_stat.png"

# ---- 资源 + 清单 ----
"$SDK/aapt2" compile --dir "$STAGE/res" -o "$STAGE/res.zip"
"$SDK/aapt2" link -I "$SDK/android-all.jar" --manifest "$HERE/AndroidManifest.xml" \
  -A "$STAGE/assets" --java "$STAGE/gen" -o "$STAGE/base.apk" "$STAGE/res.zip"

# ---- Java -> dex ----
javac -nowarn --release 8 -cp "$SDK/android-all.jar" -d "$STAGE/classes" \
  $(find "$HERE/src" "$STAGE/gen" -name '*.java')
java -cp "$SDK/dx.jar" com.android.dx.command.Main --dex --min-sdk-version=26 \
  --output="$STAGE/dex/classes.dex" "$STAGE/classes"
python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1],'a',zipfile.ZIP_DEFLATED).write(sys.argv[2],'classes.dex')" \
  "$STAGE/base.apk" "$STAGE/dex/classes.dex"

# ---- 对齐 + 签名 ----
python3 "$HERE/tools/zipalign.py" "$STAGE/base.apk" "$STAGE/aligned.apk"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -keystore "$KEYSTORE" -storetype PKCS12 -storepass "$KEYPASS" -alias nuanliu \
    -keyalg RSA -keysize 2048 -validity 36500 -dname "CN=Nuanliu"
fi
javac -nowarn -cp "$SDK/apksig.jar" -d "$STAGE/sign" "$HERE/tools/Sign.java"
java --add-exports java.base/sun.security.x509=ALL-UNNAMED --add-exports java.base/sun.security.pkcs=ALL-UNNAMED \
  -cp "$SDK/apksig.jar:$STAGE/sign" Sign "$KEYSTORE" "$KEYPASS" nuanliu "$STAGE/aligned.apk" "$OUT/nuanliu.apk"
echo "OK -> $OUT/nuanliu.apk"
