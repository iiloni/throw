package org.iloni.throwtasks;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.res.Resources;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;

/** Chooses the launcher entry among the StableIcon, PreviewIcon and DevIcon aliases. */
final class AppIcons {
    private static final String[] ICONS = {"stable", "preview", "dev"};
    private static final String[] ALIASES = {"StableIcon", "PreviewIcon", "DevIcon"};

    /** The installed channel's icon: the one its manifest enables. */
    static int defaultIndex(Context context) {
        Resources resources = context.getResources();
        if (resources.getBoolean(R.bool.default_dev_icon)) return 2;
        return resources.getBoolean(R.bool.default_preview_icon) ? 1 : 0;
    }

    // A build offers its own channel's icon and those of the channels released after it:
    // stable only Stable, preview Stable and Preview, dev all three.
    private static int iconIndex(Context context, String icon) {
        for (int i = 0; i < ICONS.length; i++) {
            if (ICONS[i].equals(icon) && i <= defaultIndex(context)) return i;
        }
        throw new IllegalArgumentException("Unknown app icon.");
    }

    private static ComponentName component(Context context, int index) {
        return new ComponentName(context.getPackageName(), "org.iloni.throwtasks." + ALIASES[index]);
    }

    static String preview(Context context, String icon) throws PackageManager.NameNotFoundException {
        PackageManager manager = context.getPackageManager();
        // Loading the alias also works while disabled and preserves the platform's adaptive mask.
        Drawable drawable = manager
                .getActivityInfo(component(context, iconIndex(context, icon)), PackageManager.MATCH_DISABLED_COMPONENTS)
                .loadIcon(manager);
        Bitmap bitmap = Bitmap.createBitmap(256, 256, Bitmap.Config.ARGB_8888);
        try {
            drawable.setBounds(0, 0, bitmap.getWidth(), bitmap.getHeight());
            drawable.draw(new Canvas(bitmap));
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes)) {
                throw new IllegalStateException("Could not render the launcher icon.");
            }
            return "data:image/png;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
        } finally {
            bitmap.recycle();
        }
    }

    static void set(Context context, String icon) {
        int selected = iconIndex(context, icon);
        int fallback = defaultIndex(context);

        PackageManager manager = context.getPackageManager();
        ComponentName[] components = new ComponentName[ALIASES.length];
        int[] previous = new int[ALIASES.length];
        boolean changed = false;
        for (int i = 0; i < ALIASES.length; i++) {
            components[i] = component(context, i);
            previous[i] = manager.getComponentEnabledSetting(components[i]);
            if (enabled(previous[i], i == fallback) != (i == selected)) changed = true;
        }
        if (!changed) return;

        int on = PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
        int off = PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
        int flags = PackageManager.DONT_KILL_APP;
        if (Build.VERSION.SDK_INT >= 33) {
            List<PackageManager.ComponentEnabledSetting> settings = new ArrayList<>();
            for (int i = 0; i < components.length; i++) {
                settings.add(new PackageManager.ComponentEnabledSetting(components[i], i == selected ? on : off, flags));
            }
            manager.setComponentEnabledSettings(settings);
        } else {
            // Enable first so the launcher always has an entry; never disable MainActivity.
            manager.setComponentEnabledSetting(components[selected], on, flags);
            try {
                for (int i = 0; i < components.length; i++) {
                    if (i != selected) manager.setComponentEnabledSetting(components[i], off, flags);
                }
            } catch (RuntimeException error) {
                // Restore the old entry before removing the one we just enabled.
                for (int i = 0; i < components.length; i++) {
                    if (enabled(previous[i], i == fallback)) {
                        manager.setComponentEnabledSetting(components[i], previous[i], flags);
                    }
                }
                for (int i = 0; i < components.length; i++) {
                    manager.setComponentEnabledSetting(components[i], previous[i], flags);
                }
                throw error;
            }
        }
    }

    private static boolean enabled(int setting, boolean defaultEnabled) {
        return setting == PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                || (setting == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && defaultEnabled);
    }
}
