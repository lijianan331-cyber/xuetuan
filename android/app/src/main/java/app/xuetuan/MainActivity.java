package app.xuetuan;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.ArrayList;
import java.util.List;

/**
 * 雪团 app：全屏打开网站。网站上的改动会直接出现在 app 里。
 * - 站内页面在 app 里打开；导航（谷歌/苹果地图、Waze）、谷歌登录等外部链接交给手机自己的 app 或浏览器。
 * - 谷歌登录：网页发现自己在 app 里时把回跳地址设成 xuetuan://auth，登录完浏览器跳回来，这里把登录结果交给网页。
 * - 选照片、定位：转给安卓系统的选择器和定位权限。
 */
public class MainActivity extends Activity {
    static final String HOME = "https://xuetuan.vercel.app/";
    static final String HOST = "xuetuan.vercel.app";
    static final int REQ_FILES = 1, REQ_PERM_LOC = 2, REQ_PERM_MEDIA = 3;

    WebView web;
    ValueCallback<Uri[]> fileCallback;
    WebChromeClient.FileChooserParams pendingParams;
    String geoOrigin;
    GeolocationPermissions.Callback geoCallback;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " XueTuanApp/1");
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return req.isForMainFrame() && handleUrl(req.getUrl());
            }
            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) showOffline();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                pendingParams = params;
                if (Build.VERSION.SDK_INT >= 29 && checkSelfPermission(Manifest.permission.ACCESS_MEDIA_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(mediaPerms(), REQ_PERM_MEDIA);
                } else openChooser();
                return true;
            }
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                if (!isSite(Uri.parse(origin))) {
                    cb.invoke(origin, false, false);
                    return;
                }
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    cb.invoke(origin, true, false);
                    return;
                }
                geoOrigin = origin;
                geoCallback = cb;
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_PERM_LOC);
            }
        });

        Uri start = getIntent() != null ? getIntent().getData() : null;
        if (start != null && finishLogin(start)) return;
        if (state != null) web.restoreState(state);
        else web.loadUrl(HOME);
    }

    String[] mediaPerms() {
        List<String> p = new ArrayList<>();
        p.add(Manifest.permission.ACCESS_MEDIA_LOCATION);
        if (Build.VERSION.SDK_INT >= 33) {
            p.add(Manifest.permission.READ_MEDIA_IMAGES);
            p.add(Manifest.permission.READ_MEDIA_VIDEO);
        } else p.add(Manifest.permission.READ_EXTERNAL_STORAGE);
        return p.toArray(new String[0]);
    }

    boolean isSite(Uri u) {
        return "https".equals(u.getScheme()) && HOST.equals(u.getHost())
                && u.getUserInfo() == null && (u.getPort() == -1 || u.getPort() == 443);
    }

    boolean handleUrl(Uri u) {
        String scheme = u.getScheme() == null ? "" : u.getScheme();
        if ("xuetuan".equals(scheme)) {
            finishLogin(u);
            return true;
        }
        if (isSite(u)) return false;
        if (!("https".equals(scheme) || "http".equals(scheme)
                || "geo".equals(scheme) || "mailto".equals(scheme) || "tel".equals(scheme))) return true;
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, u);
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(i);
        } catch (Exception e) {
            // No compatible external app is installed.
        }
        return true;
    }

    /* The verifier stays in the original WebView. Only its Supabase client can exchange the code. */
    boolean finishLogin(Uri u) {
        if (!"xuetuan".equals(u.getScheme()) || !"auth".equals(u.getEncodedAuthority())
                || u.getFragment() != null
                || (u.getPath() != null && !u.getPath().isEmpty())) return false;
        if (u.getQueryParameters("code").size() != 1) return false;
        String code = u.getQueryParameter("code");
        if (code == null || !code.matches("[A-Za-z0-9_-]{10,256}")) return false;
        web.loadUrl(HOME + "?app_auth=" + System.currentTimeMillis() + "&code=" + Uri.encode(code));
        return true;
    }

    void openChooser() {
        WebChromeClient.FileChooserParams params = pendingParams;
        Intent pick;
        try {
            pick = params.createIntent();
        } catch (Exception e) {
            pick = new Intent(Intent.ACTION_GET_CONTENT);
            pick.setType("*/*");
        }
        pick.addCategory(Intent.CATEGORY_OPENABLE);
        String[] types = params.getAcceptTypes();
        List<String> mimes = new ArrayList<>();
        for (String t : types) for (String part : t.split(",")) {
            part = part.trim();
            if (part.contains("/")) mimes.add(part);
        }
        if (mimes.isEmpty()) mimes.add("*/*");
        pick.setType(mimes.size() == 1 ? mimes.get(0) : "*/*");
        if (mimes.size() > 1) pick.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0]));
        if (params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        try {
            startActivityForResult(Intent.createChooser(pick, "选择照片"), REQ_FILES);
        } catch (ActivityNotFoundException e) {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req != REQ_FILES || fileCallback == null) { super.onActivityResult(req, res, data); return; }
        Uri[] out = null;
        if (res == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null && clip.getItemCount() > 0) {
                out = new Uri[clip.getItemCount()];
                for (int i = 0; i < out.length; i++) out[i] = clip.getItemAt(i).getUri();
            } else if (data.getData() != null) out = new Uri[]{data.getData()};
        }
        fileCallback.onReceiveValue(out);
        fileCallback = null;
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] results) {
        if (req == REQ_PERM_LOC && geoCallback != null) {
            boolean ok = false;
            for (int r : results) ok |= r == PackageManager.PERMISSION_GRANTED;
            geoCallback.invoke(geoOrigin, ok, false);
            geoCallback = null;
        } else if (req == REQ_PERM_MEDIA && fileCallback != null) {
            openChooser(); // 不给权限也照样能选，只是照片里的地点可能被系统去掉
        }
    }

    void showOffline() {
        String html = "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
                + "<body style='font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:90vh;color:#334;background:#F3F7FC'>"
                + "<p style='font-size:17px'>网络好像断了</p>"
                + "<a href='" + HOME + "' style='margin-top:12px;padding:10px 22px;border-radius:20px;background:#3F8AD4;color:#fff;text-decoration:none'>重新加载</a>"
                + "</body></html>";
        web.loadDataWithBaseURL(HOME, html, "text/html", "utf-8", null);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri u = intent.getData();
        if (u != null && "xuetuan".equals(u.getScheme())) finishLogin(u);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    /* 手机返回键：网页里能退就退（关掉图片、回到上一层），退到头才离开 app */
    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override protected void onPause() { super.onPause(); web.onPause(); CookieManager.getInstance().flush(); }
    @Override protected void onResume() { super.onResume(); web.onResume(); }
}
