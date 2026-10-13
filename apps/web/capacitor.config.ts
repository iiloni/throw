import type { CapacitorConfig } from '@capacitor/cli';
import { buildChannel } from '../../scripts/build-channel.ts';
import { developmentServerUrl } from '../../scripts/dev-server.ts';

const channel = buildChannel(process.env.THROW_CHANNEL);
const devServer = developmentServerUrl(channel, process.env.THROW_DEV_SERVER_URL);
const httpDevServer = devServer.startsWith('http:');

// The Android project has not been generated yet (`cap add android`). `throw` is a Java
// keyword, so the application id cannot be `org.iloni.throw`.
const config: CapacitorConfig = {
  appId: 'org.iloni.throwtasks',
  appName: 'Throw',
  webDir: 'dist',
  android: { allowMixedContent: httpDevServer },
  // The frontend stays bundled; only API requests go to the HTTP worktree server.
  server: { cleartext: httpDevServer },
};

export default config;
