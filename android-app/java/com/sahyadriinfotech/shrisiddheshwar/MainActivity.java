package com.sahyadriinfotech.shrisiddheshwar;

import android.Manifest;
import android.app.Activity;
import android.app.KeyguardManager;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.SystemClock;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.OutputStream;

/**
 * Shows the inventory website and adds what a plain WebView lacks: camera access for scanning,
 * printing of labels and bills, saving CSV exports, the back button, loading and offline screens,
 * and an app lock (fingerprint or screen lock) while someone is signed in.
 */
public class MainActivity extends Activity {
    private static final int CAMERA_REQUEST = 1;
    /** How long the app can stay in the background before it asks to be unlocked again. */
    private static final long LOCK_AFTER_MS = 60_000L;

    /**
     * Added to every loaded page. It sends window.print() and "download a generated file" to the app
     * (the file is read from the object itself, because the site's security policy blocks fetching
     * blob: URLs), and reloads the page when a new website version is found on return to the app.
     */
    private static final String SHIM =
        "(function(){if(window.__invenza)return;window.__invenza=true;"
        + "window.print=function(){InvenzaApp.print(!!document.querySelector('.sticker'));};"
        + "var blobs={},create=URL.createObjectURL.bind(URL),click=HTMLAnchorElement.prototype.click;"
        + "URL.createObjectURL=function(o){var u=create(o);if(o instanceof Blob){blobs[u]=o;"
        + "setTimeout(function(){delete blobs[u];},60000);}return u;};"
        + "HTMLAnchorElement.prototype.click=function(){var b=this.download&&blobs[this.href];"
        + "if(!b)return click.call(this);var name=this.download,r=new FileReader();"
        + "r.onload=function(){InvenzaApp.save(name,b.type||'text/csv',String(r.result).split(',')[1]||'');};"
        + "r.readAsDataURL(b);};"
        // each website version has its own main-XXXX.js name
        + "var main=function(h){var m=h.match(/main-[A-Za-z0-9_-]+\\.js/);return m&&m[0];},"
        + "loaded=main(document.documentElement.innerHTML);"
        + "document.addEventListener('visibilitychange',function(){if(document.hidden||!loaded)return;"
        + "fetch('/',{cache:'no-store'}).then(function(r){return r.ok?r.text():'';}).then(function(h){"
        + "var now=main(h);if(now&&now!==loaded)location.reload();}).catch(function(){});});})();";

    private Uri home;
    private WebView web;
    private View overlay;
    private ProgressBar spinner;
    private TextView overlayText;
    private Button retryButton;
    private boolean failed;
    private boolean pageDone;
    private View lockView;
    private boolean lockRequired = true; // so the first opening is checked too
    private boolean prompting;
    private boolean foreground;
    private long backgroundedAt;
    private PermissionRequest cameraRequest;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        home = Uri.parse(getString(R.string.site_url));

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);
        web = new WebView(this);
        overlay = overlayView();
        lockView = lockScreen();
        root.addView(web);
        root.addView(overlay);
        root.addView(lockView);
        keepClearOfSystemBars(root);
        setContentView(root);
        darkStatusBarIcons();

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true); // the sign-in is kept in localStorage
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(false); // camera preview
        web.addJavascriptInterface(new Bridge(), "InvenzaApp");
        web.setWebViewClient(new SiteClient());
        web.setWebChromeClient(new CameraClient());

        if (state == null || web.restoreState(state) == null) {
            web.loadUrl(home.toString());
        }
    }

    private boolean isOurSite(Uri url) {
        return url != null && home.getScheme().equals(url.getScheme())
            && home.getHost().equals(url.getHost()) && home.getPort() == url.getPort();
    }

    private boolean isShowingOurSite() {
        String url = web.getUrl();
        return url != null && isOurSite(Uri.parse(url));
    }

    /** Android 15+ draws apps behind the status and navigation bars, so pad the content past them. */
    private void keepClearOfSystemBars(View root) {
        if (Build.VERSION.SDK_INT < 30) {
            root.setFitsSystemWindows(true);
            return;
        }
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            view.setPadding(i.left, i.top, i.right, i.bottom);
            return WindowInsets.CONSUMED;
        });
    }

    private void darkStatusBarIcons() {
        if (Build.VERSION.SDK_INT >= 30) {
            int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            WindowInsetsController controller = getWindow().getDecorView().getWindowInsetsController();
            if (controller != null) controller.setSystemBarsAppearance(light, light);
        }
    }

    // ---- Loading and offline screen ----

    /** Covers the page while it loads, and offers Retry when it cannot be loaded. */
    private View overlayView() {
        LinearLayout box = column();
        spinner = new ProgressBar(this);
        overlayText = label("Loading SiddheshwarInventry…");
        retryButton = button("Retry", v -> {
            String current = web.getUrl();
            showLoading();
            web.loadUrl(current != null && isOurSite(Uri.parse(current)) ? current : home.toString());
        });
        retryButton.setVisibility(View.GONE);
        box.addView(spinner, wrapContent());
        box.addView(overlayText, wrapContent());
        box.addView(retryButton, wrapContent());
        return box;
    }

    private void showLoading() {
        failed = false;
        pageDone = false;
        spinner.setVisibility(View.VISIBLE);
        retryButton.setVisibility(View.GONE);
        overlayText.setText("Loading SiddheshwarInventry…");
        overlay.setVisibility(View.VISIBLE);
    }

    private void showFailure() {
        failed = true;
        spinner.setVisibility(View.GONE);
        retryButton.setVisibility(View.VISIBLE);
        overlayText.setText("Cannot reach SiddheshwarInventry.\nCheck your internet connection and try again.");
        overlay.setVisibility(View.VISIBLE);
    }

    private LinearLayout column() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Color.WHITE);
        box.setClickable(true); // taps must not reach the page underneath
        box.setPadding(60, 60, 60, 60);
        return box;
    }

    private TextView label(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(17);
        view.setTextColor(Color.rgb(15, 27, 42));
        view.setGravity(Gravity.CENTER);
        view.setPadding(0, 40, 0, 40);
        return view;
    }

    private Button button(String text, View.OnClickListener action) {
        Button view = new Button(this);
        view.setText(text);
        view.setOnClickListener(action);
        return view;
    }

    private LinearLayout.LayoutParams wrapContent() {
        return new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    }

    // ---- App lock ----

    private View lockScreen() {
        LinearLayout box = column();
        box.addView(label("SiddheshwarInventry is locked"), wrapContent());
        box.addView(button("Unlock", v -> showUnlockPrompt()), wrapContent());
        box.addView(button("Sign in with password", v -> signOut()), wrapContent());
        box.setVisibility(View.GONE);
        return box;
    }

    /** Locks the app if it is due and someone is signed in; a signed-out app has nothing to protect. */
    private void requestLock() {
        if (!foreground || !lockRequired || !pageDone || prompting) return;
        lockView.setVisibility(View.VISIBLE);
        web.evaluateJavascript("(function(){try{return localStorage.getItem('invenza.token')?'1':'';}catch(e){return '';}})()", result -> {
            if (!"\"1\"".equals(result)) unlock();
            else if (foreground) showUnlockPrompt();
        });
    }

    /** Fingerprint, or the phone's PIN, pattern or password. */
    private void showUnlockPrompt() {
        if (prompting) return;
        if (!getSystemService(KeyguardManager.class).isDeviceSecure()) {
            signOut(); // the phone cannot check who this is, so ask for the account password
            return;
        }
        BiometricPrompt.Builder builder = new BiometricPrompt.Builder(this)
            .setTitle("Unlock SiddheshwarInventry")
            .setSubtitle("Use your fingerprint or screen lock");
        if (Build.VERSION.SDK_INT >= 30) {
            builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL);
        } else {
            builder.setDeviceCredentialAllowed(true);
        }
        prompting = true;
        builder.build().authenticate(new CancellationSignal(), getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                unlock();
            }

            @Override
            public void onAuthenticationError(int code, CharSequence message) {
                prompting = false; // the lock stays up: try again, or sign in with the password
            }
        });
    }

    private void unlock() {
        prompting = false;
        lockRequired = false;
        lockView.setVisibility(View.GONE);
    }

    private void signOut() {
        web.evaluateJavascript("try{localStorage.clear();sessionStorage.clear();}catch(e){}", done -> {
            unlock();
            showLoading();
            web.loadUrl(home.toString());
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        foreground = true;
        if (backgroundedAt > 0 && !prompting && SystemClock.elapsedRealtime() - backgroundedAt >= LOCK_AFTER_MS) {
            lockRequired = true;
        }
        backgroundedAt = 0;
        requestLock();
    }

    @Override
    protected void onPause() {
        foreground = false;
        super.onPause();
    }

    @Override
    protected void onStop() {
        // onStop, not onPause: a permission dialog pauses the app without hiding it
        backgroundedAt = SystemClock.elapsedRealtime();
        super.onStop();
    }

    // ---- Website ----

    /** Keeps the app on our site; any other link opens in the phone's own apps. */
    private class SiteClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (isOurSite(url)) return false;
            String scheme = url.getScheme();
            if ("https".equals(scheme) || "http".equals(scheme) || "mailto".equals(scheme) || "tel".equals(scheme)) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (ActivityNotFoundException e) {
                    toast("No app can open this link.");
                }
            }
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (failed) return;
            overlay.setVisibility(View.GONE);
            if (isOurSite(Uri.parse(url))) view.evaluateJavascript(SHIM, null);
            pageDone = true;
            requestLock();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showFailure();
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (request.isForMainFrame() && response.getStatusCode() >= 500) showFailure();
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            recreate(); // rebuild the page instead of letting Android close the app
            return true;
        }
    }

    /** Lets only our own site use the camera, after the user has allowed it in Android. */
    private class CameraClient extends WebChromeClient {
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            boolean wantsCameraOnly = request.getResources().length == 1
                && PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(request.getResources()[0]);
            if (!wantsCameraOnly || !isOurSite(request.getOrigin())) {
                request.deny();
            } else if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                request.grant(request.getResources());
            } else {
                if (cameraRequest != null) cameraRequest.deny();
                cameraRequest = request;
                requestPermissions(new String[] {Manifest.permission.CAMERA}, CAMERA_REQUEST);
            }
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
            if (request == cameraRequest) cameraRequest = null;
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        if (code != CAMERA_REQUEST || cameraRequest == null) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            cameraRequest.grant(cameraRequest.getResources());
        } else {
            cameraRequest.deny();
        }
        cameraRequest = null;
    }

    /** What the page can ask the app to do. Both calls are ignored unless our own site is showing. */
    private class Bridge {
        @JavascriptInterface
        public void print(boolean sticker) {
            runOnUiThread(() -> {
                if (!isShowingOurSite()) return;
                PrintAttributes.Builder paper = new PrintAttributes.Builder();
                if (sticker) {
                    // sizes are in thousandths of an inch: 63 mm = 2480
                    paper.setMediaSize(new PrintAttributes.MediaSize("STICKER_63", "63 x 63 mm", 2480, 2480))
                        .setMinMargins(PrintAttributes.Margins.NO_MARGINS);
                }
                String job = sticker ? "SiddheshwarInventry label" : "SiddheshwarInventry bill";
                PrintManager manager = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                manager.print(job, web.createPrintDocumentAdapter(job), paper.build());
            });
        }

        @JavascriptInterface
        public void save(String name, String type, String base64) {
            runOnUiThread(() -> {
                if (!isShowingOurSite()) return;
                String file = name.replaceAll("[^A-Za-z0-9._-]", "_");
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, file);
                values.put(MediaStore.Downloads.MIME_TYPE, type.split(";")[0]);
                try {
                    Uri target = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    try (OutputStream out = getContentResolver().openOutputStream(target)) {
                        out.write(Base64.decode(base64, Base64.DEFAULT));
                    }
                    toast("Saved to Downloads: " + file);
                } catch (Exception e) {
                    toast("Could not save the file.");
                }
            });
        }
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (overlay.getVisibility() != View.VISIBLE && lockView.getVisibility() != View.VISIBLE && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        web.saveState(state);
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
