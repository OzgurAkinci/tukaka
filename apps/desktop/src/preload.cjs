
const { contextBridge } = require('electron');

const TOKEN_ARG_PREFIX = '--tukaka-session-token=';

const sessionToken =
  process.argv
    .find((arg) => arg.startsWith(TOKEN_ARG_PREFIX))
    ?.slice(TOKEN_ARG_PREFIX.length) ?? null;

contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktop: true,
  platform: process.platform,
  sessionToken,
});
