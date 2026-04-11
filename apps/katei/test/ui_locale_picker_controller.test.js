import test from 'node:test';
import assert from 'node:assert/strict';
import UiLocalePickerController from '../public/js/controllers/ui_locale_picker_controller.js';

test('dialog variant opens a modal and focuses the selected option', async () => {
  const controller = createDialogControllerDouble();

  await withImmediateAnimationFrame(async () => {
    UiLocalePickerController.prototype.openDialog.call(controller, {
      preventDefault() {}
    });
  });

  assert.equal(controller.dialogTarget.open, true);
  assert.equal(controller.dialogTarget.showModalCalls, 1);
  assert.equal(controller.triggerTarget.attributes['aria-expanded'], 'true');
  assert.equal(controller.optionTargets[1].focusCalls, 1);
});

test('dialog variant closeDialog closes explicitly and restores focus', () => {
  const controller = createDialogControllerDouble();
  controller.dialogTarget.open = true;

  UiLocalePickerController.prototype.closeDialog.call(controller, {
    preventDefault() {}
  });

  assert.equal(controller.dialogTarget.open, false);
  assert.equal(controller.dialogTarget.closeCalls, 1);
  assert.equal(controller.triggerTarget.attributes['aria-expanded'], 'false');
  assert.equal(controller.triggerTarget.focusCalls, 1);
});

test('dialog variant Escape does not close the dialog', () => {
  const controller = createDialogControllerDouble();
  controller.dialogTarget.open = true;
  let prevented = false;

  UiLocalePickerController.prototype.handleMenuKeydown.call(controller, {
    key: 'Escape',
    target: controller.optionTargets[1],
    preventDefault() {
      prevented = true;
    }
  });

  assert.equal(prevented, true);
  assert.equal(controller.dialogTarget.open, true);
  assert.equal(controller.dialogTarget.closeCalls, 0);
  assert.equal(controller.triggerTarget.attributes['aria-expanded'], 'false');
});

test('dialog variant selectLocale updates the hidden select, closes the dialog, and submits the form', () => {
  const controller = createDialogControllerDouble();
  controller.dialogTarget.open = true;

  UiLocalePickerController.prototype.selectLocale.call(controller, {
    preventDefault() {},
    currentTarget: controller.optionTargets[2]
  });

  assert.equal(controller.selectTarget.value, 'ja');
  assert.equal(controller.optionTargets[0].attributes['aria-checked'], 'false');
  assert.equal(controller.optionTargets[1].attributes['aria-checked'], 'false');
  assert.equal(controller.optionTargets[2].attributes['aria-checked'], 'true');
  assert.equal(controller.dialogTarget.open, false);
  assert.equal(controller.requestSubmitCalls, 1);
});

test('dropdown variant handleWindowClick closes an open menu when clicking outside', () => {
  const controller = createDropdownControllerDouble();
  controller.menuTarget.hidden = false;

  UiLocalePickerController.prototype.handleWindowClick.call(controller, {
    target: { id: 'outside' }
  });

  assert.equal(controller.menuTarget.hidden, true);
  assert.equal(controller.triggerTarget.attributes['aria-expanded'], 'false');
});

test('dropdown variant trigger keyboard opens the inline menu and focuses the selected option', () => {
  const controller = createDropdownControllerDouble();
  let prevented = false;

  UiLocalePickerController.prototype.handleTriggerKeydown.call(controller, {
    key: 'ArrowDown',
    preventDefault() {
      prevented = true;
    }
  });

  assert.equal(prevented, true);
  assert.equal(controller.menuTarget.hidden, false);
  assert.equal(controller.triggerTarget.attributes['aria-expanded'], 'true');
  assert.equal(controller.optionTargets[0].focusCalls, 1);
});

function createDialogControllerDouble() {
  const controller = Object.create(UiLocalePickerController.prototype);

  controller.hasTriggerTarget = true;
  controller.hasDialogTarget = true;
  controller.hasMenuTarget = true;
  controller.hasOptionTarget = true;
  controller.hasSelectTarget = true;
  controller.triggerTarget = createTriggerTarget();
  controller.dialogTarget = createDialogTarget();
  controller.menuTarget = { hidden: false };
  controller.optionTargets = [
    createOptionTarget('en', false),
    createOptionTarget('es-CL', true),
    createOptionTarget('ja', false)
  ];
  controller.selectTarget = { value: 'es-CL' };
  controller.requestSubmitCalls = 0;
  Object.defineProperty(controller, 'element', {
    configurable: true,
    value: {
      requestSubmit() {
        controller.requestSubmitCalls += 1;
      },
      submit() {
        controller.submitCalls = (controller.submitCalls ?? 0) + 1;
      },
      contains() {
        return false;
      }
    }
  });

  return controller;
}

function createDropdownControllerDouble() {
  const controller = Object.create(UiLocalePickerController.prototype);

  controller.hasTriggerTarget = true;
  controller.hasDialogTarget = false;
  controller.hasMenuTarget = true;
  controller.hasOptionTarget = true;
  controller.hasSelectTarget = true;
  controller.triggerTarget = createTriggerTarget();
  controller.menuTarget = { hidden: true };
  controller.optionTargets = [
    createOptionTarget('en', true),
    createOptionTarget('es-CL', false),
    createOptionTarget('ja', false)
  ];
  controller.selectTarget = { value: 'en' };
  Object.defineProperty(controller, 'element', {
    configurable: true,
    value: {
      contains() {
        return false;
      },
      requestSubmit() {},
      submit() {}
    }
  });

  return controller;
}

function createTriggerTarget() {
  return {
    disabled: false,
    focusCalls: 0,
    attributes: {
      'aria-expanded': 'false'
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    focus() {
      this.focusCalls += 1;
    }
  };
}

function createDialogTarget() {
  return {
    open: false,
    showModalCalls: 0,
    closeCalls: 0,
    matches(selector) {
      return selector === 'dialog.sheet-dialog';
    },
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

function createOptionTarget(locale, selected) {
  return {
    dataset: { locale },
    focusCalls: 0,
    attributes: {
      'aria-checked': selected ? 'true' : 'false'
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    getAttribute(name) {
      return this.attributes[name];
    },
    focus() {
      this.focusCalls += 1;
    }
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
