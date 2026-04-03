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
  assert.match(formState.stageDefinitions, /backlog \| Backlog \| doing, done \| card\.create/);
  assert.match(formState.stageDefinitions, /archived \| Archived \| backlog, doing, done \| card\.delete/);
  assert.equal(Object.prototype.hasOwnProperty.call(formState, 'templates'), false);
});

test('createBoardEditorFormState serializes localization glossary terms for editing', () => {
  const board = createEmptyWorkspace().boards.main;
  board.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en', 'es'],
    requiredLocales: ['en']
  };
  board.localizationGlossary = [
    {
      source: 'Omen of Sorrow',
      translations: {
        es: 'Omen of Sorrow'
      }
    }
  ];

  const formState = createBoardEditorFormState(board);

  assert.equal(formState.localizationGlossary, 'Omen of Sorrow | es=Omen of Sorrow');
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
    aiProvider: 'OpenAI',
    stageDefinitions: ['backlog | Backlog | review | card.create', 'review | Review | backlog'].join('\n')
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
      actionIds: ['card.create']
    },
    {
      id: 'review',
      title: 'Review',
      allowedTransitionStageIds: ['backlog'],
      actionIds: []
    }
  ]);
  assert.deepEqual(parsedInput.templates, []);
  assert.equal(parsedInput.aiProvider, 'openai');
  assert.equal(parsedInput.clearOpenAiApiKey, false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsedInput, 'openAiApiKey'), false);
});

test('parseBoardEditorFormInput parses localization glossary entries for supported locales', () => {
  const parsedInput = parseBoardEditorFormInput({
    title: 'Editorial board',
    sourceLocale: 'en',
    defaultLocale: 'es',
    supportedLocales: 'en, es',
    requiredLocales: 'en',
    localizationGlossary: [
      'Omen of Sorrow | es=Omen of Sorrow',
      'Blood Pact | es=Pacto de Sangre'
    ].join('\n'),
    stageDefinitions: ['backlog | Backlog | review', 'review | Review | backlog'].join('\n')
  });

  assert.deepEqual(parsedInput.localizationGlossary, [
    {
      source: 'Omen of Sorrow',
      translations: {
        es: 'Omen of Sorrow'
      }
    },
    {
      source: 'Blood Pact',
      translations: {
        es: 'Pacto de Sangre'
      }
    }
  ]);
});

test('parseBoardEditorFormInput accepts 2-, 3-, and 4-segment stage lines and preserves empty transitions before actions', () => {
  const parsedInput = parseBoardEditorFormInput({
    title: 'Editorial board',
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: 'en',
    requiredLocales: 'en',
    stageDefinitions: [
      'backlog | Backlog | | card.create',
      'archived | Archived | backlog',
      'archive-bin | Archive Bin | | card.delete'
    ].join('\n')
  });

  assert.deepEqual(parsedInput.stageDefinitions, [
    {
      id: 'backlog',
      title: 'Backlog',
      allowedTransitionStageIds: [],
      actionIds: ['card.create']
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
      actionIds: ['card.create']
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

test('parseBoardEditorFormInput includes a replacement OpenAI key when one is provided', () => {
  const parsedInput = parseBoardEditorFormInput({
    title: 'Editorial board',
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: 'en',
    requiredLocales: 'en',
    aiProvider: 'OpenAI',
    openAiApiKey: ' sk-new-1234 ',
    stageDefinitions: ['backlog | Backlog | review', 'review | Review | backlog'].join('\n')
  });

  assert.equal(parsedInput.aiProvider, 'openai');
  assert.equal(parsedInput.openAiApiKey, 'sk-new-1234');
  assert.equal(parsedInput.clearOpenAiApiKey, false);
});

test('parseBoardEditorFormInput keeps the saved OpenAI key when the input is blank', () => {
  const parsedInput = parseBoardEditorFormInput({
    title: 'Editorial board',
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: 'en',
    requiredLocales: 'en',
    aiProvider: 'OpenAI',
    openAiApiKey: '   ',
    stageDefinitions: ['backlog | Backlog | review', 'review | Review | backlog'].join('\n')
  });

  assert.equal(parsedInput.aiProvider, 'openai');
  assert.equal(parsedInput.clearOpenAiApiKey, false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsedInput, 'openAiApiKey'), false);
});

test('parseBoardEditorFormInput clears the saved OpenAI key when requested', () => {
  const parsedInput = parseBoardEditorFormInput({
    title: 'Editorial board',
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: 'en',
    requiredLocales: 'en',
    aiProvider: 'OpenAI',
    clearOpenAiApiKey: true,
    stageDefinitions: ['backlog | Backlog | review', 'review | Review | backlog'].join('\n')
  });

  assert.equal(parsedInput.aiProvider, 'openai');
  assert.equal(parsedInput.clearOpenAiApiKey, true);
  assert.equal(Object.prototype.hasOwnProperty.call(parsedInput, 'openAiApiKey'), false);
});

test('board editor initializes the stage summary from the opened board draft', async () => {
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

  assert.equal(controller.stageDefinitionsInputTarget.value, createBoardEditorFormState(board).stageDefinitions);
  assert.equal(controller.stageSummaryTarget.textContent, '4 stages · backlog, doing, done, archived');
});

test('board editor opens the stage-config dialog by dispatching the current draft on window', async () => {
  const controller = createBoardEditorControllerDouble();
  const board = createEmptyWorkspace().boards.main;
  const dispatchedEvents = [];
  let prevented = false;

  controller.currentBoard = board;
  controller.stageDefinitionsInputTarget.value = createBoardEditorFormState(board).stageDefinitions;

  await withWindowDispatchCapture(dispatchedEvents, () => {
    BoardEditorController.prototype.openStageConfig.call(controller, {
      preventDefault() {
        prevented = true;
      },
      currentTarget: controller.configureStagesButtonTarget
    });
  });

  assert.equal(prevented, true);
  assert.equal(dispatchedEvents.length, 1);
  assert.equal(dispatchedEvents[0].type, 'workspace:open-board-stage-config');
  assert.deepEqual(dispatchedEvents[0].detail, {
    stageDefinitions: controller.stageDefinitionsInputTarget.value,
    currentBoard: board,
    triggerElement: controller.configureStagesButtonTarget
  });
});

test('board editor applies returned stage definitions back into the hidden draft and refreshes the summary', () => {
  const controller = createBoardEditorControllerDouble();

  controller.currentBoard = createEmptyWorkspace().boards.main;
  controller.errorTarget.hidden = false;
  controller.errorTarget.textContent = 'Old error';

  BoardEditorController.prototype.applyStageConfig.call(controller, {
    detail: {
      stageDefinitions: ['backlog | Backlog | review | card.create', 'review | Review | backlog'].join('\n')
    }
  });

  assert.equal(
    controller.stageDefinitionsInputTarget.value,
    ['backlog | Backlog | review | card.create', 'review | Review | backlog'].join('\n')
  );
  assert.equal(controller.stageSummaryTarget.textContent, '2 stages · backlog, review');
  assert.equal(controller.errorTarget.hidden, true);
  assert.equal(controller.errorTarget.textContent, '');
  assert.equal(controller.configureStagesButtonTarget.focused, true);
});

test('board editor submit still uses the applied stage definitions draft', async () => {
  const controller = createBoardEditorControllerDouble();
  const dispatchedEvents = [];
  let prevented = false;

  controller.dispatch = (name, detail) => {
    dispatchedEvents.push({ name, detail });
  };
  controller.closeDialog = () => {
    controller.closeDialogCalls = (controller.closeDialogCalls ?? 0) + 1;
  };
  controller.titleInputTarget.value = 'Editorial board';
  controller.sourceLocaleInputTarget.value = 'en';
  controller.defaultLocaleInputTarget.value = 'en';
  controller.supportedLocalesInputTarget.value = 'en';
  controller.requiredLocalesInputTarget.value = 'en';
  controller.aiProviderInputTarget.value = 'OpenAI';
  controller.localizationGlossaryInputTarget.value = '';

  BoardEditorController.prototype.applyStageConfig.call(controller, {
    detail: {
      stageDefinitions: ['backlog | Backlog | review | card.create', 'review | Review | backlog'].join('\n')
    }
  });

  await withFormDataStub(() => {
    BoardEditorController.prototype.submit.call(controller, {
      preventDefault() {
        prevented = true;
      }
    });
  });

  assert.equal(prevented, true);
  assert.equal(controller.closeDialogCalls, 1);
  assert.deepEqual(dispatchedEvents, [
    {
      name: 'save',
      detail: {
        detail: {
          mode: 'create',
          boardId: '',
          input: {
            title: 'Editorial board',
            languagePolicy: {
              sourceLocale: 'en',
              defaultLocale: 'en',
              supportedLocales: ['en'],
              requiredLocales: ['en']
            },
            stageDefinitions: [
              {
                id: 'backlog',
                title: 'Backlog',
                allowedTransitionStageIds: ['review'],
                actionIds: ['card.create']
              },
              {
                id: 'review',
                title: 'Review',
                allowedTransitionStageIds: ['backlog'],
                actionIds: []
              }
            ],
            templates: [],
            localizationGlossary: [],
            aiProvider: 'openai',
            clearOpenAiApiKey: false
          }
        }
      }
    }
  ]);
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
  board.aiLocalization = {
    provider: 'openai',
    hasApiKey: true,
    apiKeyLast4: '1234'
  };
  board.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en', 'es'],
    requiredLocales: ['en']
  };
  board.localizationGlossary = [
    {
      source: 'Omen of Sorrow',
      translations: {
        es: 'Omen of Sorrow'
      }
    }
  ];

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
  assert.equal(controller.aiSectionTarget.hidden, false);
  assert.equal(controller.apiKeyStatusTarget.hidden, false);
  assert.match(controller.apiKeyStatusTarget.textContent, /1234/);
  assert.equal(controller.localizationGlossaryInputTarget.value, 'Omen of Sorrow | es=Omen of Sorrow');
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
  controller.formTarget = createBoardEditorFormTarget(controller);
  controller.headingTarget = createTextTarget();
  controller.modeInputTarget = createValueTarget('create');
  controller.boardIdInputTarget = createValueTarget('');
  controller.titleInputTarget = createFocusableValueTarget('');
  controller.sourceLocaleInputTarget = createValueTarget('');
  controller.defaultLocaleInputTarget = createValueTarget('');
  controller.supportedLocalesInputTarget = createValueTarget('');
  controller.requiredLocalesInputTarget = createValueTarget('');
  controller.aiSectionTarget = {
    hidden: true
  };
  controller.aiProviderInputTarget = createValueTarget('OpenAI');
  controller.apiKeyStatusTarget = createTextTarget({ hidden: true });
  controller.openAiApiKeyInputTarget = createValueTarget('');
  controller.clearOpenAiApiKeyInputTarget = {
    checked: false
  };
  controller.localizationGlossaryInputTarget = createValueTarget('');
  controller.stageDefinitionsInputTarget = createValueTarget('');
  controller.stageSummaryTarget = createTextTarget();
  controller.configureStagesButtonTarget = createFocusableButtonTarget();
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

function createBoardEditorFormTarget(controller) {
  return {
    resetCalls: 0,
    reset() {
      this.resetCalls += 1;
    },
    getFormDataEntries() {
      return {
        title: controller.titleInputTarget.value,
        sourceLocale: controller.sourceLocaleInputTarget.value,
        defaultLocale: controller.defaultLocaleInputTarget.value,
        supportedLocales: controller.supportedLocalesInputTarget.value,
        requiredLocales: controller.requiredLocalesInputTarget.value,
        aiProvider: controller.aiProviderInputTarget.value,
        openAiApiKey: controller.openAiApiKeyInputTarget.value,
        clearOpenAiApiKey: controller.clearOpenAiApiKeyInputTarget.checked ? 'true' : null,
        localizationGlossary: controller.localizationGlossaryInputTarget.value,
        stageDefinitions: controller.stageDefinitionsInputTarget.value
      };
    }
  };
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

function createFocusableButtonTarget() {
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

async function withFormDataStub(callback) {
  const originalFormData = globalThis.FormData;

  globalThis.FormData = class FormDataStub {
    constructor(form) {
      this.values = typeof form?.getFormDataEntries === 'function' ? form.getFormDataEntries() : {};
    }

    get(name) {
      return Object.prototype.hasOwnProperty.call(this.values, name) ? this.values[name] : null;
    }
  };

  try {
    return await callback();
  } finally {
    if (typeof originalFormData === 'undefined') {
      delete globalThis.FormData;
    } else {
      globalThis.FormData = originalFormData;
    }
  }
}
