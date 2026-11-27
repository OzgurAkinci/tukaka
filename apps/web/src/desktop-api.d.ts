export {};

declare global {
  type DesktopWindowCommand =
    | 'undo'
    | 'redo'
    | 'cut'
    | 'copy'
    | 'paste'
    | 'selectAll'
    | 'reload'
    | 'toggleDevTools'
    | 'zoomIn'
    | 'zoomOut'
    | 'resetZoom'
    | 'toggleFullScreen'
    | 'minimize'
    | 'toggleMaximize'
    | 'close'
    | 'quit';

  /** Kökteki package.json sürümü (vite.config.ts `define`). */
  const __APP_VERSION__: string;

  interface Window {
    /**
     * Electron preload tarafından sağlanır; tarayıcıda çalışırken tanımsızdır.
     */
    desktopAPI?: {
      isDesktop: boolean;
      platform: string;
      sessionToken: string | null;
      /** Local service adresi (ör. http://127.0.0.1:53124); yoksa varsayılan kullanılır. */
      serviceUrl: string | null;
      /** Yerel dosya seçici; vazgeçilirse null. */
      selectFile?: (kind: 'sqlite' | 'sqlite-new' | 'ssh-key') => Promise<string | null>;
      /** Başlık çubuğu menüsünden pencere komutu. */
      windowCommand?: (command: DesktopWindowCommand) => Promise<void>;
      /** Pencere düğmelerinin (küçült/büyüt/kapat) renklerini temaya uydurur. */
      setTheme?: (theme: 'dark' | 'light') => void;
    };
  }
}
