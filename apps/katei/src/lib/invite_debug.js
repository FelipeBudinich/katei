const TRUTHY_FLAG_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function createInviteDebugLogger({
  request = null,
  enabled = shouldDebugInvites(request),
  sink = console.info.bind(console)
} = {}) {
  if (!enabled || typeof sink !== 'function') {
    return () => {};
  }

  return function logInviteDebug(event, fields = {}) {
    sink('[invite-debug]', event, normalizeDebugFields(fields));
  };
}

export function shouldDebugInvites(request) {
  return Boolean(
    isTruthyFlag(request?.get?.('x-katei-debug-invites'))
      || isTruthyFlag(request?.headers?.['x-katei-debug-invites'])
      || isTruthyFlag(request?.query?.debugInvites)
      || isTruthyFlag(request?.body?.debugInvites)
  );
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

function normalizeDebugFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return fields;
  }

  return fields;
}
