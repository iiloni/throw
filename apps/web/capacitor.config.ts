import type { CapacitorConfig } from '@capacitor/cli';
import { buildChannel } from '../../scripts/build-channel.ts';
import { developmentServerUrl } from '../../scripts/dev-server.ts';

const channel = buildChannel(process.env.THROW_CHANNEL);
const devServer = developmentServerUrl(channel, process.env.THROW_DEV_SERVER_URL);
const httpDevServer = devServer.startsWith('http:');

const config: CapacitorConfig = {
  appId: 'org.iloni.throwtasks',
  appName: 'Throw',
  webDir: 'dist',
  android: { flavor: channel, allowMixedContent: httpDevServer },
  // The frontend stays bundled; only API requests go to the HTTP worktree server.
  server: { cleartext: httpDevServer },
  plugins: {
    // KeyboardInsets owns both the system bars and keyboard without resizing the WebView.
    SystemBars: { insetsHandling: 'disable' },
  },
};

export default config;
