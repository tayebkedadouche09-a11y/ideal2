/**
 * Native runtime adapter. Wires Capacitor plugins when the app runs inside a
 * native shell (Android/iOS/desktop via Capacitor) and is a no-op in a plain
 * browser. All native behaviour is guarded so the same bundle runs unchanged
 * on the web — the offline outbox, capture and notification code paths rely on
 * standard web APIs that the Capacitor webview already provides.
 */
import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();

/**
 * Initialise native integrations. Safe to call on the web (does nothing).
 * Returns a disposer that removes any listeners it registered.
 */
export async function initNative(): Promise<() => void> {
  if (!isNative) return () => {};
  const disposers: Array<() => void> = [];

  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch { /* plugin unavailable on this platform */ }

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Light });
  } catch { /* not available (e.g. Android < 23) */ }

  try {
    const { App } = await import('@capacitor/app');
    const sub = await App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) window.history.back();
      else void App.exitApp();
    });
    disposers.push(() => sub.remove());
  } catch { /* hardware back only exists on Android */ }

  try {
    const { Network } = await import('@capacitor/network');
    const sub = await Network.addListener('networkStatusChange', ({ connected }) => {
      // Mirror the native connectivity state onto the web online/offline events
      // so the existing outbox auto-sync (which listens to these) keeps working.
      window.dispatchEvent(new Event(connected ? 'online' : 'offline'));
    });
    disposers.push(() => sub.remove());
  } catch { /* web already fires online/offline natively */ }

  return () => {
    for (const d of disposers) {
      try { d(); } catch { /* ignore */ }
    }
  };
}
