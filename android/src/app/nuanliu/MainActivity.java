package app.nuanliu;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** 暖流的安卓外壳：把打包在 APK 里的网页界面放进 WebView，并提供原生的通知和文件保存。 */
public class MainActivity extends Activity {
    /** 只在 App 内部使用的虚拟网址，让界面运行在 https 环境里（本机数据库需要）。 */
    static final String HOST = "app.nuanliu.internal";
    static final String BASE = "https://" + HOST + "/";
    static final String EXTRA_HASH = "hash";
    private static final int REQ_NOTIF = 1, REQ_SAVE = 2, REQ_PICK = 3;
    private static final int BAR_COLOR = 0xFFF2F2F7;

    private WebView web;
    private String pendingText;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setStatusBarColor(BAR_COLOR);
        getWindow().setNavigationBarColor(BAR_COLOR);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);

        web = new WebView(this);
        web.setBackgroundColor(BAR_COLOR);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setTextZoom(100);
        web.addJavascriptInterface(new Bridge(), "NativeApp");
        web.setWebViewClient(new AssetClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.setType("*/*");
                try {
                    startActivityForResult(pick, REQ_PICK);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });
        setContentView(web);
        web.loadUrl(BASE + hashOf(getIntent()));
        ReminderReceiver.schedule(this);
    }

    /** 只接受 #home、#entry 这类页面名；其它 App 传进来的任何别的内容一律忽略 */
    private static String hashOf(Intent i) {
        String h = i == null ? null : i.getStringExtra(EXTRA_HASH);
        return h != null && h.matches("#[a-z]{1,16}") ? h : "";
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String h = hashOf(intent);
        if (!h.isEmpty()) web.evaluateJavascript("location.hash='" + h + "'", null);
    }

    @Override
    public void onBackPressed() {
        String js = "(function(){var s=document.querySelector('#sheet-root');"
                + "if(s&&s.innerHTML){s.innerHTML='';return 1}"
                + "if(location.hash&&location.hash!=='#home'){location.hash='#home';return 1}return 0})()";
        web.evaluateJavascript(js, new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String v) {
                if ("0".equals(v)) finish();
            }
        });
    }

    private void callJs(final String code) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                web.evaluateJavascript(code, null);
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code == REQ_NOTIF) {
            boolean ok = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
            callJs("window.onNativeNotif&&onNativeNotif(" + ok + ")");
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
        if (code == REQ_PICK) {
            if (fileCallback != null) fileCallback.onReceiveValue(uri == null ? null : new Uri[]{uri});
            fileCallback = null;
        } else if (code == REQ_SAVE) {
            boolean ok = false;
            if (uri != null && pendingText != null) {
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    out.write(pendingText.getBytes(StandardCharsets.UTF_8));
                    ok = true;
                } catch (Exception e) {
                    ok = false;
                }
            }
            pendingText = null;
            callJs("window.onNativeSaved&&onNativeSaved(" + ok + ")");
        }
    }

    /** 从 APK 的 assets/www 里读取界面文件；其它网址（品牌 logo）照常走网络。 */
    private class AssetClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (!HOST.equals(u.getHost())) return null;
            String path = u.getPath();
            if (path == null || path.equals("/")) path = "/index.html";
            try {
                InputStream in = getAssets().open("www" + path);
                return new WebResourceResponse(mimeOf(path), isText(path) ? "utf-8" : null, in);
            } catch (IOException e) {
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null,
                        new ByteArrayInputStream(new byte[0]));
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            if (HOST.equals(req.getUrl().getHost())) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, req.getUrl()));
            } catch (Exception e) {
                // 没有能打开这个链接的应用
            }
            return true;
        }
    }

    private static boolean isText(String p) {
        return !(p.endsWith(".png") || p.endsWith(".ico"));
    }

    private static String mimeOf(String p) {
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".webmanifest") || p.endsWith(".json")) return "application/json";
        return "text/plain";
    }

    /** 界面里的 window.NativeApp */
    private class Bridge {
        @JavascriptInterface
        public boolean notificationsAllowed() {
            return getSystemService(NotificationManager.class).areNotificationsEnabled();
        }

        @JavascriptInterface
        public void requestNotifications() {
            if (Build.VERSION.SDK_INT >= 33 && !notificationsAllowed()) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
                    }
                });
            } else {
                callJs("window.onNativeNotif&&onNativeNotif(" + notificationsAllowed() + ")");
            }
        }

        /** 界面每次保存后把提醒需要的信息交给原生层 */
        @JavascriptInterface
        public void sync(String json) {
            getSharedPreferences(ReminderReceiver.PREFS, MODE_PRIVATE).edit().putString("data", json).apply();
            ReminderReceiver.schedule(MainActivity.this);
        }

        @JavascriptInterface
        public void testNotification() {
            ReminderReceiver.notify(MainActivity.this, 99, "暖流测试通知", "看到这条就代表通知可以正常显示。", "#entry");
        }

        @JavascriptInterface
        public void saveFile(String name, String mime, String text) {
            pendingText = text;
            final Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType(mime);
            i.putExtra(Intent.EXTRA_TITLE, name);
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        startActivityForResult(i, REQ_SAVE);
                    } catch (Exception e) {
                        callJs("window.onNativeSaved&&onNativeSaved(false)");
                    }
                }
            });
        }
    }
}
