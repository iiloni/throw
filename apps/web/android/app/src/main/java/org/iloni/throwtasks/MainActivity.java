package org.iloni.throwtasks;

import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final long LAUNCH_TIMEOUT_MS = 3000;

    private final Handler mainThread = new Handler(Looper.getMainLooper());
    private final Runnable launchTimeout = this::finishLaunch;
    private boolean launching = true;
    private LaunchScreenAnimation launchScreen;
    private ResumeRepaint resumeRepaint;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        int icon = AppIcons.launchIndex(this, getIntent().getComponent());
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            getTheme().applyStyle(AppIcons.compatSplashIcon(icon), true);
        }
        // Holding the system's first frame would also stop the WebView drawing underneath it.
        SplashScreen.installSplashScreen(this).setOnExitAnimationListener(provider -> {
            launchScreen = new LaunchScreenAnimation(this, provider, AppIcons.glowColor(this, icon));
            if (launching) launchScreen.breathe();
            else launchScreen.finish();
        });
        mainThread.postDelayed(launchTimeout, LAUNCH_TIMEOUT_MS);
        registerPlugin(LaunchScreenPlugin.class);
        registerPlugin(HapticFeedbackPlugin.class);
        registerPlugin(KeyboardInsetsPlugin.class);
        registerPlugin(AppUpdatesPlugin.class);
        registerPlugin(AppIconsPlugin.class);
        super.onCreate(savedInstanceState);
        // Nested CSS scrollers own the page's scrollbars.
        WebView webView = getBridge().getWebView();
        webView.setBackgroundColor(getColor(R.color.splashBackground));
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        resumeRepaint = new ResumeRepaint(webView);
    }

    @Override
    public void onResume() {
        super.onResume();
        resumeRepaint.resumed();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) resumeRepaint.focused();
    }

    @Override
    public void onStop() {
        super.onStop();
        resumeRepaint.stopped();
    }

    void onLaunchPageReady() {
        runOnUiThread(() -> {
            if (!launching || isDestroyed()) return;
            // The JS frame can finish before the WebView compositor has a frame to reveal.
            getBridge().getWebView().postVisualStateCallback(0, new WebView.VisualStateCallback() {
                @Override
                public void onComplete(long requestId) {
                    finishLaunch();
                }
            });
        });
    }

    private void finishLaunch() {
        if (!launching) return;
        launching = false;
        mainThread.removeCallbacks(launchTimeout);
        if (launchScreen != null) launchScreen.finish();
    }

    @Override
    public void onDestroy() {
        launching = false;
        mainThread.removeCallbacks(launchTimeout);
        if (launchScreen != null) launchScreen.cancel();
        if (resumeRepaint != null) resumeRepaint.destroyed();
        super.onDestroy();
    }
}
