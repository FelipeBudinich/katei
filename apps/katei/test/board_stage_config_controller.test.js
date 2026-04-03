import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator } from '../public/js/i18n/translate.js';
import { createEmptyWorkspace } from '../public/js/domain/workspace_read_model.js';
import BoardStageConfigController from '../public/js/controllers/board_stage_config_controller.js';

test('board stage config opens from the workspace event and populates the textarea draft', async () => {
  const controller = createBoardStageConfigControllerDouble();
  const board = createEmptyWorkspace().boards.main;
  const triggerElement = createFocusableElement();
  const stageDefinitions = ['backlog | Backlog | review | card.create', 'review | Review | backlog'].join('\n');

  await withImmediateAnimationFrame(() => {
    BoardStageConfigController.prototype.openFromEvent.call(controller, {
      detail: {
        stageDefinitions,
        currentBoard: board,
        triggerElement
      }
    });
  });

  assert.equal(controller.dialogTarget.open, true);
  assert.equal(controller.definitionsInputTarget.value, stageDefinitions);
  assert.equal(controller.currentBoard, board);
  assert.equal(controller.restoreFocusElement, triggerElement);
  assert.equal(controller.definitionsInputTarget.focused, true);
  assert.equal(controller.errorTarget.hidden, true);
});

test('board stage config apply shows a localized error for invalid input and does not dispatch apply', async () => {
  const controller = createBoardStageConfigControllerDouble();
  const dispatchedEvents = [];
  let prevented = false;

  controller.dialogTarget.open = true;
  controller.definitionsInputTarget.value = 'backlog';

  await withWindowDispatchCapture(dispatchedEvents, () => {
    BoardStageConfigController.prototype.apply.call(controller, {
      preventDefault() {
        prevented = true;
      }
    });
  });

  assert.equal(prevented, true);
  assert.equal(controller.dialogTarget.open, true);
  assert.equal(controller.errorTarget.hidden, false);
  assert.equal(
    controller.errorTarget.textContent,
    'Each stage must use "stage-id | Title", "stage-id | Title | target-a, target-b", or "stage-id | Title | target-a, target-b | action-a, action-b".'
  );
  assert.deepEqual(dispatchedEvents, []);
});

test('board stage config apply enforces existing-board stage compatibility before dispatching', () => {
  const controller = createBoardStageConfigControllerDouble();
  const workspace = createEmptyWorkspace();
  const board = workspace.boards.main;

  board.cards.card_1 = {
    id: 'card_1',
    priority: 'important',
    createdAt: '2026-03-31T09:00:00.000Z',
    updatedAt: '2026-03-31T09:00:00.000Z',
    contentByLocale: {
      en: {
        title: 'English title',
        detailsMarkdown: '',
        provenance: null
      }
    }
  };
  board.stages.backlog.cardIds.push('card_1');

  controller.currentBoard = board;
  controller.dialogTarget.open = true;
  controller.definitionsInputTarget.value = 'doing | Doing';

  BoardStageConfigController.prototype.apply.call(controller, {
    preventDefault() {}
  });

  assert.equal(controller.dialogTarget.open, true);
  assert.equal(controller.errorTarget.hidden, false);
  assert.equal(controller.errorTarget.textContent, 'Move cards out of a stage before removing it.');
});

test('board stage config apply dispatches board-stage-config:apply on window for valid input', async () => {
  const controller = createBoardStageConfigControllerDouble();
  const dispatchedEvents = [];
  const stageDefinitions = ['backlog | Backlog | review | card.create', 'review | Review | backlog'].join('\n');

  controller.dialogTarget.open = true;
  controller.currentBoard = createEmptyWorkspace().boards.main;
  controller.restoreFocusElement = createFocusableElement();
  controller.definitionsInputTarget.value = stageDefinitions;

  await withWindowDispatchCapture(dispatchedEvents, () => {
    BoardStageConfigController.prototype.apply.call(controller, {
      preventDefault() {}
    });
  });

  assert.equal(controller.dialogTarget.open, false);
  assert.equal(controller.errorTarget.hidden, true);
  assert.equal(dispatchedEvents.length, 1);
  assert.equal(dispatchedEvents[0].type, 'board-stage-config:apply');
  assert.deepEqual(dispatchedEvents[0].detail, { stageDefinitions });
  assert.equal(controller.restoreFocusElement, null);
});

test('board stage config close, cancel, and backdrop paths restore focus predictably', () => {
  const controller = createBoardStageConfigControllerDouble();
  const triggerElement = createFocusableElement();
  let prevented = false;

  controller.dialogTarget.open = true;
  controller.restoreFocusElement = triggerElement;

  BoardStageConfigController.prototype.backdropClose.call(controller, {
    target: controller.dialogTarget
  });

  assert.equal(controller.dialogTarget.open, false);
  assert.equal(triggerElement.focused, true);

  triggerElement.focused = false;
  controller.dialogTarget.open = true;
  controller.restoreFocusElement = triggerElement;

  BoardStageConfigController.prototype.close.call(controller, {
    preventDefault() {
      prevented = true;
    }
  });

  assert.equal(prevented, true);
  assert.equal(controller.dialogTarget.open, false);
  assert.equal(triggerElement.focused, true);
});

function createBoardStageConfigControllerDouble() {
  const controller = Object.create(BoardStageConfigController.prototype);

  controller.t = createTranslator('en');
  controller.currentBoard = null;
  controller.restoreFocusElement = null;
  controller.dialogTarget = createDialogTarget();
  controller.definitionsInputTarget = createFocusableValueTarget('');
  controller.errorTarget = createTextTarget({ hidden: true });
  controller.hasErrorTarget = true;

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

function createFocusableValueTarget(value = '') {
  return {
    value,
    focused: false,
    focus() {
      this.focused = true;
    }
  };
}

function createTextTarget({ hidden = false } = {}) {
  return {
    hidden,
    textContent: ''
  };
}

function createFocusableElement() {
  return {
    focused: false,
    isConnected: true,
    focus() {
      this.focused = true;
    }
  };
}

async function withImmediateAnimationFrame(callback) {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (frameCallback) => frameCallback();

  try {
    return await callback();
  } finally {
    if (typeof originalRequestAnimationFrame === 'function') {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    } else {
      delete globalThis.requestAnimationFrame;
    }
  }
}

async function withWindowDispatchCapture(dispatchedEvents, callback) {
  const originalWindow = globalThis.window;

  globalThis.window = {
    dispatchEvent(event) {
      dispatchedEvents.push(event);
      return true;
    }
  };

  try {
    return await callback();
  } finally {
    if (typeof originalWindow === 'undefined') {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
}
