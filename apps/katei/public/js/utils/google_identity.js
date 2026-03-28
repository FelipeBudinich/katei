export const GOOGLE_DISABLE_AUTOSELECT_STORAGE_KEY = 'katei.google.disableAutoSelect';
export const MISSING_GOOGLE_CLIENT_ID_ERROR_CODE = 'missing-google-client-id';
export const EMPTY_GOOGLE_BUTTON_SLOT_ERROR_CODE = 'empty-google-button-slot-after-render';
const DEFAULT_GIS_TIMEOUT_MS = 5000;
const DEFAULT_GIS_POLL_INTERVAL_MS = 50;
const GOOGLE_SIGNIN_BUTTON_OPTIONS = Object.freeze({
  type: 'standard',
  theme: 'outline',
  size: 'large',
  text: 'signin_with',
  shape: 'pill',
  width: 280,
  logo_alignment: 'left'
});

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

export function assertValidGoogleClientId(clientId) {
  if (typeof clientId !== 'string' || !clientId.trim()) {
    throw createGoogleIdentityError('Google client ID is missing.', MISSING_GOOGLE_CLIENT_ID_ERROR_CODE);
  }

  return clientId.trim();
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

export function initializeGoogleIdentityClient(googleIdentity, { clientId, callback }) {
  googleIdentity.accounts.id.initialize({
    client_id: clientId,
    callback
  });
}

export async function renderGoogleIdentityButton(
  googleIdentity,
  buttonTarget,
  { requestAnimationFrameImpl = globalThis.requestAnimationFrame } = {}
) {
  googleIdentity.accounts.id.renderButton(buttonTarget, GOOGLE_SIGNIN_BUTTON_OPTIONS);
  await waitForNextRender(requestAnimationFrameImpl);

  if (!hasRenderedButtonContent(buttonTarget)) {
    throw createGoogleIdentityError(
      'Google sign-in button was not rendered. Check the allowed JavaScript origins for this client ID.',
      EMPTY_GOOGLE_BUTTON_SLOT_ERROR_CODE
    );
  }
}

function waitForNextRender(requestAnimationFrameImpl) {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrameImpl === 'function') {
      requestAnimationFrameImpl(() => resolve());
      return;
    }

    Promise.resolve().then(resolve);
  });
}

function hasRenderedButtonContent(buttonTarget) {
  if (!buttonTarget) {
    return false;
  }

  const hasChildNodes =
    typeof buttonTarget.hasChildNodes === 'function'
      ? buttonTarget.hasChildNodes()
      : Array.isArray(buttonTarget.childNodes)
        ? buttonTarget.childNodes.length > 0
        : Number(buttonTarget.childNodes?.length) > 0;
  const textContent = typeof buttonTarget.textContent === 'string' ? buttonTarget.textContent.trim() : '';

  return Boolean(hasChildNodes || textContent);
}

function createGoogleIdentityError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
