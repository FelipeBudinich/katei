import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator } from '../public/js/i18n/translate.js';
import { createEmptyWorkspace } from '../public/js/domain/workspace_read_model.js';
import BoardEditorController from '../public/js/controllers/board_editor_controller.js';
import {
  createBoardEditorFormState,
  parseBoardEditorFormInput
} from '../public/js/controllers/board_editor_schema.js';

test('createBoardEditorFormState serializes the current board schema without exposing templates for editing', () => {
  const board = createEmptyWorkspace().boards.main;
  board.templates.default = [
    {
      id: 'starter',
      title: 'Starter',
      initialStageId: 'backlog'
    }
  ];
  board.stages.backlog.templateIds = ['starter'];

  const formState = createBoardEditorFormState(board);

  assert.equal(formState.title, '過程');
  assert.match(formState.stageDefinitions, /backlog \| Backlog \| doing, done/);
  assert.match(formState.stageDefinitions, /archived \| Archived \| backlog, doing, done \| card\.delete/);
  assert.equal(Object.prototype.hasOwnProperty.call(formState, 'templates'), false);
});

test('createBoardEditorFormState serializes a fourth stage segment only when actions exist', () => {
  const board = createEmptyWorkspace().boards.main;

  board.stageOrder = ['backlog', 'archive-bin'];
  board.stages = {
    backlog: {
      id: 'backlog',
      title: 'Backlog',
      cardIds: [],
      allowedTransitionStageIds: ['archive-bin'],
      templateIds: [],
      actionIds: []
    },
    'archive-bin': {
      id: 'archive-bin',
      title: 'Archive Bin',
      cardIds: [],
      allowedTransitionStageIds: [],
      templateIds: [],
      actionIds: ['card.delete']
    }
  };

  const formState = createBoardEditorFormState(board);

  assert.match(formState.stageDefinitions, /backlog \| Backlog \| archive-bin/);
  assert.match(formState.stageDefinitions, /archive-bin \| Archive Bin \|  \| card\.delete/);
});

test('parseBoardEditorFormInput parses valid schema edits and clears templates from board editor submissions', () => {
  const parsedInput = parseBoardEditorFormInput({
    title: 'Editorial board',
    sourceLocale: 'en',
    defaultLocale: 'ja',
    supportedLocales: 'en, ja',
    requiredLocales: 'en',
    stageDefinitions: ['backlog | Backlog | review', 'review | Review | backlog'].join('\n')
  });

  assert.equal(parsedInput.title, 'Editorial board');
  assert.deepEqual(parsedInput.languagePolicy, {
    sourceLocale: 'en',
    defaultLocale: 'ja',
    supportedLocales: ['en', 'ja'],
    requiredLocales: ['en']
  });
  assert.deepEqual(parsedInput.stageDefinitions, [
    {
      id: 'backlog',
      title: 'Backlog',
      allowedTransitionStageIds: ['review'],
      actionIds: []
    },
    {
      id: 'review',
      title: 'Review',
      allowedTransitionStageIds: ['backlog'],
      actionIds: []
    }
  ]);
  assert.deepEqual(parsedInput.templates, []);
});

test('parseBoardEditorFormInput accepts 2-, 3-, and 4-segment stage lines and preserves empty transitions before actions', () => {
  const parsedInput = parseBoardEditorFormInput({
    title: 'Editorial board',
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: 'en',
    requiredLocales: 'en',
    stageDefinitions: [
      'backlog | Backlog',
      'archived | Archived | backlog',
      'archive-bin | Archive Bin | | card.delete'
    ].join('\n')
  });

  assert.deepEqual(parsedInput.stageDefinitions, [
    {
      id: 'backlog',
      title: 'Backlog',
      allowedTransitionStageIds: [],
      actionIds: []
    },
    {
      id: 'archived',
      title: 'Archived',
      allowedTransitionStageIds: ['backlog'],
      actionIds: ['card.delete']
    },
    {
      id: 'archive-bin',
      title: 'Archive Bin',
      allowedTransitionStageIds: [],
      actionIds: ['card.delete']
    }
  ]);
  assert.deepEqual(parsedInput.templates, []);
});

test('parseBoardEditorFormInput rejects source-locale changes that existing cards cannot satisfy', () => {
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

  assert.throws(
    () =>
      parseBoardEditorFormInput(
        {
          title: 'Editorial board',
          sourceLocale: 'ja',
          defaultLocale: 'ja',
          supportedLocales: 'en, ja',
          requiredLocales: 'ja',
          stageDefinitions: ['backlog | Backlog | doing', 'doing | Doing | backlog'].join('\n')
        },
        {
          currentBoard: board
        }
      ),
    /Existing cards do not contain the new source locale/
  );
});

test('parseBoardEditorFormInput clears legacy templates when editing an existing board', () => {
  const board = createEmptyWorkspace().boards.main;
  board.templates.default = [
    {
      id: 'starter',
      title: 'Starter',
      initialStageId: 'backlog'
    }
  ];
  board.stages.backlog.templateIds = ['starter'];

  const parsedInput = parseBoardEditorFormInput(
    {
      title: 'Editorial board',
      sourceLocale: 'en',
      defaultLocale: 'en',
      supportedLocales: 'en',
      requiredLocales: 'en',
      stageDefinitions: ['backlog | Backlog | review', 'review | Review | backlog'].join('\n'),
      templates: 'Starter template | backlog'
    },
    {
      currentBoard: board
    }
  );

  assert.deepEqual(parsedInput.stageDefinitions, [
    {
      id: 'backlog',
      title: 'Backlog',
      allowedTransitionStageIds: ['review'],
      actionIds: []
    },
    {
      id: 'review',
      title: 'Review',
      allowedTransitionStageIds: ['backlog'],
      actionIds: []
    }
  ]);
  assert.deepEqual(parsedInput.templates, []);
});

test('board editor hides delete actions in create mode', async () => {
  const controller = createBoardEditorControllerDouble();

  await withImmediateAnimationFrame(() => {
    BoardEditorController.prototype.openFromEvent.call(controller, {
      detail: {
        mode: 'create',
        canDeleteBoard: false
      }
    });
  });

  assert.equal(controller.dialogTarget.open, true);
  assert.equal(controller.deleteActionsTarget.hidden, true);
  assert.equal(controller.deleteButtonTarget.dataset.boardId, '');
});

test('board editor shows delete actions for a deletable board in edit mode', async () => {
  const controller = createBoardEditorControllerDouble();
  const board = createEmptyWorkspace().boards.main;

  await withImmediateAnimationFrame(() => {
    BoardEditorController.prototype.openFromEvent.call(controller, {
      detail: {
        mode: 'edit',
        board,
        canDeleteBoard: true
      }
    });
  });

  assert.equal(controller.dialogTarget.open, true);
  assert.equal(controller.deleteActionsTarget.hidden, false);
  assert.equal(controller.deleteButtonTarget.dataset.boardId, 'main');
  assert.equal(controller.boardIdInputTarget.value, 'main');
});

test('board editor keeps delete actions hidden when edit mode cannot delete the board', async () => {
  const controller = createBoardEditorControllerDouble();
  const board = createEmptyWorkspace().boards.main;

  await withImmediateAnimationFrame(() => {
    BoardEditorController.prototype.openFromEvent.call(controller, {
      detail: {
        mode: 'edit',
        board,
        canDeleteBoard: false
      }
    });
  });

  assert.equal(controller.deleteActionsTarget.hidden, true);
  assert.equal(controller.deleteButtonTarget.dataset.boardId, '');
});

test('board editor closeForAction closes first and clears the delete board id after handoff', async () => {
  const controller = createBoardEditorControllerDouble();
  const board = createEmptyWorkspace().boards.main;

  await withImmediateAnimationFrame(() => {
    BoardEditorController.prototype.openFromEvent.call(controller, {
      detail: {
        mode: 'edit',
        board,
        canDeleteBoard: true
      }
    });
  });

  BoardEditorController.prototype.closeForAction.call(controller);

  assert.equal(controller.dialogTarget.open, false);
  assert.equal(controller.deleteActionsTarget.hidden, true);
  assert.equal(controller.currentBoard, null);
  assert.equal(controller.deleteButtonTarget.dataset.boardId, 'main');

  await Promise.resolve();

  assert.equal(controller.deleteButtonTarget.dataset.boardId, '');
});

function createBoardEditorControllerDouble() {
  const controller = Object.create(BoardEditorController.prototype);

  controller.t = createTranslator('en');
  controller.currentBoard = null;
  controller.dialogTarget = createDialogTarget();
  controller.formTarget = {
    resetCalls: 0,
    reset() {
      this.resetCalls += 1;
    }
  };
  controller.headingTarget = createTextTarget();
  controller.modeInputTarget = createValueTarget('create');
  controller.boardIdInputTarget = createValueTarget('');
  controller.titleInputTarget = createFocusableValueTarget('');
  controller.sourceLocaleInputTarget = createValueTarget('');
  controller.defaultLocaleInputTarget = createValueTarget('');
  controller.supportedLocalesInputTarget = createValueTarget('');
  controller.requiredLocalesInputTarget = createValueTarget('');
  controller.stageDefinitionsInputTarget = createValueTarget('');
  controller.deleteActionsTarget = {
    hidden: true
  };
  controller.deleteButtonTarget = {
    dataset: {}
  };
  controller.submitButtonTarget = createTextTarget();
  controller.errorTarget = createTextTarget({ hidden: true });
  controller.hasErrorTarget = true;
  controller.dispatch = () => {};

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

function createTextTarget({ hidden = false } = {}) {
  return {
    hidden,
    textContent: ''
  };
}

function createValueTarget(value = '') {
  return {
    value
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
