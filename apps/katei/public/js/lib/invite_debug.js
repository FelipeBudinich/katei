export const INVITE_DEBUG_STORAGE_KEY = 'katei.debug.invites';

const TRUTHY_FLAG_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function logInviteDebug(event, fields = {}, { win = globalThis.window, storage = globalThis.localStorage } = {}) {
  if (!isInviteDebugEnabled({ win, storage })) {
    return;
  }

  console.info('[invite-debug]', event, fields);
}

export function isInviteDebugEnabled({ win = globalThis.window, storage = globalThis.localStorage } = {}) {
  if (win?.__KATEI_DEBUG_INVITES__ === true) {
    return true;
  }

  const debugParameter = readSearchParameter(win?.location?.search ?? '', 'debugInvites');

  if (isTruthyFlag(debugParameter)) {
    return true;
  }

  try {
    return isTruthyFlag(storage?.getItem?.(INVITE_DEBUG_STORAGE_KEY));
  } catch (error) {
    return false;
  }
}

function isTruthyFlag(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => isTruthyFlag(entry));
  }

  if (typeof value !== 'string') {
    return false;
  }

  return TRUTHY_FLAG_VALUES.has(value.trim().toLowerCase());
}

function readSearchParameter(search, parameterName) {
  if (typeof search !== 'string' || !search.trim()) {
    return null;
  }

  try {
    return new URLSearchParams(search).get(parameterName);
  } catch (error) {
    return null;
  }
}
