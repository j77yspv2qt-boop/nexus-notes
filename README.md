# NEXUS — 筆記應用

單一 HTML 檔的離線記事 App（文字 / 表格 / 圖表 / 手繪），並提供 Android WebView APK。

## 功能

- **多筆記 / 多頁**：主頁卡片管理筆記，編輯頁可新增、刪除、調整頁面邊距。
- **元素工具**：文字框、表格（可拖曳格線調尺寸）、經濟圖表、自繪圖表。
- **自繪圖表**：只給 XY 軸，自行加直線 / 曲線 / 扭曲點、拉箭頭、標交點；線條顏色與畫筆共用同一套 **HSV 調色盤**（色譜 + 色相 + 常用色票 + 吸色）。
- **畫筆 / 螢光筆 / 橡皮擦**，透明度與粗細可調。
- **匯出**：JSON（可再匯入）、獨立 HTML、純文字、每頁 PNG、列印 / 存 PDF。
- **介面**：繁體中文 / 简体中文 / English 三語切換；深色模式；響應式（手機版隱藏側欄與屬性欄、頂列單行橫向捲動、雙指縮放）。

## 直接使用

用瀏覽器開啟 `note-app.html` 即可，無需伺服器（資料存於 localStorage）。

## Android App

`nexus-notes.apk` 為已簽署的 WebView 封裝（`com.nexus.notes`，minSdk 24 / targetSdk 35），
內嵌 `note-app.html` 離線執行。直接安裝即可。

### 自行建置 APK

需要 JDK 17 與 Android SDK（build-tools + platform 35）。純命令列建置，不使用 Gradle：

```bash
export ANDROID_HOME=/path/to/android-sdk
export JAVA_HOME=/path/to/jdk17
cp note-app.html android/assets/note-app.html   # 更新內嵌版本
cd android && ./build.sh                         # 產出 nexus-notes.apk
```

建置流程：`aapt2 compile/link` → `javac` → `d8` → 打包 dex → `zipalign` → `apksigner`。

> **簽名金鑰務必保留**：金鑰庫放在 `android/debug.keystore`（已 gitignore，不進版控）。
> 若遺失後重新產生，憑證會與已發布版本不同，用戶手機將**無法覆蓋安裝**
> （`INSTALL_FAILED_UPDATE_INCOMPATIBLE`，症狀是安裝時顯示「無法安裝」）。
> `android/release-cert.sha256` 記錄正確的憑證 SHA-256，`build.sh` 比對不符會直接中止建置。
> 萬一必須換金鑰，需先請用戶解除安裝舊版（一次性動作）。

## 測試

以 Chrome DevTools Protocol 進行 end-to-end 冒煙測試（需已安裝 Google Chrome）：

```bash
node smoke-test.js          # 核心 / 表格
node smoke-test-extras.js   # 上載 / 匯入
node smoke-test-i18n.js     # 三語
node smoke-test-zoom.js     # 縮放列
node smoke-test-arrows.js   # 箭頭 / 品牌
node smoke-test-ui.js       # 編輯列 / 手機版 / pinch
node smoke-test-v2.js       # 線條調色盤 / 頂列排版 / 側欄磨砂 / 縮放下拉
```

## 開發歷程（近期）

- 線條顏色改用與畫筆一致的自訂調色盤（HSV 色譜 + 色票 + 吸色），移除原生 color input。
- 編輯頁頂列文字放大（標籤 12.5px、按鈕 14px）並固定標籤寬度，切換語言不再位移。
- 左側「我的筆記」卡片改為圓角 + 灰白磨砂漸變質感（含深色模式）。
- 修正縮放比例下拉：非預設縮放值時動態選項會空白，現改為顯示百分比並自動去重。