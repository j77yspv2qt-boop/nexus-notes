#!/usr/bin/env bash
# 建置 NEXUS 筆記 App 的 Android APK（純命令列：aapt2 → javac → d8 → zipalign → apksigner）
set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export PATH="$JAVA_HOME/bin:$PATH"

BT="$ANDROID_HOME/build-tools/35.0.0"
PLATFORM="$ANDROID_HOME/platforms/android-35/android.jar"
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
rm -rf build; mkdir -p build/gen build/classes build/dex

echo "== 1/7 編譯資源 (aapt2 compile) =="
"$BT/aapt2" compile --dir res -o build/res.zip

echo "== 2/7 連結資源+資產 (aapt2 link) =="
"$BT/aapt2" link -o build/base.apk \
  -I "$PLATFORM" \
  --manifest AndroidManifest.xml \
  -R build/res.zip \
  -A assets \
  --java build/gen \
  --min-sdk-version 24 --target-sdk-version 35 \
  --version-code 1 --version-name 1.0 \
  --auto-add-overlay

echo "== 3/7 編譯 Java (javac) =="
javac -source 8 -target 8 -nowarn \
  -bootclasspath "$PLATFORM" -cp "$PLATFORM" \
  -d build/classes \
  java/com/nexus/notes/MainActivity.java \
  build/gen/com/nexus/notes/R.java

echo "== 4/7 轉成 dex (d8) =="
"$BT/d8" --release --lib "$PLATFORM" --min-api 24 \
  --output build/dex $(find build/classes -name '*.class' | tr '\n' ' ')

echo "== 5/7 打包 dex 進 APK =="
cp build/base.apk build/unsigned.apk
(cd build/dex && zip -q -j "$HERE/build/unsigned.apk" classes.dex)

echo "== 6/7 對齊 (zipalign) =="
"$BT/zipalign" -f 4 build/unsigned.apk build/aligned.apk

echo "== 7/7 簽署 (apksigner) =="
if [ ! -f build/debug.keystore ]; then
  keytool -genkeypair -keystore build/debug.keystore -alias nexusdebug \
    -storepass nexusapp -keypass nexusapp -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=NEXUS,O=NEXUS,C=TW"
fi
"$BT/apksigner" sign --ks build/debug.keystore --ks-pass pass:nexusapp --key-pass pass:nexusapp \
  --min-sdk-version 24 --out nexus-notes.apk build/aligned.apk

echo "== 驗證 =="
"$BT/apksigner" verify --print-certs nexus-notes.apk | head -6
"$BT/aapt" dump badging nexus-notes.apk | grep -E "package|application-label|launchable-activity|sdkVersion|targetSdkVersion"
echo "OK → $(pwd)/nexus-notes.apk ($(du -h nexus-notes.apk | cut -f1))"