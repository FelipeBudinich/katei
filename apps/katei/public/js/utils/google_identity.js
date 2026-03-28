export const GOOGLE_DISABLE_AUTOSELECT_STORAGE_KEY = 'katei.google.disableAutoSelect';

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
