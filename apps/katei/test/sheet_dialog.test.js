import test from 'node:test';
import assert from 'node:assert/strict';
import {
  closeSheetDialog,
  openSheetDialog
} from '../public/js/controllers/sheet_dialog.js';

test('openSheetDialog locks the page on first sheet open', () => {
  const environment = createSheetDialogEnvironment({
    scrollY: 180,
    innerWidth: 1440,
    clientWidth: 1425,
    computedPaddingRight: '12px'
  });
  const dialog = environment.createDialog();

  const handled = openSheetDialog(dialog, environment);

  assert.equal(handled, true);
  assert.equal(dialog.open, true);
  assert.equal(dialog.showModalCalls, 1);
  assert.equal(environment.documentRef.body.style.position, 'fixed');
  assert.equal(environment.documentRef.body.style.top, '-180px');
  assert.equal(environment.documentRef.body.style.left, '0');
  assert.equal(environment.documentRef.body.style.right, '0');
  assert.equal(environment.documentRef.body.style.width, '100%');
  assert.equal(environment.documentRef.body.style.paddingRight, '27px');
  assert.equal(environment.documentRef.documentElement.classList.contains('sheet-dialog-open'), true);
  assert.equal(environment.documentRef.body.classList.contains('sheet-dialog-open'), true);
  assert.deepEqual(environment.scrollToCalls, []);
});

test('opening nested sheet dialogs keeps the first scroll snapshot', () => {
  const environment = createSheetDialogEnvironment({
    scrollY: 200,
    innerWidth: 1366,
    clientWidth: 1351
  });
  const firstDialog = environment.createDialog();
  const secondDialog = environment.createDialog();

  openSheetDialog(firstDialog, environment);
  environment.windowRef.scrollY = 520;
  openSheetDialog(secondDialog, environment);

  assert.equal(environment.documentRef.body.style.top, '-200px');
  assert.equal(secondDialog.showModalCalls, 1);
  assert.deepEqual(environment.scrollToCalls, []);
});

test('closing one of multiple open sheet dialogs keeps the background locked', () => {
  const environment = createSheetDialogEnvironment({
    scrollY: 240,
    innerWidth: 1280,
    clientWidth: 1264
  });
  const firstDialog = environment.createDialog();
  const secondDialog = environment.createDialog();

  openSheetDialog(firstDialog, environment);
  openSheetDialog(secondDialog, environment);
  closeSheetDialog(firstDialog, environment);

  assert.equal(firstDialog.closeCalls, 1);
  assert.equal(secondDialog.open, true);
  assert.equal(environment.documentRef.body.style.position, 'fixed');
  assert.equal(environment.documentRef.documentElement.classList.contains('sheet-dialog-open'), true);
  assert.deepEqual(environment.scrollToCalls, []);
});

test('closing the last open sheet dialog restores inline body styles and scroll position', () => {
  const environment = createSheetDialogEnvironment({
    scrollY: 320,
    innerWidth: 1440,
    clientWidth: 1420,
    computedPaddingRight: '3px',
    bodyInlineStyles: {
      position: '',
      top: '',
      left: '',
      right: '',
      width: 'auto',
      paddingRight: '3px'
    }
  });
  const dialog = environment.createDialog();

  openSheetDialog(dialog, environment);
  closeSheetDialog(dialog, environment);

  assert.equal(dialog.closeCalls, 1);
  assert.equal(environment.documentRef.body.style.position, '');
  assert.equal(environment.documentRef.body.style.top, '');
  assert.equal(environment.documentRef.body.style.left, '');
  assert.equal(environment.documentRef.body.style.right, '');
  assert.equal(environment.documentRef.body.style.width, 'auto');
  assert.equal(environment.documentRef.body.style.paddingRight, '3px');
  assert.equal(environment.documentRef.documentElement.classList.contains('sheet-dialog-open'), false);
  assert.equal(environment.documentRef.body.classList.contains('sheet-dialog-open'), false);
  assert.deepEqual(environment.scrollToCalls, [[0, 320]]);
});

test('sheet dialog helpers ignore dialogs outside the shared sheet selector', () => {
  const environment = createSheetDialogEnvironment();
  const dialog = environment.createDialog({ isSheetDialog: false });

  const opened = openSheetDialog(dialog, environment);
  const closed = closeSheetDialog(dialog, environment);

  assert.equal(opened, false);
  assert.equal(closed, false);
  assert.equal(dialog.showModalCalls, 0);
  assert.equal(dialog.closeCalls, 0);
  assert.equal(environment.documentRef.documentElement.classList.contains('sheet-dialog-open'), false);
  assert.equal(environment.documentRef.body.classList.contains('sheet-dialog-open'), false);
});

function createSheetDialogEnvironment(
  {
    scrollY = 0,
    innerWidth = 1280,
    clientWidth = 1265,
    computedPaddingRight = '0px',
    bodyInlineStyles = {}
  } = {}
) {
  const dialogs = [];
  const scrollToCalls = [];
  const documentElement = {
    clientWidth,
    classList: createClassList()
  };
  const body = {
    style: {
      position: bodyInlineStyles.position ?? '',
      top: bodyInlineStyles.top ?? '',
      left: bodyInlineStyles.left ?? '',
      right: bodyInlineStyles.right ?? '',
      width: bodyInlineStyles.width ?? '',
      paddingRight: bodyInlineStyles.paddingRight ?? ''
    },
    classList: createClassList()
  };
  const documentRef = {
    body,
    documentElement,
    defaultView: null,
    querySelectorAll(selector) {
      if (selector !== 'dialog.sheet-dialog[open]') {
        return [];
      }

      return dialogs.filter((dialog) => dialog.open && dialog.matches('dialog.sheet-dialog'));
    }
  };
  const windowRef = {
    innerWidth,
    scrollY,
    getComputedStyle() {
      return {
        paddingRight: computedPaddingRight
      };
    },
    scrollTo(x, y) {
      scrollToCalls.push([x, y]);
    }
  };

  documentRef.defaultView = windowRef;

  return {
    documentRef,
    windowRef,
    scrollToCalls,
    createDialog({ isSheetDialog = true } = {}) {
      const listeners = new Map();
      const dialog = {
        ownerDocument: documentRef,
        open: false,
        showModalCalls: 0,
        closeCalls: 0,
        matches(selector) {
          return isSheetDialog && selector === 'dialog.sheet-dialog';
        },
        addEventListener(type, callback) {
          listeners.set(type, [...(listeners.get(type) ?? []), callback]);
        },
        showModal() {
          this.open = true;
          this.showModalCalls += 1;
        },
        close() {
          this.open = false;
          this.closeCalls += 1;

          for (const callback of listeners.get('close') ?? []) {
            callback();
          }
        }
      };

      dialogs.push(dialog);
      return dialog;
    }
  };
}

function createClassList() {
  const values = new Set();

  return {
    add(...classNames) {
      classNames.forEach((className) => values.add(className));
    },
    remove(...classNames) {
      classNames.forEach((className) => values.delete(className));
    },
    contains(className) {
      return values.has(className);
    }
  };
}
