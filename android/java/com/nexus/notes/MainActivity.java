package com.nexus.notes;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView web;
    private int insetTop = 0, insetBottom = 0;
    private boolean lightTheme = true;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                pushInsets();
                view.evaluateJavascript("(document.documentElement.getAttribute('data-theme')||'light')",
                        new ValueCallback<String>() {
                            @Override
                            public void onReceiveValue(String v) {
                                lightTheme = !String.valueOf(v).contains("dark");
                                syncBarIcons();
                            }
                        });
            }
        });
        web.setWebChromeClient(new WebChromeClient());
        /* 網頁切換主題時通知原生，讓狀態列/手勢列圖示深淺跟著變（深色模式才看得見） */
        web.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void onTheme(String t) {
                lightTheme = !"dark".equals(t);
                syncBarIcons();
            }
        }, "NexusNotes");
        /* 狀態列 / 手勢列安全區域：把實際覆蓋量寫入 CSS --safe-*（避免頂列被通知列壓住） */
        web.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                insetTop = insets.getSystemWindowInsetTop();
                insetBottom = insets.getSystemWindowInsetBottom();
                pushInsets();
                return insets;
            }
        });
        web.addOnLayoutChangeListener(new View.OnLayoutChangeListener() {
            @Override
            public void onLayoutChange(View v, int l, int t, int r, int b,
                                       int oldLeft, int oldTop, int oldRight, int oldBottom) {
                pushInsets();
            }
        });
        web.loadUrl("file:///android_asset/note-app.html");
        setContentView(web);
    }

    /* 計算狀態列真正覆蓋 WebView 的高度；非滿版時為 0（介面已在狀態列下方） */
    private void measureInsets() {
        int top = insetTop;
        int[] loc = new int[2];
        web.getLocationOnScreen(loc);
        int sbh = dimen("status_bar_height");
        int overlap = sbh - loc[1];
        if (overlap > top) top = overlap;
        int bottom = insetBottom;
        if (top > 0 && bottom <= 0) bottom = dimen("navigation_bar_height");
        insetTop = top;
        insetBottom = bottom;
    }

    private int dimen(String name) {
        int id = getResources().getIdentifier(name, "dimen", "android");
        return id > 0 ? getResources().getDimensionPixelSize(id) : 0;
    }

    private void pushInsets() {
        if (web == null) return;
        measureInsets();
        /* insetTop/Bottom 是實體像素，CSS 的 env(safe-area-inset-*) 單位是 CSS px，
           必須除以 density，否則 DPR 3 的手機會把狀態列高度放大 3 倍、頂列被壓得很下面。 */
        float density = getResources().getDisplayMetrics().density;
        if (density <= 0f) density = 1f;
        int top = Math.round(insetTop / density);
        int bottom = Math.round(insetBottom / density);
        String js = "try{var r=document.documentElement;"
                + "r.style.setProperty('--safe-top','" + top + "px');"
                + "r.style.setProperty('--safe-bottom','" + bottom + "px');}catch(e){}";
        web.evaluateJavascript(js, null);
    }

    /* 狀態列/手勢列圖示：淺色主題 → 深色圖示；深色主題 → 亮色圖示（否則會看不見） */
    private void syncBarIcons() {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                View decor = getWindow().getDecorView();
                int vis = decor.getSystemUiVisibility();
                if (lightTheme) {
                    vis |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                } else {
                    vis &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                }
                if (Build.VERSION.SDK_INT >= 27) {
                    if (lightTheme) {
                        vis |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                    } else {
                        vis &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                    }
                }
                decor.setSystemUiVisibility(vis);
            }
        });
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
