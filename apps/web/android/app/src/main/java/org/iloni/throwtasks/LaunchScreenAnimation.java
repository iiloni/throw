package org.iloni.throwtasks;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.app.Activity;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.provider.Settings;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.AccelerateInterpolator;
import android.view.animation.AnticipateInterpolator;
import android.view.animation.PathInterpolator;
import androidx.core.splashscreen.SplashScreenViewProvider;

/**
 * The launch screen once Android hands it to the app: a soft glow breathes behind the
 * icon while the page loads, then the icon draws in on itself as the page fades in.
 */
final class LaunchScreenAnimation {
    private static final long GLOW_IN_MS = 400;
    private static final long BREATH_MS = 1100;
    private static final long COLLAPSE_MS = 450;
    private static final long REVEAL_DELAY_MS = 100;
    private static final long REVEAL_MS = 400;

    private final Activity activity;
    private final SplashScreenViewProvider provider;
    private final boolean hasIcon;
    private final View icon;
    private final int iconColor;
    private View glow;
    private ValueAnimator breathing;
    private ValueAnimator reveal;

    LaunchScreenAnimation(Activity activity, SplashScreenViewProvider provider, int iconColor) {
        this.activity = activity;
        this.provider = provider;
        this.iconColor = iconColor;
        icon = iconView(provider);
        hasIcon = icon != null && icon.getParent() instanceof ViewGroup && icon.getWidth() > 0;
    }

    private boolean animationsEnabled() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) return ValueAnimator.areAnimatorsEnabled();
        return Settings.Global.getFloat(
            activity.getContentResolver(), Settings.Global.ANIMATOR_DURATION_SCALE, 1f
        ) != 0f;
    }

    /** Starts the glow, which keeps breathing until `finish`. */
    void breathe() {
        if (!hasIcon || !animationsEnabled()) return;
        ViewGroup parent = (ViewGroup) icon.getParent();
        // The icon shows as a circle two thirds of its view's width; the glow fades out well
        // beyond that edge.
        int size = Math.round(icon.getWidth() * 1.4f);
        int color = iconColor;
        int clear = color & 0x00FFFFFF;
        GradientDrawable halo = new GradientDrawable();
        halo.setShape(GradientDrawable.OVAL);
        halo.setGradientType(GradientDrawable.RADIAL_GRADIENT);
        halo.setGradientRadius(size / 2f);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            halo.setColors(new int[] {color, color, clear}, new float[] {0f, 0.45f, 1f});
        } else {
            halo.setColors(new int[] {color, clear});
        }
        glow = new View(activity);
        glow.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        glow.setBackground(halo);
        glow.setAlpha(0f);
        parent.addView(glow, parent.indexOfChild(icon), new ViewGroup.LayoutParams(size, size));
        glow.setX(icon.getX() + (icon.getWidth() - size) / 2f);
        glow.setY(icon.getY() + (icon.getHeight() - size) / 2f);

        breathing = ValueAnimator.ofFloat(0f, 1f).setDuration(BREATH_MS);
        breathing.setRepeatMode(ValueAnimator.REVERSE);
        breathing.setRepeatCount(ValueAnimator.INFINITE);
        breathing.setInterpolator(new PathInterpolator(0.37f, 0f, 0.63f, 1f));
        breathing.addUpdateListener((animation) -> {
            float breath = (float) animation.getAnimatedValue();
            float arriving = Math.min(1f, animation.getCurrentPlayTime() / (float) GLOW_IN_MS);
            glow.setAlpha(arriving * (0.25f + 0.3f * breath));
            glow.setScaleX(0.92f + 0.12f * breath);
            glow.setScaleY(0.92f + 0.12f * breath);
        });
        breathing.start();
    }

    /**
     * Collapses the icon while the launch screen's background fades into the page, then removes
     * it. Only the background fades, so the icon stays solid as it shrinks away over the page.
     */
    void finish() {
        if (breathing != null) breathing.cancel();
        if (!animationsEnabled()) {
            provider.remove();
            return;
        }
        View screen = provider.getView();
        PathInterpolator ease = new PathInterpolator(0.3f, 0f, 0.2f, 1f);
        Drawable backdrop = screen.getBackground();
        if (!hasIcon || backdrop == null) {
            screen.animate().alpha(0f).setDuration(250).setInterpolator(ease).withEndAction(provider::remove).start();
            return;
        }
        icon.animate()
            .scaleX(0f)
            .scaleY(0f)
            .setDuration(COLLAPSE_MS)
            .setInterpolator(new AnticipateInterpolator(1.2f))
            .start();
        if (glow != null) {
            glow.animate()
                .scaleX(0f)
                .scaleY(0f)
                .alpha(0f)
                .setDuration(COLLAPSE_MS)
                .setInterpolator(new AccelerateInterpolator())
                .start();
        }
        Drawable fading = backdrop.mutate();
        reveal = ValueAnimator.ofInt(255, 0).setDuration(REVEAL_MS);
        reveal.setStartDelay(REVEAL_DELAY_MS);
        reveal.setInterpolator(ease);
        reveal.addUpdateListener((animation) -> {
            fading.setAlpha((int) animation.getAnimatedValue());
            screen.invalidate();
        });
        reveal.addListener(new AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(Animator animation) {
                provider.remove();
            }
        });
        reveal.start();
    }

    void cancel() {
        if (breathing != null) breathing.cancel();
        if (reveal != null) reveal.cancel();
        if (glow != null) glow.animate().cancel();
        if (icon != null) icon.animate().cancel();
        provider.getView().animate().cancel();
    }

    /** A launch screen without an icon, such as one Android shows for a widget, has no view. */
    private static View iconView(SplashScreenViewProvider provider) {
        try {
            return provider.getIconView();
        } catch (RuntimeException error) {
            return null;
        }
    }
}
