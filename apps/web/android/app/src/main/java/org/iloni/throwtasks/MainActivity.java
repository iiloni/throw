package org.iloni.throwtasks;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HapticFeedbackPlugin.class);
        registerPlugin(KeyboardInsetsPlugin.class);
        super.onCreate(savedInstanceState);
        // Nested CSS scrollers own the page's scrollbars.
        getBridge().getWebView().setVerticalScrollBarEnabled(false);
        getBridge().getWebView().setHorizontalScrollBarEnabled(false);
    }
}
