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
    };
  }
}
