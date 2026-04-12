import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator } from '../public/js/i18n/translate.js';
import { createEmptyWorkspace } from '../public/js/domain/workspace_read_model.js';
import BoardStageConfigController from '../public/js/controllers/board_stage_config_controller.js';

test('board stage config opens from the workspace event and populates both stage draft fields', async () => {
  const controller = createBoardStageConfigControllerDouble();
  const board = createEmptyWorkspace().boards.main;
  const triggerElement = createFocusableElement();
  const stageDefinitions = ['backlog | Backlog | review | card.create', 'review | Review | backlog | card.review'].join('\n');
  const stagePromptActions = JSON.stringify(
    {
      backlog: {
        enabled: true,
        prompt: 'Turn this card into a review task.',
        targetStageId: 'review'
      }
    },
    null,
    2
  );
  const stageReviewPolicies = JSON.stringify(
    {
      review: {
        approverRole: 'admin'
      }
    },
    null,
    2
  );

  await withMockDocument(async () => {
    await withImmediateAnimationFrame(() => {
      BoardStageConfigController.prototype.openFromEvent.call(controller, {
        detail: {
          stageDefinitions,
          stagePromptActions,
          stageReviewPolicies,
          currentBoard: board,
          triggerElement
        }
      });
    });

    assert.equal(globalThis.document.activeElement, controller.definitionsInputTarget);
  });

  assert.equal(controller.dialogTarget.open, true);
  assert.equal(controller.definitionsInputTarget.value, stageDefinitions);
  assert.equal(controller.promptActionsInputTarget.value, stagePromptActions);
  assert.equal(controller.reviewPoliciesInputTarget.value, stageReviewPolicies);
  assert.equal(controller.currentBoard, board);
  assert.equal(controller.restoreFocusElement, triggerElement);
  assert.equal(controller.definitionsInputTarget.focused, true);
  assert.match(controller.promptActionRegionTarget.innerHTML, /data-stage-id="backlog"/);
  assert.match(controller.promptActionRegionTarget.innerHTML, /data-stage-id="review"/);
  assert.match(controller.reviewPolicyRegionTarget.innerHTML, /data-stage-id="backlog"/);
  assert.match(controller.reviewPolicyRegionTarget.innerHTML, /data-stage-id="review"/);
  assert.equal(controller.errorTarget.hidden, true);
});

test('board stage config apply shows a localized error for invalid prompt action config and does not dispatch apply', async () => {
  const controller = createBoardStageConfigControllerDouble();
  const dispatchedEvents = [];
  let prevented = false;

  controller.dialogTarget.open = true;
  controller.definitionsInputTarget.value = ['backlog | Backlog | review | card.prompt.run', 'review | Review | backlog'].join('\n');
  controller.promptActionDrafts = {
    backlog: {
      enabled: true,
      prompt: '',
      targetStageId: 'review'
    }
  };
  controller.syncPromptActionRows();

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
  assert.equal(controller.errorTarget.textContent, 'Prompt-enabled stages need a prompt.');
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
  board.stages.todo.cardIds.push('card_1');

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
  const stageDefinitions = ['backlog | Backlog | review | card.prompt.run', 'review | Review | backlog'].join('\n');
  const stagePromptActions = JSON.stringify(
    {
      backlog: {
        enabled: true,
        prompt: 'Turn this card into a review task.',
        targetStageId: 'review'
      }
    },
    null,
    2
  );

  controller.dialogTarget.open = true;
  controller.currentBoard = createEmptyWorkspace().boards.main;
  controller.restoreFocusElement = createFocusableElement();
  controller.definitionsInputTarget.value = stageDefinitions;
  controller.promptActionDrafts = JSON.parse(stagePromptActions);
  controller.syncPromptActionRows();

  await withWindowDispatchCapture(dispatchedEvents, () => {
    BoardStageConfigController.prototype.apply.call(controller, {
      preventDefault() {}
    });
  });

  assert.equal(controller.dialogTarget.open, false);
  assert.equal(controller.errorTarget.hidden, true);
  assert.equal(dispatchedEvents.length, 1);
  assert.equal(dispatchedEvents[0].type, 'board-stage-config:apply');
  assert.deepEqual(dispatchedEvents[0].detail, {
    stageDefinitions,
    stagePromptActions,
    stageReviewPolicies: ''
  });
  assert.equal(controller.restoreFocusElement, null);
});

test('board stage config apply preserves card.review stage actions', async () => {
  const controller = createBoardStageConfigControllerDouble();
  const dispatchedEvents = [];
  const stageDefinitions = [
    'draft | Draft | review',
    'review | Review | doing, done | card.review',
    'doing | Doing | review, done',
    'done | Done | review'
  ].join('\n');

  controller.dialogTarget.open = true;
  controller.currentBoard = createEmptyWorkspace().boards.main;
  controller.restoreFocusElement = createFocusableElement();
  controller.definitionsInputTarget.value = stageDefinitions;
  controller.promptActionDrafts = {};
  controller.syncPromptActionRows();

  await withWindowDispatchCapture(dispatchedEvents, () => {
    BoardStageConfigController.prototype.apply.call(controller, {
      preventDefault() {}
    });
  });

  assert.equal(controller.dialogTarget.open, false);
  assert.equal(controller.errorTarget.hidden, true);
  assert.equal(dispatchedEvents.length, 1);
  assert.deepEqual(dispatchedEvents[0].detail, {
    stageDefinitions,
    stagePromptActions: '',
    stageReviewPolicies: ''
  });
});

test('board stage config apply dispatches review policy drafts for review-enabled stages', async () => {
  const controller = createBoardStageConfigControllerDouble();
  const dispatchedEvents = [];
  const stageDefinitions = [
    'review | Review | publish | card.review',
    'publish | Publish | review | card.review'
  ].join('\n');

  controller.dialogTarget.open = true;
  controller.currentBoard = createEmptyWorkspace().boards.main;
  controller.restoreFocusElement = createFocusableElement();
  controller.definitionsInputTarget.value = stageDefinitions;
  controller.reviewPolicyDrafts = {
    publish: {
      approverRole: 'admin',
      explicit: true
    }
  };
  controller.syncReviewPolicyRows();

  await withWindowDispatchCapture(dispatchedEvents, () => {
    BoardStageConfigController.prototype.apply.call(controller, {
      preventDefault() {}
    });
  });

  assert.equal(dispatchedEvents.length, 1);
  assert.deepEqual(dispatchedEvents[0].detail, {
    stageDefinitions,
    stagePromptActions: '',
    stageReviewPolicies: JSON.stringify(
      {
        publish: {
          approverRole: 'admin'
        }
      },
      null,
      2
    )
  });
});

test('board stage config close restores focus predictably', () => {
  const controller = createBoardStageConfigControllerDouble();
  const triggerElement = createFocusableElement();
  let prevented = false;

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
  controller.promptActionsInputTarget = createFocusableValueTarget('');
  controller.promptActionRegionTarget = {
    innerHTML: ''
  };
  controller.hasPromptActionRegionTarget = true;
  controller.reviewPoliciesInputTarget = createFocusableValueTarget('');
  controller.reviewPolicyRegionTarget = {
    innerHTML: ''
  };
  controller.hasReviewPolicyRegionTarget = true;
  controller.promptActionDrafts = {};
  controller.reviewPolicyDrafts = {};
  controller.errorTarget = createTextTarget({ hidden: true });
  controller.hasErrorTarget = true;

  return controller;
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

function createFocusableValueTarget(value = '') {
  return {
    value,
    focused: false,
    focus() {
      this.focused = true;

      if (globalThis.document && typeof globalThis.document === 'object') {
        globalThis.document.activeElement = this;
      }
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

      if (globalThis.document && typeof globalThis.document === 'object') {
        globalThis.document.activeElement = this;
      }
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

async function withMockDocument(callback) {
  const originalDocument = globalThis.document;
  globalThis.document = {
    activeElement: null
  };

  try {
    return await callback();
  } finally {
    if (typeof originalDocument === 'undefined') {
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }
  }
}
