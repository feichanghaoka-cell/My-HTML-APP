package com.climbcheckin.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Shows the bundled index.html in a WebView and bridges backup export/import to the system file picker. */
public class MainActivity extends Activity {
    private static final int REQ_EXPORT = 1;
    private static final int REQ_IMPORT = 2;

    private WebView web;
    private String pendingExport;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // localStorage holds all check-in data
        s.setAllowFileAccess(false);

        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(i, REQ_IMPORT);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });
        web.addJavascriptInterface(this, "AndroidBridge");
        web.loadUrl("file:///android_asset/index.html");
    }

    // Called from the page's JavaScript as AndroidBridge.exportBackup(...).
    @JavascriptInterface
    public void exportBackup(final String json, final String fileName) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                pendingExport = json;
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("application/json");
                i.putExtra(Intent.EXTRA_TITLE, fileName);
                try {
                    startActivityForResult(i, REQ_EXPORT);
                } catch (ActivityNotFoundException e) {
                    pendingExport = null;
                    toast("这台手机没有可用的文件管理器");
                }
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
        if (requestCode == REQ_IMPORT) {
            if (fileCallback != null) fileCallback.onReceiveValue(uri != null ? new Uri[] { uri } : null);
            fileCallback = null;
        } else if (requestCode == REQ_EXPORT) {
            String json = pendingExport;
            pendingExport = null;
            if (uri == null || json == null) return;
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                out.write(json.getBytes(StandardCharsets.UTF_8));
                toast("备份已保存");
            } catch (Exception e) {
                toast("备份保存失败");
            }
        }
    }

    private void toast(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
    }
}
