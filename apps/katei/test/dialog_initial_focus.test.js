import test from 'node:test';
import assert from 'node:assert/strict';
import {
  focusDialogTarget,
  openDialogWithInitialFocus
} from '../public/js/controllers/dialog_initial_focus.js';

test('openDialogWithInitialFocus shows the dialog and focuses the target immediately when possible', () => {
  const documentRef = {
    activeElement: null
  };
  const dialog = createDialogDouble();
  const target = createFocusableTarget(documentRef);

  openDialogWithInitialFocus(dialog, target, {
    documentRef
  });

  assert.equal(dialog.showModalCalls, 1);
  assert.equal(dialog.open, true);
  assert.equal(target.focusCalls, 1);
  assert.equal(documentRef.activeElement, target);
});

test('focusDialogTarget retries through microtask and timeout when focus does not stick immediately', () => {
  const documentRef = {
    activeElement: null
  };
  const dialog = createDialogDouble({ open: true });
  const microtasks = [];
  const timeouts = [];
  const target = createFocusableTarget(documentRef, {
    activateOnCall: 3
  });

  focusDialogTarget(dialog, target, {
    documentRef,
    queueMicrotaskImpl(callback) {
      microtasks.push(callback);
    },
    setTimeoutImpl(callback, delayMs) {
      timeouts.push({ callback, delayMs });
    }
  });

  assert.equal(target.focusCalls, 1);
  assert.equal(microtasks.length, 1);
  assert.equal(timeouts.length, 0);

  microtasks[0]();

  assert.equal(target.focusCalls, 2);
  assert.equal(timeouts.length, 1);
  assert.equal(timeouts[0].delayMs, 0);

  timeouts[0].callback();

  assert.equal(target.focusCalls, 3);
  assert.equal(documentRef.activeElement, target);
});

test('focusDialogTarget stops retrying after the dialog closes', () => {
  const documentRef = {
    activeElement: null
  };
  const dialog = createDialogDouble({ open: true });
  const microtasks = [];
  const timeouts = [];
  const target = createFocusableTarget(documentRef, {
    activateOnCall: Infinity
  });

  focusDialogTarget(dialog, target, {
    documentRef,
    queueMicrotaskImpl(callback) {
      microtasks.push(callback);
    },
    setTimeoutImpl(callback, delayMs) {
      timeouts.push({ callback, delayMs });
    }
  });

  dialog.open = false;
  microtasks[0]();

  assert.equal(target.focusCalls, 1);
  assert.equal(timeouts.length, 0);
});

test('focusDialogTarget stops retrying when the target disconnects before timeout retry', () => {
  const documentRef = {
    activeElement: null
  };
  const dialog = createDialogDouble({ open: true });
  const microtasks = [];
  const timeouts = [];
  const target = createFocusableTarget(documentRef, {
    activateOnCall: Infinity
  });

  focusDialogTarget(dialog, target, {
    documentRef,
    queueMicrotaskImpl(callback) {
      microtasks.push(callback);
    },
    setTimeoutImpl(callback, delayMs) {
      timeouts.push({ callback, delayMs });
    }
  });

  microtasks[0]();
  target.isConnected = false;
  timeouts[0].callback();

  assert.equal(target.focusCalls, 2);
  assert.equal(documentRef.activeElement, null);
});

function createDialogDouble({ open = false } = {}) {
  return {
    open,
    showModalCalls: 0,
    matches(selector) {
      return selector === 'dialog.sheet-dialog';
    },
    showModal() {
      this.open = true;
      this.showModalCalls += 1;
    }
  };
}

function createFocusableTarget(documentRef, { activateOnCall = 1 } = {}) {
  return {
    focusCalls: 0,
    isConnected: true,
    focus() {
      this.focusCalls += 1;

      if (this.focusCalls >= activateOnCall) {
        documentRef.activeElement = this;
      }
    }
  };
}
