import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createTranslator } from '../public/js/i18n/translate.js';

const SessionController = await loadSessionController();

test('session controller opens the logout confirmation dialog and focuses the confirm button', async () => {
  const controller = createSessionControllerDouble();
  let prevented = false;

  await withImmediateAnimationFrame(async () => {
    SessionController.prototype.openLogoutConfirm.call(controller, {
      preventDefault() {
        prevented = true;
      }
    });
  });

  assert.equal(prevented, true);
  assert.equal(controller.confirmDialogTarget.open, true);
  assert.equal(controller.confirmDialogTarget.showModalCalls, 1);
  assert.equal(controller.confirmTitleTarget.textContent, 'Log out?');
  assert.equal(controller.confirmMessageTarget.textContent, 'You will be signed out of Katei on this device.');
  assert.equal(controller.confirmButtonTarget.focusCalls, 1);
});

test('session controller closeConfirmDialog restores focus to the logout button', () => {
  const controller = createSessionControllerDouble();
  let prevented = false;

  controller.confirmDialogTarget.open = true;

  SessionController.prototype.closeConfirmDialog.call(controller, {
    preventDefault() {
      prevented = true;
    }
  });

  assert.equal(prevented, true);
  assert.equal(controller.confirmDialogTarget.open, false);
  assert.equal(controller.confirmDialogTarget.closeCalls, 1);
  assert.equal(controller.logoutButtonTarget.focusCalls, 1);
});

test('session controller confirmLogout only performs the request after explicit confirmation', async () => {
  const controller = createSessionControllerDouble();
  let prevented = false;
  let performLogoutCalls = 0;

  controller.performLogout = async () => {
    performLogoutCalls += 1;
    return true;
  };
  controller.confirmDialogTarget.open = true;

  await SessionController.prototype.confirmLogout.call(controller, {
    preventDefault() {
      prevented = true;
    }
  });

  assert.equal(prevented, true);
  assert.equal(performLogoutCalls, 1);
  assert.equal(controller.confirmButtonTarget.disabled, true);
  assert.equal(controller.confirmDialogTarget.open, false);
  assert.equal(controller.confirmDialogTarget.closeCalls, 1);
});

test('session controller performLogout reports failures without redirecting and restores submit state', async () => {
  const controller = createSessionControllerDouble();
  const fetchCalls = [];
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const redirectedTo = [];

  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return {
      ok: false,
      async json() {
        return {
          error: 'Nope'
        };
      }
    };
  };
  globalThis.window = {
    location: {
      assign(url) {
        redirectedTo.push(url);
      }
    }
  };

  try {
    const success = await SessionController.prototype.performLogout.call(controller);

    assert.equal(success, false);
    assert.equal(controller.isSubmitting, false);
    assert.equal(controller.statusTarget.textContent, 'Nope');
    assert.deepEqual(redirectedTo, []);
    assert.deepEqual(fetchCalls, [
      {
        url: '/auth/logout',
        options: {
          method: 'POST',
          headers: {
            Accept: 'application/json'
          },
          credentials: 'same-origin'
        }
      }
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});

function createSessionControllerDouble() {
  const controller = Object.create(SessionController.prototype);

  controller.t = createTranslator('en');
  controller.isSubmitting = false;
  controller.authUrlValue = '/auth/logout';
  controller.redirectUrlValue = '/';
  controller.statusTarget = createTextTarget();
  controller.logoutButtonTarget = createFocusableElement();
  controller.confirmDialogTarget = createDialogTarget();
  controller.confirmTitleTarget = createTextTarget();
  controller.confirmMessageTarget = createTextTarget();
  controller.confirmButtonTarget = createFocusableElement();
  controller.hasConfirmDialogTarget = true;
  controller.hasConfirmTitleTarget = true;
  controller.hasConfirmMessageTarget = true;
  controller.hasConfirmButtonTarget = true;

  return controller;
}

function createDialogTarget() {
  return {
    open: false,
    showModalCalls: 0,
    closeCalls: 0,
    showModal() {
      this.open = true;
      this.showModalCalls += 1;
    },
    close() {
      this.open = false;
      this.closeCalls += 1;
    }
  };
}

function createFocusableElement() {
  return {
    disabled: false,
    focusCalls: 0,
    isConnected: true,
    closest() {
      return null;
    },
    focus() {
      this.focusCalls += 1;
    }
  };
}

function createTextTarget() {
  return {
    textContent: ''
  };
}

async function withImmediateAnimationFrame(callback) {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;

  globalThis.requestAnimationFrame = (fn) => {
    fn();
    return 1;
  };

  try {
    return await callback();
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  }
}

async function loadSessionController() {
  const controllerPath = '/Users/felipebudinich/Documents/katei/apps/katei/public/js/controllers/session_controller.js';
  const stimulusUrl = pathToFileURL(
    '/Users/felipebudinich/Documents/katei/apps/katei/public/vendor/stimulus/stimulus.js'
  ).href;
  const browserUrl = pathToFileURL(
    '/Users/felipebudinich/Documents/katei/apps/katei/public/js/i18n/browser.js'
  ).href;
  const errorsUrl = pathToFileURL(
    '/Users/felipebudinich/Documents/katei/apps/katei/public/js/i18n/errors.js'
  ).href;
  const googleIdentityUrl = pathToFileURL(
    '/Users/felipebudinich/Documents/katei/apps/katei/public/js/utils/google_identity.js'
  ).href;
  const source = await readFile(controllerPath, 'utf8');
  const patchedSource = source
    .replace("'../../vendor/stimulus/stimulus.js'", `'${stimulusUrl}'`)
    .replace("'/js/i18n/browser.js'", `'${browserUrl}'`)
    .replace("'/js/i18n/errors.js'", `'${errorsUrl}'`)
    .replace("'/js/utils/google_identity.js'", `'${googleIdentityUrl}'`);
  const moduleUrl = `data:text/javascript,${encodeURIComponent(patchedSource)}`;
  const module = await import(moduleUrl);

  return module.default;
}
