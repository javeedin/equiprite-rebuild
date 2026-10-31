package com.equiprite.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

/**
 * EquipRite for Android: EquipRite Mobile, served by the EquipRite desktop app on the PC, full screen like any app
 * (no browser bars), remembering the PC.
 *
 * Pairing: on the PC, EquipRite's QR code (This PC over Wi-Fi) opens EquipRite Mobile in the phone's browser; its
 * "Open in the EquipRite app" hands this app the PC's address with its pairing key (equiprite://open?url=…), and
 * from then on the app opens straight on it. Without the app installed, the same button downloads it from the PC.
 * The first screen scans the PC's QR code with the app's own scanner (ScanActivity), or takes the address typed.
 *
 * The page can ask the app to scan a unit's tag (window.EquipRiteApp.scan: its camera is not available over the PC's
 * plain-http Wi-Fi) and to fetch its newer version from the PC (update).
 *
 * Only the PC's own pages open inside the app; any other link opens in the browser. The page's camera, location and
 * file pickers are passed through, each asked for only when a screen needs it.
 */
public class MainActivity extends Activity {
    static final String PREFS = "equiprite";
    static final String KEY_URL = "url";
    static final String UA_NAME = "EquipRiteApp";
    static final int REQ_FILE = 1;
    static final int REQ_CAMERA = 2;
    static final int REQ_LOCATION = 3;
    static final int REQ_SCAN_SETUP = 4;
    static final int REQ_SCAN_PAGE = 5;
    static final int BAND = Color.rgb(46, 84, 104);
    static final int INK = Color.rgb(22, 33, 44);
    static final int MUTED = Color.rgb(90, 104, 118);

    FrameLayout root;
    WebView web;
    String url;
    ValueCallback<Uri[]> fileCallback;
    PermissionRequest pendingPermission;
    String pendingGeoOrigin;
    GeolocationPermissions.Callback pendingGeoCallback;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(BAND);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(243, 245, 248));
        setContentView(root);
        String linked = linkOf(getIntent());
        if (linked != null) save(linked);
        url = prefs().getString(KEY_URL, null);
        if (url != null) showWeb(url); else showSetup(null);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String linked = linkOf(intent);
        if (linked != null) {
            save(linked);
            showWeb(linked);
        }
    }

    SharedPreferences prefs() { return getSharedPreferences(PREFS, MODE_PRIVATE); }

    void save(String u) {
        url = u;
        prefs().edit().putString(KEY_URL, u).apply();
    }

    /** The PC's address from "Open in the EquipRite app" (equiprite://open?url=…), or null. */
    static String linkOf(Intent intent) {
        if (intent == null || intent.getData() == null) return null;
        Uri data = intent.getData();
        if (!"equiprite".equals(data.getScheme())) return null;
        return valid(data.getQueryParameter("url"));
    }

    /** A scanned code that is an address (http or https, with a host), or null: anything else is not the PC's code. */
    static String scannedAddress(String text) {
        if (text == null) return null;
        String t = text.trim();
        if (!t.startsWith("http://") && !t.startsWith("https://")) return null;
        return valid(t);
    }

    /** This app's version, as installed ("1.1"). */
    String version() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    /** An http(s) address with a host, or null. */
    static String valid(String u) {
        if (u == null) return null;
        String t = u.trim();
        if (!t.startsWith("http://") && !t.startsWith("https://")) t = "http://" + t;
        Uri p = Uri.parse(t);
        return p.getHost() == null || p.getHost().isEmpty() ? null : t;
    }

    /** Whether a link is one of the PC's own pages (opens in the app), not another site (opens in the browser). */
    boolean ours(Uri u) {
        if (url == null || u == null) return false;
        Uri home = Uri.parse(url);
        return home.getHost() != null && home.getHost().equals(u.getHost()) && home.getPort() == u.getPort();
    }

    // ── The app: the PC's EquipRite, full screen ───────────────────────────────────────────────────────────
    void showWeb(String u) {
        if (web == null) {
            web = new WebView(this);
            WebSettings s = web.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setDatabaseEnabled(true);
            s.setGeolocationEnabled(true);
            s.setMediaPlaybackRequiresUserGesture(false);
            s.setAllowFileAccess(false);
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
            s.setUserAgentString(s.getUserAgentString() + " " + UA_NAME + "/" + version() + " (Android)");
            CookieManager.getInstance().setAcceptCookie(true);
            CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
            web.addJavascriptInterface(new Bridge(), "EquipRiteApp");
            web.setWebViewClient(new WebViewClient() {
                // Android 7+ (the app's minimum); compiled against API 23, where it is not declared yet, so no @Override.
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    Uri target = request.getUrl();
                    if (ours(target)) return false;
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, target));
                    } catch (Exception e) {
                        // nothing on the phone opens it
                    }
                    return true;
                }

                @Override
                public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                    if (request.isForMainFrame()) showError(String.valueOf(error.getDescription()), false);
                }

                @Override
                public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                    if (request.isForMainFrame() && response.getStatusCode() == 403) showError("", true);
                }
            });
            web.setWebChromeClient(new WebChromeClient() {
                @Override
                public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                    if (fileCallback != null) fileCallback.onReceiveValue(null);
                    fileCallback = callback;
                    try {
                        startActivityForResult(params.createIntent(), REQ_FILE);
                        return true;
                    } catch (Exception e) {
                        fileCallback = null;
                        return false;
                    }
                }

                @Override
                public void onPermissionRequest(PermissionRequest request) {
                    boolean camera = false;
                    for (String r : request.getResources()) {
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) camera = true;
                    }
                    if (!camera) {
                        request.deny();
                    } else if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[] { PermissionRequest.RESOURCE_VIDEO_CAPTURE });
                    } else {
                        pendingPermission = request;
                        requestPermissions(new String[] { Manifest.permission.CAMERA }, REQ_CAMERA);
                    }
                }

                @Override
                public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                    if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                        callback.invoke(origin, true, false);
                    } else {
                        pendingGeoOrigin = origin;
                        pendingGeoCallback = callback;
                        requestPermissions(new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, REQ_LOCATION);
                    }
                }
            });
        }
        show(web);
        web.loadUrl(u);
    }

    /**
     * What the page can ask the app (window.EquipRiteApp): who it is, to connect to another PC, to scan a code with
     * the app's camera (the answer comes back as the page's "equiprite-scan" event: { text }, '' when cancelled), and
     * to fetch the newer app from the PC (the browser downloads it; the phone installs it over this one).
     */
    class Bridge {
        @JavascriptInterface
        public String info() {
            Uri home = url == null ? null : Uri.parse(url);
            String pc = home == null ? "" : home.getHost() + (home.getPort() > 0 ? ":" + home.getPort() : "");
            try {
                return new JSONObject().put("app", "android").put("version", version()).put("pc", pc).put("scan", true).toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void scan(final String prompt) {
            runOnUiThread(new Runnable() {
                public void run() {
                    Intent i = new Intent(MainActivity.this, ScanActivity.class);
                    i.putExtra(ScanActivity.EXTRA_PROMPT, prompt == null || prompt.isEmpty() ? "Point the camera at the unit's tag" : prompt);
                    startActivityForResult(i, REQ_SCAN_PAGE);
                }
            });
        }

        @JavascriptInterface
        public void update() {
            runOnUiThread(new Runnable() {
                public void run() {
                    Uri home = url == null ? null : Uri.parse(url);
                    if (home == null) return;
                    String pair = home.getQueryParameter("pair");
                    Uri apk = home.buildUpon().path("/__app/EquipRite.apk").clearQuery()
                        .appendQueryParameter("pair", pair == null ? "" : pair).build();
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, apk));
                    } catch (Exception e) {
                        // no browser
                    }
                }
            });
        }

        @JavascriptInterface
        public void changePc() {
            runOnUiThread(new Runnable() {
                public void run() {
                    prefs().edit().remove(KEY_URL).apply();
                    url = null;
                    showSetup(null);
                }
            });
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.getParent() != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        } else if (requestCode == REQ_SCAN_SETUP) {
            if (resultCode != RESULT_OK || data == null) return;
            String u = scannedAddress(data.getStringExtra(ScanActivity.EXTRA_TEXT));
            if (u == null) {
                showSetup("That is not EquipRite's code. On the PC, scan the code under This PC over Wi-Fi.");
                return;
            }
            save(u);
            showWeb(u);
        } else if (requestCode == REQ_SCAN_PAGE && web != null) {
            String text = resultCode == RESULT_OK && data != null ? data.getStringExtra(ScanActivity.EXTRA_TEXT) : "";
            web.evaluateJavascript("window.dispatchEvent(new CustomEvent('equiprite-scan', { detail: { text: "
                + JSONObject.quote(text == null ? "" : text) + " } }));", null);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        boolean ok = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (requestCode == REQ_CAMERA && pendingPermission != null) {
            if (ok) pendingPermission.grant(new String[] { PermissionRequest.RESOURCE_VIDEO_CAPTURE });
            else pendingPermission.deny();
            pendingPermission = null;
        } else if (requestCode == REQ_LOCATION && pendingGeoCallback != null) {
            pendingGeoCallback.invoke(pendingGeoOrigin, ok, false);
            pendingGeoCallback = null;
        }
    }

    // ── First start: how to connect to the PC ────────────────────────────────────────────────────────────
    void showSetup(String problem) {
        LinearLayout box = column();
        box.addView(logo());
        box.addView(text("EquipRite", 26, INK, true));
        box.addView(text("Your requests, approvals and the yard's work, from EquipRite on your PC.", 15, MUTED, false));
        box.addView(gap(12));
        if (problem != null) box.addView(note(problem));
        box.addView(text("Connect to your PC", 18, INK, true));
        box.addView(text("On the PC, open EquipRite and click the QR code button in the toolbar. Choose This PC over Wi-Fi and switch on "
            + "Let my phone connect. This phone must be on the same Wi-Fi.", 15, INK, false));
        Button scan = button("Scan the QR code", true);
        scan.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { scanSetup(); }
        });
        box.addView(scan);
        box.addView(gap(20));
        box.addView(text("Or type the address shown under the code:", 14, MUTED, false));
        final EditText input = new EditText(this);
        input.setHint("http://192.168.1.23:18898/?pair=…");
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setImeOptions(EditorInfo.IME_ACTION_GO);
        input.setSingleLine(true);
        box.addView(input, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        Button go = button("Connect", false);
        go.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) {
                String u = valid(input.getText().toString());
                if (u == null) {
                    showSetup("That is not an address. It looks like http://192.168.1.23:18898/?pair=…");
                    return;
                }
                save(u);
                showWeb(u);
            }
        });
        box.addView(go);
        show(scroll(box));
    }

    // ── The PC cannot be reached, or no longer knows this phone ──────────────────────────────────────────
    void showError(String detail, boolean unpaired) {
        Uri home = url == null ? null : Uri.parse(url);
        String pc = home == null ? "your PC" : "your PC (" + home.getHost() + ")";
        LinearLayout box = column();
        box.addView(logo());
        if (unpaired) {
            box.addView(text("Pair this phone again", 22, INK, true));
            box.addView(text("EquipRite on " + pc + " no longer knows this phone: its Wi-Fi link was switched off and on, or someone else "
                + "signed in. On the PC, open the QR code (This PC over Wi-Fi), scan it, and tap Open in the EquipRite app.", 15, INK, false));
        } else {
            box.addView(text("Can't reach EquipRite", 22, INK, true));
            box.addView(text("Check that:\n\n•  this phone is on the same Wi-Fi as " + pc + ",\n•  EquipRite is open on the PC,\n"
                + "•  Let my phone connect is on (QR code button, This PC over Wi-Fi).\n\nIf the PC's address changed, scan its code again.", 15, INK, false));
            if (detail != null && !detail.isEmpty()) box.addView(text(detail, 12, MUTED, false));
        }
        box.addView(gap(8));
        if (unpaired) {
            Button again = button("Scan the code again", true);
            again.setOnClickListener(new View.OnClickListener() {
                public void onClick(View v) { scanSetup(); }
            });
            box.addView(again);
        }
        Button retry = button("Try again", !unpaired);
        retry.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { if (url != null) showWeb(url); else showSetup(null); }
        });
        box.addView(retry);
        Button other = button("Connect to another PC", false);
        other.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) {
                prefs().edit().remove(KEY_URL).apply();
                url = null;
                showSetup(null);
            }
        });
        box.addView(other);
        show(scroll(box));
    }

    /** The app's scanner, for the PC's QR code. */
    void scanSetup() {
        Intent i = new Intent(this, ScanActivity.class);
        i.putExtra(ScanActivity.EXTRA_PROMPT, "Scan the QR code on the PC");
        i.putExtra(ScanActivity.EXTRA_QR_ONLY, true);
        startActivityForResult(i, REQ_SCAN_SETUP);
    }

    // ── Small helpers for the two native screens ─────────────────────────────────────────────────────────
    void show(View v) {
        root.removeAllViews();
        if (v.getParent() instanceof ViewGroup) ((ViewGroup) v.getParent()).removeView(v);
        root.addView(v, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    int dp(int v) { return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()); }

    LinearLayout column() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(24), dp(32), dp(24), dp(32));
        return box;
    }

    ScrollView scroll(View child) {
        ScrollView s = new ScrollView(this);
        s.setFillViewport(true);
        s.addView(child);
        return s;
    }

    View gap(int h) {
        View v = new View(this);
        v.setLayoutParams(new LinearLayout.LayoutParams(1, dp(h)));
        return v;
    }

    ImageView logo() {
        ImageView i = new ImageView(this);
        i.setImageResource(R.mipmap.ic_launcher);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(64), dp(64));
        lp.bottomMargin = dp(16);
        i.setLayoutParams(lp);
        return i;
    }

    TextView text(String s, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setLineSpacing(0, 1.15f);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(8);
        t.setLayoutParams(lp);
        return t;
    }

    TextView note(String s) {
        TextView t = text(s, 14, Color.rgb(127, 29, 29), false);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.rgb(253, 236, 234));
        bg.setCornerRadius(dp(10));
        t.setBackground(bg);
        t.setPadding(dp(12), dp(10), dp(12), dp(10));
        return t;
    }

    Button button(String label, boolean primary) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setTextColor(primary ? Color.WHITE : BAND);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(primary ? BAND : Color.WHITE);
        bg.setStroke(dp(1), BAND);
        bg.setCornerRadius(dp(12));
        b.setBackground(bg);
        b.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        lp.topMargin = dp(12);
        b.setLayoutParams(lp);
        return b;
    }
}
