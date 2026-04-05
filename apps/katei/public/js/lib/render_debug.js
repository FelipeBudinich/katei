function getPerformanceNow() {
  if (typeof globalThis?.performance?.now === 'function') {
    return globalThis.performance.now();
  }

  return Date.now();
}

export function startRenderDebugTimer(type, payload = {}) {
  const startedAt = getPerformanceNow();

  recordRenderDebugEvent(`${type}:start`, payload);

  return (extraPayload = {}) => {
    recordRenderDebugEvent(`${type}:end`, {
      ...payload,
      ...extraPayload,
      durationMs: getPerformanceNow() - startedAt
    });
  };
}

export function recordRenderDebugEvent(type, payload = {}) {
  const debugState = globalThis?.__KATEI_RENDER_DEBUG__;

  if (!debugState || typeof debugState !== 'object') {
    return;
  }

  const event = {
    type,
    ...payload
  };

  if (typeof debugState.record === 'function') {
    debugState.record(event);
    return;
  }

  if (Array.isArray(debugState.events)) {
    debugState.events.push(event);
  }
}
