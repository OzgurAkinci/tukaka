export {};

declare global {
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
    };
  }
}
