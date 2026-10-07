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
  --version-code 3 --version-name 1.2 \
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
# 金鑰庫必須放在 build/ 之外：上方 `rm -rf build` 會清掉整個 build 目錄，
# 若金鑰也放這裡，每次建置都會換一組全新簽名，用戶手機上的舊版就會
# 無法覆蓋安裝（INSTALL_FAILED_UPDATE_INCOMPATIBLE）。
# release-cert.sha256 記錄「應該使用」的憑證指紋，簽錯金鑰直接中止建置。
KEYSTORE="$HERE/debug.keystore"
CERT_LOG="$HERE/release-cert.sha256"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -keystore "$KEYSTORE" -alias nexusdebug \
    -storepass nexusapp -keypass nexusapp -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=NEXUS,O=NEXUS,C=TW"
fi
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-pass pass:nexusapp --key-pass pass:nexusapp \
  --min-sdk-version 24 \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --out NEXUS.apk build/aligned.apk

echo "== 驗證 =="
CERTS="$("$BT/apksigner" verify --print-certs NEXUS.apk)"
echo "$CERTS" | head -6
GOT_CERT="$(echo "$CERTS" | awk '/SHA-256 digest/{print $NF; exit}')"
if [ -f "$CERT_LOG" ]; then
  WANT_CERT="$(tr -d '[:space:]' < "$CERT_LOG")"
  if [ "$GOT_CERT" != "$WANT_CERT" ]; then
    echo "!! 失敗：簽名憑證與記錄不符 —— 停止建置，避免發布用戶裝不上的 APK" >&2
    echo "   期望: $WANT_CERT" >&2
    echo "   實際: $GOT_CERT" >&2
    echo "   請確認 $KEYSTORE 是否為原始金鑰庫" >&2
    exit 1
  fi
  echo "== 憑證指紋與 release-cert.sha256 一致: $GOT_CERT =="
else
  printf '%s\n' "$GOT_CERT" > "$CERT_LOG"
  echo "== 已建立憑證指紋記錄 → $CERT_LOG =="
fi
"$BT/aapt" dump badging NEXUS.apk | grep -E "package|application-label|launchable-activity|sdkVersion|targetSdkVersion"
echo "OK → $(pwd)/NEXUS.apk ($(du -h NEXUS.apk | cut -f1))"