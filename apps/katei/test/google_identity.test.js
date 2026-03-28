import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForGoogleIdentity } from '../public/js/utils/google_identity.js';

test('waitForGoogleIdentity returns immediately when GIS is already ready', async () => {
  const win = {
    google: {
      accounts: {
        id: {}
      }
    }
  };

  const result = await waitForGoogleIdentity({
    win,
    doc: {
      getElementById() {
        throw new Error('script lookup should not run when GIS is already ready');
      }
    }
  });

  assert.equal(result, win.google);
});

test('waitForGoogleIdentity resolves when the script exists and GIS becomes ready shortly after load', async () => {
  const win = {};
  const script = createFakeScript();
  const waitPromise = waitForGoogleIdentity({
    win,
    doc: {
      getElementById(id) {
        return id === 'google-identity-script' ? script : null;
      }
    },
    timeoutMs: 100,
    pollIntervalMs: 5
  });

  setTimeout(() => {
    script.dispatch('load');
  }, 5);

  setTimeout(() => {
    win.google = {
      accounts: {
        id: {}
      }
    };
  }, 15);

  const result = await waitPromise;

  assert.equal(result, win.google);
  assert.equal(script.listenerCount('load'), 0);
  assert.equal(script.listenerCount('error'), 0);
});

test('waitForGoogleIdentity rejects when the GIS script tag is missing', async () => {
  await assert.rejects(
    waitForGoogleIdentity({
      win: {},
      doc: {
        getElementById() {
          return null;
        }
      },
      timeoutMs: 20,
      pollIntervalMs: 5
    }),
    /Google Identity Services script is missing\./
  );
});

test('waitForGoogleIdentity rejects when GIS never becomes ready before the timeout', async () => {
  const script = createFakeScript();

  await assert.rejects(
    waitForGoogleIdentity({
      win: {},
      doc: {
        getElementById(id) {
          return id === 'google-identity-script' ? script : null;
        }
      },
      timeoutMs: 20,
      pollIntervalMs: 5
    }),
    /Google Identity Services did not become ready before timing out\./
  );

  assert.equal(script.listenerCount('load'), 0);
  assert.equal(script.listenerCount('error'), 0);
});

function createFakeScript() {
  const listeners = new Map();

  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }

      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type) {
      for (const listener of listeners.get(type) ?? []) {
        listener();
      }
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    }
  };
}
