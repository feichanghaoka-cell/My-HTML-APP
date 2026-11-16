package app.gearkit;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;

/** 器材库：把 gear/ 网页应用打包进 WebView，数据存在本机。 */
public class MainActivity extends Activity {
    // 应用内资源通过一个虚拟的 https 域名提供，这样 localStorage / IndexedDB 都能正常使用
    static final String HOST = "appassets.androidplatform.net";
    static final String START = "https://" + HOST + "/gear/index.html";
    static final int REQ_FILE = 1;

    WebView web;
    ValueCallback<Uri[]> pending;
    Uri cameraUri;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        int bg = night ? 0xFF000000 : 0xFFF2F2F7;
        Window w = getWindow();
        w.setStatusBarColor(bg);
        w.setNavigationBarColor(night ? 0xFF161618 : 0xFFF9F9F9);
        w.getDecorView().setSystemUiVisibility(night ? 0
                : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);

        web = new WebView(this);
        web.setBackgroundColor(bg);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setTextZoom(100);

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serve(request.getUrl());
            }
        });
        try {
            ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                    return serve(request.getUrl());
                }
            });
        } catch (Throwable ignored) {
        }
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                return chooseFile(cb, params);
            }
        });

        if (state == null || web.restoreState(state) == null) web.loadUrl(START);
    }

    /** 从 assets 里读取应用文件；其他域名（外链产品图）返回 null 走正常网络。 */
    WebResourceResponse serve(Uri u) {
        if (u == null || !HOST.equals(u.getHost())) return null;
        String path = u.getPath();
        if (path == null) path = "/";
        while (path.startsWith("/")) path = path.substring(1);
        if (path.isEmpty() || path.endsWith("/")) path += "index.html";
        if (!path.contains("..")) {
            try {
                InputStream in = getAssets().open(path);
                String[] m = mime(path);
                return new WebResourceResponse(m[0], m[1], in);
            } catch (IOException ignored) {
            }
        }
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
    }

    static String[] mime(String p) {
        if (p.endsWith(".html")) return new String[]{"text/html", "utf-8"};
        if (p.endsWith(".js")) return new String[]{"text/javascript", "utf-8"};
        if (p.endsWith(".css")) return new String[]{"text/css", "utf-8"};
        if (p.endsWith(".webmanifest")) return new String[]{"application/manifest+json", "utf-8"};
        if (p.endsWith(".json")) return new String[]{"application/json", "utf-8"};
        if (p.endsWith(".svg")) return new String[]{"image/svg+xml", "utf-8"};
        if (p.endsWith(".png")) return new String[]{"image/png", null};
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return new String[]{"image/jpeg", null};
        return new String[]{"application/octet-stream", null};
    }

    /** 网页里的 <input type=file>：带 capture 的打开相机，其余打开系统选择器。 */
    boolean chooseFile(ValueCallback<Uri[]> cb, WebChromeClient.FileChooserParams params) {
        if (pending != null) pending.onReceiveValue(null);
        pending = cb;
        cameraUri = null;
        String[] types = params.getAcceptTypes();
        boolean image = types != null && types.length > 0 && types[0] != null && types[0].startsWith("image/");
        try {
            Intent i;
            if (image && params.isCaptureEnabled()) {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Images.Media.DISPLAY_NAME, "gear_" + System.currentTimeMillis() + ".jpg");
                cv.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                cameraUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
                i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                i.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } else {
                i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType(image ? "image/*" : "*/*");
            }
            startActivityForResult(i, REQ_FILE);
        } catch (Exception e) {
            dropCameraRow();
            pending = null;
            cb.onReceiveValue(null);
            Toast.makeText(this, "无法打开相机或文件选择器", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    void dropCameraRow() {
        if (cameraUri == null) return;
        try {
            getContentResolver().delete(cameraUri, null, null);
        } catch (Exception ignored) {
        }
        cameraUri = null;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE || pending == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK) {
            if (data != null && data.getData() != null) {
                result = new Uri[]{data.getData()};
                if (cameraUri != null && !cameraUri.equals(data.getData())) dropCameraRow();
            } else if (cameraUri != null) {
                result = new Uri[]{cameraUri};
            }
        } else {
            dropCameraRow();
        }
        cameraUri = null;
        pending.onReceiveValue(result);
        pending = null;
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();   // 先关闭网页里的弹层
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    /** 给网页调用：把备份文件写进系统「下载」文件夹。 */
    class Bridge {
        @JavascriptInterface
        public boolean saveFile(String name, String text) {
            try {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
                cv.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                Uri u = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (u == null) return false;
                OutputStream o = getContentResolver().openOutputStream(u);
                if (o == null) return false;
                try {
                    o.write(text.getBytes(StandardCharsets.UTF_8));
                } finally {
                    o.close();
                }
                return true;
            } catch (Exception e) {
                return false;
            }
        }
    }
}
