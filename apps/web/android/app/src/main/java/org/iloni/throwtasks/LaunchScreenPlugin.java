package org.iloni.throwtasks;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Lets the page say when its first screen is drawn, so the launch screen can leave. */
@CapacitorPlugin(name = "LaunchScreen")
public class LaunchScreenPlugin extends Plugin {

    @PluginMethod
    public void ready(PluginCall call) {
        if (getActivity() instanceof MainActivity) ((MainActivity) getActivity()).onLaunchPageReady();
        call.resolve();
    }
}
