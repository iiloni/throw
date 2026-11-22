package org.iloni.throwtasks;

import static org.junit.Assert.*;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.util.Base64;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {24, 36})
public class AppIconsTest {
    private static final String[] ICONS = {"stable", "preview", "dev"};
    private static final String[] ALIASES = {"StableIcon", "PreviewIcon", "DevIcon"};
    private Context context;
    private PackageManager manager;
    private int channel;

    @Before
    public void setup() {
        context = RuntimeEnvironment.getApplication();
        manager = context.getPackageManager();
        channel = AppIcons.defaultIndex(context);
    }

    private ComponentName component(String name) {
        return new ComponentName(context.getPackageName(), "org.iloni.throwtasks." + name);
    }

    private ComponentName launcher() {
        return manager.getLaunchIntentForPackage(context.getPackageName()).getComponent();
    }

    @Test
    public void theInstalledChannelIsTheOnlyLauncher() throws Exception {
        String expected = context.getPackageName().endsWith(".dev") ? "DevIcon"
                : context.getPackageName().endsWith(".preview") ? "PreviewIcon" : "StableIcon";
        assertEquals(expected, ALIASES[channel]);
        for (String alias : ALIASES) {
            assertEquals(alias.equals(expected),
                    manager.getActivityInfo(component(alias), PackageManager.MATCH_DISABLED_COMPONENTS).enabled);
        }
        assertEquals(component(expected), launcher());
    }

    @Test
    public void switchesEveryOfferedIconWithoutDisablingTheActivity() throws Exception {
        for (int round = 0; round < 2; round++) {
            for (int selected = channel; selected >= 0; selected--) {
                AppIcons.set(context, ICONS[selected]);
                assertEquals(component(ALIASES[selected]), launcher());
                for (int i = 0; i < ALIASES.length; i++) {
                    if (i == selected) continue;
                    assertNotEquals(PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                            manager.getComponentEnabledSetting(component(ALIASES[i])));
                }
                assertTrue(manager.getActivityInfo(component("MainActivity"), 0).enabled);
            }
        }
        Intent view = new Intent(Intent.ACTION_MAIN).setComponent(component("MainActivity"));
        assertEquals("org.iloni.throwtasks.MainActivity", manager.resolveActivity(view, 0).activityInfo.name);
    }

    @Test
    public void launchSplashFollowsTheSelectedAlias() {
        for (int i = 0; i <= channel; i++) {
            AppIcons.set(context, ICONS[i]);
            int launchIcon = AppIcons.launchIndex(context, launcher());
            assertEquals(i, launchIcon);
            assertChannelHue(i, AppIcons.glowColor(context, launchIcon));
        }
    }

    @Test
    public void buildsRefuseIconsOfEarlierChannels() {
        for (int i = channel + 1; i < ICONS.length; i++) {
            String icon = ICONS[i];
            assertThrows(IllegalArgumentException.class, () -> AppIcons.set(context, icon));
            assertThrows(IllegalArgumentException.class, () -> AppIcons.preview(context, icon));
        }
        for (String alias : ALIASES) {
            assertEquals(PackageManager.COMPONENT_ENABLED_STATE_DEFAULT, manager.getComponentEnabledSetting(component(alias)));
        }
    }

    @Test
    public void invalidChoicesLeaveTheLauncherAlone() {
        assertThrows(IllegalArgumentException.class, () -> AppIcons.set(context, "nightly"));
        assertThrows(IllegalArgumentException.class, () -> AppIcons.set(context, null));
        for (String alias : ALIASES) {
            assertEquals(PackageManager.COMPONENT_ENABLED_STATE_DEFAULT, manager.getComponentEnabledSetting(component(alias)));
        }
    }

    private static int brightness(int color) {
        return Color.red(color) + Color.green(color) + Color.blue(color);
    }

    private static void assertChannelHue(int channel, int color) {
        int r = Color.red(color);
        int g = Color.green(color);
        int b = Color.blue(color);
        String hex = String.format("#%06X", color & 0xFFFFFF);
        if (channel == 0) assertTrue("jade " + hex, g > r + 60 && g > b);
        if (channel == 1) assertTrue("purple " + hex, b > g + 20 && r > g);
        if (channel == 2) assertTrue("blue " + hex, b > r + 20 && g > r);
    }

    @Test
    @Config(sdk = 36)
    @GraphicsMode(GraphicsMode.Mode.NATIVE)
    public void previewsRenderEachChannelsOwnAdaptiveArtworkWithoutChangingTheChoice() throws Exception {
        for (int i = 0; i <= channel; i++) {
            String source = AppIcons.preview(context, ICONS[i]);
            assertTrue(source.startsWith("data:image/png;base64,"));
            byte[] bytes = Base64.decode(source.substring(source.indexOf(',') + 1), Base64.DEFAULT);
            Bitmap image = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            assertNotNull(image);
            assertEquals(256, image.getWidth());
            assertEquals(256, image.getHeight());
            // The platform's adaptive mask leaves the corners clear.
            assertEquals(0, Color.alpha(image.getPixel(0, 0)));
            int background = image.getPixel(8, 136);
            assertChannelHue(i, background);
            // A motion ribbon: Throw's foreground takes the channel's color too, so a preview
            // that paired the wrong foreground with this background fails here.
            for (int x : new int[] {104, 120}) {
                int ribbon = image.getPixel(x, 104);
                assertChannelHue(i, ribbon);
                assertTrue(String.format("ribbon #%06X on #%06X", ribbon & 0xFFFFFF, background & 0xFFFFFF),
                        brightness(ribbon) > brightness(background) + 100);
            }
            image.recycle();
        }
        for (String alias : ALIASES) {
            assertEquals(PackageManager.COMPONENT_ENABLED_STATE_DEFAULT, manager.getComponentEnabledSetting(component(alias)));
        }
    }
}
