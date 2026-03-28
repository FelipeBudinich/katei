export const GOOGLE_DISABLE_AUTOSELECT_STORAGE_KEY = 'katei.google.disableAutoSelect';
const DEFAULT_GIS_TIMEOUT_MS = 5000;
const DEFAULT_GIS_POLL_INTERVAL_MS = 50;

export function markDisableAutoSelectPending(storage = globalThis.sessionStorage) {
  try {
    storage?.setItem(GOOGLE_DISABLE_AUTOSELECT_STORAGE_KEY, '1');
  } catch (error) {
    // Ignore storage write failures and continue with sign-out.
  }
}

export function consumeDisableAutoSelectFlag(storage = globalThis.sessionStorage) {
  try {
    const value = storage?.getItem(GOOGLE_DISABLE_AUTOSELECT_STORAGE_KEY);

    if (!value) {
      return false;
    }

    storage.removeItem(GOOGLE_DISABLE_AUTOSELECT_STORAGE_KEY);
    return true;
  } catch (error) {
    return false;
  }
}

export function waitForGoogleIdentity({
  win = globalThis.window,
  doc = globalThis.document,
  timeoutMs = DEFAULT_GIS_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_GIS_POLL_INTERVAL_MS
} = {}) {
  if (win?.google?.accounts?.id) {
    return Promise.resolve(win.google);
  }

  const script = doc?.getElementById?.('google-identity-script');

  if (!script) {
    return Promise.reject(new Error('Google Identity Services script is missing.'));
  }

  return new Promise((resolve, reject) => {
    let intervalId = null;
    let timeoutId = null;
    let loadCheckId = null;
    let settled = false;

    const cleanup = () => {
      if (intervalId) {
        clearInterval(intervalId);
      }

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (loadCheckId) {
        clearTimeout(loadCheckId);
      }

      script.removeEventListener('load', handleLoad);
      script.removeEventListener('error', handleError);
    };

    const finish = (callback) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback();
    };

    const checkReady = () => {
      if (!win?.google?.accounts?.id) {
        return false;
      }

      finish(() => resolve(win.google));
      return true;
    };

    const handleLoad = () => {
      loadCheckId = setTimeout(() => {
        checkReady();
      }, 0);
    };

    const handleError = () => {
      finish(() => reject(new Error('Unable to load Google Identity Services.')));
    };

    script.addEventListener('load', handleLoad);
    script.addEventListener('error', handleError);

    intervalId = setInterval(() => {
      checkReady();
    }, pollIntervalMs);

    timeoutId = setTimeout(() => {
      if (checkReady()) {
        return;
      }

      finish(() => reject(new Error('Google Identity Services did not become ready before timing out.')));
    }, timeoutMs);

    checkReady();
  });
}
