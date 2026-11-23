
const { contextBridge } = require('electron');

function readArgument(name) {
  const prefix = `--${name}=`;
  const value = process.argv
    .find((arg) => arg.startsWith(prefix))
    ?.slice(prefix.length);

  return value && value !== 'null' ? value : null;
}

contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktop: true,
  platform: process.platform,
  sessionToken: readArgument('tukaka-session-token'),
  serviceUrl: readArgument('tukaka-service-url'),
});
