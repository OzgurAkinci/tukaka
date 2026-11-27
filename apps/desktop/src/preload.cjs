
const { contextBridge, ipcRenderer } = require('electron');

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
  /** kind: 'sqlite' | 'sqlite-new' | 'ssh-key'; vazgeçilirse null döner. */
  selectFile: (kind) => ipcRenderer.invoke('tukaka:select-file', kind),
  /** Menüden pencere komutu (copy, reload, zoomIn, minimize, quit …). */
  windowCommand: (command) => ipcRenderer.invoke('tukaka:window-command', command),
  /** Başlık çubuğu düğmelerinin renklerini temaya uydurur. */
  setTheme: (theme) => ipcRenderer.send('tukaka:set-theme', theme),
});
