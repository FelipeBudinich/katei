import test from 'node:test';
import assert from 'node:assert/strict';
import CardEditorController from '../public/js/controllers/card_editor_controller.js';
import { createCardContentProvenance } from '../public/js/domain/card_localization.js';
import {
  createLocalizedCardEditorUiState,
  createLocalizedCardViewState
} from '../public/js/controllers/card_editor_locale_view.js';
import { createTranslator } from '../public/js/i18n/translate.js';

test('locale dropdown state uses the board supported locales and defaults to the board default locale', () => {
  const board = createBoard();
  const card = createCard();

  const state = createLocalizedCardViewState({ board, card });

  assert.deepEqual(state.supportedLocales, ['en', 'es-CL', 'ja']);
  assert.deepEqual(state.availableLocales, ['en', 'es-CL']);
  assert.equal(state.selectedLocale, 'es-CL');
});

test('locale dropdown defaults to the exact ui locale when it exists for the card', () => {
  const board = createBoard();
  const card = createCard();

  const state = createLocalizedCardViewState({ board, card, uiLocale: 'en' });

  assert.equal(state.selectedLocale, 'en');
  assert.equal(state.renderedLocale, 'en');
});

test('locale dropdown falls back to board defaults when the ui locale is unavailable', () => {
  const board = createBoard();
  const card = createCard();

  const state = createLocalizedCardViewState({ board, card, uiLocale: 'fr' });

  assert.equal(state.selectedLocale, 'es-CL');
  assert.equal(state.renderedLocale, 'es-CL');
});

test('edit dialog state chooses ui-locale content by default when that locale exists', () => {
  const board = createBoardWithOpenAiKey();
  const card = createCardWithHumanJapaneseLocalization();

  const state = createLocalizedCardEditorUiState({
    board,
    card,
    uiLocale: 'ja',
    mode: 'edit',
    canEditLocalizedContent: true,
    currentActorRole: 'editor'
  });

  assert.equal(state.selectedLocale, 'ja');
  assert.equal(state.renderedLocale, 'ja');
  assert.equal(state.variant?.title, '手動の日本語タイトル');
});

test('edit dialog falls back from a regional ui locale to same-language content', () => {
  const board = createBoardWithOpenAiKey({
    languagePolicy: {
      sourceLocale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en', 'es'],
      requiredLocales: ['en']
    }
  });
  const card = {
    id: 'card_spanish_fallback',
    priority: 'important',
    createdAt: '2026-03-31T09:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z',
    contentByLocale: {
      en: {
        title: 'English source',
        detailsMarkdown: 'English details',
        provenance: createCardContentProvenance({
          actor: { type: 'human', id: 'viewer_123' },
          timestamp: '2026-03-31T09:00:00.000Z',
          includesHumanInput: true
        })
      },
      es: {
        title: 'Titulo en español',
        detailsMarkdown: 'Detalles en español',
        provenance: createCardContentProvenance({
          actor: { type: 'agent', id: 'translator_1' },
          timestamp: '2026-03-31T10:00:00.000Z',
          includesHumanInput: false
        })
      }
    },
    localeRequests: {}
  };

  const state = createLocalizedCardEditorUiState({
    board,
    card,
    uiLocale: 'es-CL',
    mode: 'edit',
    canEditLocalizedContent: true,
    currentActorRole: 'editor'
  });

  assert.equal(state.selectedLocale, 'es');
  assert.equal(state.renderedLocale, 'es');
  assert.equal(state.variant?.title, 'Titulo en español');
});

test('edit dialog resolves legacy jp content as ja by default', () => {
  const board = createBoardWithOpenAiKey({
    languagePolicy: {
      sourceLocale: 'en',
      defaultLocale: 'jp',
      supportedLocales: ['en', 'jp'],
      requiredLocales: ['en']
    }
  });
  const card = {
    id: 'card_legacy_jp',
    priority: 'important',
    createdAt: '2026-03-31T09:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z',
    contentByLocale: {
      en: {
        title: 'English source',
        detailsMarkdown: 'English details',
        provenance: createCardContentProvenance({
          actor: { type: 'human', id: 'viewer_123' },
          timestamp: '2026-03-31T09:00:00.000Z',
          includesHumanInput: true
        })
      },
      jp: {
        title: '旧日本語タイトル',
        detailsMarkdown: '旧日本語本文',
        provenance: createCardContentProvenance({
          actor: { type: 'agent', id: 'translator_1' },
          timestamp: '2026-03-31T10:00:00.000Z',
          includesHumanInput: false
        })
      }
    },
    localeRequests: {}
  };

  const state = createLocalizedCardEditorUiState({
    board,
    card,
    uiLocale: 'ja',
    mode: 'edit',
    canEditLocalizedContent: true,
    currentActorRole: 'editor'
  });

  assert.equal(state.selectedLocale, 'ja');
  assert.equal(state.renderedLocale, 'ja');
  assert.equal(state.variant?.title, '旧日本語タイトル');
});

test('edit dialog keeps an explicit requested locale sticky over the ui locale', () => {
  const board = createBoardWithOpenAiKey();
  const card = createCardWithHumanJapaneseLocalization();

  const state = createLocalizedCardEditorUiState({
    board,
    card,
    selectedLocale: 'en',
    uiLocale: 'ja',
    mode: 'edit',
    canEditLocalizedContent: true,
    currentActorRole: 'editor'
  });

  assert.equal(state.selectedLocale, 'en');
  assert.equal(state.renderedLocale, 'en');
  assert.equal(state.variant?.title, 'English source');
});

test('switching locale changes the displayed card variant', () => {
  const board = createBoard();
  const card = createCard();

  const englishState = createLocalizedCardViewState({ board, card, selectedLocale: 'en' });
  const spanishState = createLocalizedCardViewState({ board, card, selectedLocale: 'es-CL' });

  assert.equal(englishState.variant?.title, 'English source');
  assert.equal(englishState.variant?.detailsMarkdown, 'English details');
  assert.equal(spanishState.variant?.title, 'Titulo por defecto');
  assert.equal(spanishState.variant?.detailsMarkdown, 'Detalles por defecto');
});

test('missing selected locales surface fallback state and the rendered locale', () => {
  const board = createBoard();
  const card = createCard();

  const state = createLocalizedCardViewState({ board, card, selectedLocale: 'ja' });

  assert.equal(state.selectedLocale, 'ja');
  assert.equal(state.isMissingSelectedLocale, true);
  assert.equal(state.renderedLocale, 'es-CL');
  assert.equal(state.variant?.title, 'Titulo por defecto');
});

test('editor can manually add a missing locale without an AI key configured', () => {
  const board = {
    ...createBoard(),
    aiLocalization: {
      provider: 'openai',
      hasApiKey: false,
      apiKeyLast4: null
    }
  };
  const card = createCard();

  const state = createLocalizedCardEditorUiState({
    board,
    card,
    selectedLocale: 'ja',
    mode: 'edit',
    canEditLocalizedContent: true,
    currentActorRole: 'editor'
  });

  assert.equal(state.selectedLocale, 'ja');
  assert.equal(state.isMissingSelectedLocale, true);
  assert.equal(state.showSaveControls, true);
  assert.equal(state.showGenerateLocaleButton, false);
  assert.equal(state.localeActionHelpKey, 'cardEditor.manualLocaleHelp');
  assert.deepEqual(state.editableVariant, {
    locale: 'ja',
    title: '',
    detailsMarkdown: '',
    provenance: null,
    review: null,
    isFallback: false,
    source: 'localized'
  });
  assert.equal(state.variant?.title, 'Titulo por defecto');
});

test('view locale selection stays constrained to available localized variants', () => {
  const board = createBoard();
  const card = createCard();

  const state = createLocalizedCardViewState({
    board,
    card,
    selectedLocale: 'ja',
    localeSelection: 'available'
  });

  assert.deepEqual(state.availableLocales, ['en', 'es-CL']);
  assert.equal(state.selectedLocale, 'es-CL');
  assert.equal(state.renderedLocale, 'es-CL');
  assert.equal(state.variant?.title, 'Titulo por defecto');
});

test('locale status state keeps present, requested, and missing locales visible together', () => {
  const board = createBoard();
  const card = createCard();

  const state = createLocalizedCardViewState({ board, card, selectedLocale: 'ja' });

  assert.deepEqual(state.localeStatuses, [
    {
      locale: 'en',
      status: 'present',
      hasContent: true,
      isRequested: false,
      isSourceLocale: true,
      isDefaultLocale: false,
      isRequired: true,
      request: null
    },
    {
      locale: 'es-CL',
      status: 'present',
      hasContent: true,
      isRequested: false,
      isSourceLocale: false,
      isDefaultLocale: true,
      isRequired: false,
      request: null
    },
    {
      locale: 'ja',
      status: 'requested',
      hasContent: false,
      isRequested: true,
      isSourceLocale: false,
      isDefaultLocale: false,
      isRequired: true,
      request: {
        locale: 'ja',
        status: 'open',
        requestedBy: {
          type: 'human',
          id: 'viewer_123'
        },
        requestedAt: '2026-03-31T12:30:00.000Z'
      }
    }
  ]);
});

test('request button appears when the selected locale is missing and the actor can edit', () => {
  const uiState = createLocalizedCardEditorUiState({
    board: createBoardWithFrench(),
    card: createCard(),
    selectedLocale: 'fr',
    mode: 'edit',
    canEditLocalizedContent: true,
    currentActorRole: 'editor'
  });

  assert.equal(uiState.showRequestLocaleButton, true);
  assert.equal(uiState.showClearLocaleRequestButton, false);
  assert.deepEqual(uiState.localeEditSummaryState, {
    key: 'cardEditor.missingLocaleValue',
    locale: 'fr'
  });
});

test('clear-request button appears when the selected locale is already requested and editable', () => {
  const uiState = createLocalizedCardEditorUiState({
    board: createBoard(),
    card: createCard(),
    selectedLocale: 'ja',
    mode: 'edit',
    canEditLocalizedContent: true,
    currentActorRole: 'admin'
  });

  assert.equal(uiState.showRequestLocaleButton, false);
  assert.equal(uiState.showClearLocaleRequestButton, true);
  assert.deepEqual(uiState.localeEditSummaryState, {
    key: 'cardEditor.requestedLocaleValue',
    locale: 'ja'
  });
});

test('editor sees AI review state and a verify button for localized AI content', () => {
  const uiState = createLocalizedCardEditorUiState({
    board: createBoardWithOpenAiKey(),
    card: createCard(),
    selectedLocale: 'es-CL',
    mode: 'edit',
    canEditLocalizedContent: true,
    currentActorRole: 'editor'
  });

  assert.deepEqual(uiState.selectedLocaleReviewState, {
    origin: 'ai',
    status: 'ai',
    isAiOrigin: true,
    isVerificationRequested: false,
    isVerified: false
  });
  assert.equal(uiState.showSelectedLocaleReviewState, true);
  assert.equal(uiState.showVerifyLocaleButton, true);
  assert.equal(uiState.canVerifyLocale, true);
});

test('verified AI localized content shows the verified state and hides the verify button', () => {
  const card = createCard();
  card.contentByLocale['es-CL'].review = {
    origin: 'ai',
    verificationRequestedBy: { type: 'human', id: 'viewer_123' },
    verificationRequestedAt: '2026-03-31T12:30:00.000Z',
    verifiedBy: { type: 'human', id: 'editor_456' },
    verifiedAt: '2026-03-31T13:00:00.000Z'
  };

  const uiState = createLocalizedCardEditorUiState({
    board: createBoardWithOpenAiKey(),
    card,
    selectedLocale: 'es-CL',
    mode: 'edit',
    canEditLocalizedContent: true,
    currentActorRole: 'admin'
  });

  assert.equal(uiState.selectedLocaleReviewState.status, 'verified');
  assert.equal(uiState.showVerifyLocaleButton, false);
  assert.equal(uiState.canVerifyLocale, false);
});

test('generate button appears when the selected locale is missing, editable, and the board has an OpenAI key', () => {
  const uiState = createLocalizedCardEditorUiState({
    board: createBoardWithOpenAiKey(),
    card: createCard(),
    selectedLocale: 'ja',
    mode: 'edit',
    canEditLocalizedContent: true,
    currentActorRole: 'editor'
  });

  assert.equal(uiState.showGenerateLocaleButton, true);
  assert.equal(uiState.canGenerateLocale, true);
  assert.equal(uiState.generateBlockedReason, null);
});

test('generate button stays hidden when the selected locale already has human-authored content', () => {
  const uiState = createLocalizedCardEditorUiState({
    board: createBoardWithOpenAiKey(),
    card: createCardWithHumanJapaneseLocalization(),
    selectedLocale: 'ja',
    mode: 'edit',
    canEditLocalizedContent: true,
    currentActorRole: 'editor'
  });

  assert.equal(uiState.showGenerateLocaleButton, false);
  assert.equal(uiState.canGenerateLocale, false);
  assert.equal(uiState.generateBlockedReason, 'cardEditor.generateLocaleBlockedAlreadyPresent');
  assert.equal(uiState.showDiscardLocaleButton, true);
});

test('generate button stays hidden when the board has no saved OpenAI key', () => {
  const uiState = createLocalizedCardEditorUiState({
    board: createBoard(),
    card: createCard(),
    selectedLocale: 'ja',
    mode: 'edit',
    canEditLocalizedContent: true,
    currentActorRole: 'editor'
  });

  assert.equal(uiState.showGenerateLocaleButton, false);
  assert.equal(uiState.canGenerateLocale, false);
  assert.equal(uiState.generateBlockedReason, 'cardEditor.generateLocaleBlockedNoAiKey');
});

test('discard button stays hidden for source and missing locales', () => {
  const sourceLocaleState = createLocalizedCardEditorUiState({
    board: createBoardWithOpenAiKey(),
    card: createCard(),
    selectedLocale: 'en',
    mode: 'edit',
    canEditLocalizedContent: true,
    currentActorRole: 'editor'
  });
  const missingLocaleState = createLocalizedCardEditorUiState({
    board: createBoardWithOpenAiKey(),
    card: createCard(),
    selectedLocale: 'ja',
    mode: 'edit',
    canEditLocalizedContent: true,
    currentActorRole: 'editor'
  });

  assert.equal(sourceLocaleState.showDiscardLocaleButton, false);
  assert.equal(missingLocaleState.showDiscardLocaleButton, false);
});

test('card editor dispatches discard-locale with board, card, locale, and trigger payload', () => {
  const controller = Object.create(CardEditorController.prototype);
  const dispatchedEvents = [];
  const triggerElement = { id: 'discard-locale-button' };

  controller.isReadOnlyLocaleView = false;
  controller.card = createCardWithHumanJapaneseLocalization();
  controller.mode = 'edit';
  controller.selectedLocale = 'ja';
  controller.localizedEditorUiState = {
    showDiscardLocaleButton: true
  };
  controller.boardIdInputTarget = { value: 'board_localized' };
  controller.cardIdInputTarget = { value: 'card_1' };
  controller.dispatch = (name, payload) => {
    dispatchedEvents.push({ name, payload });
  };

  CardEditorController.prototype.discardSelectedLocale.call(controller, {
    preventDefault() {},
    currentTarget: triggerElement
  });

  assert.deepEqual(dispatchedEvents, [
    {
      name: 'discard-locale',
      payload: {
        detail: {
          mode: 'edit',
          boardId: 'board_localized',
          cardId: 'card_1',
          locale: 'ja',
          triggerElement
        }
      }
    }
  ]);
});

test('card editor dispatches generate event with board, card, and locale payload', () => {
  const controller = Object.create(CardEditorController.prototype);
  const dispatchedEvents = [];
  let renderCalls = 0;

  controller.isReadOnlyLocaleView = false;
  controller.card = createCard();
  controller.mode = 'edit';
  controller.selectedLocale = 'ja';
  controller.localizedEditorUiState = {
    canGenerateLocale: true
  };
  controller.boardIdInputTarget = { value: 'board_localized' };
  controller.cardIdInputTarget = { value: 'card_1' };
  controller.renderLocaleEditingState = () => {
    renderCalls += 1;
  };
  controller.dispatch = (name, payload) => {
    dispatchedEvents.push({ name, payload });
  };

  CardEditorController.prototype.generateSelectedLocale.call(controller, {
    preventDefault() {}
  });

  assert.equal(controller.isGeneratingLocale, true);
  assert.equal(controller.pendingGenerateLocale, 'ja');
  assert.equal(renderCalls, 1);
  assert.deepEqual(dispatchedEvents, [
    {
      name: 'generate-locale',
      payload: {
        detail: {
          mode: 'edit',
          boardId: 'board_localized',
          cardId: 'card_1',
          locale: 'ja'
        }
      }
    }
  ]);
});

test('card editor dispatches verify-locale with board, card, and locale payload', () => {
  const controller = Object.create(CardEditorController.prototype);
  const dispatchedEvents = [];

  controller.isReadOnlyLocaleView = false;
  controller.card = createCard();
  controller.mode = 'edit';
  controller.selectedLocale = 'es-CL';
  controller.localizedEditorUiState = {
    canVerifyLocale: true
  };
  controller.boardIdInputTarget = { value: 'board_localized' };
  controller.cardIdInputTarget = { value: 'card_1' };
  controller.dispatch = (name, payload) => {
    dispatchedEvents.push({ name, payload });
  };

  CardEditorController.prototype.verifySelectedLocale.call(controller, {
    preventDefault() {}
  });

  assert.deepEqual(dispatchedEvents, [
    {
      name: 'verify-locale',
      payload: {
        detail: {
          mode: 'edit',
          boardId: 'board_localized',
          cardId: 'card_1',
          locale: 'es-CL'
        }
      }
    }
  ]);
});

test('viewers stay read-only in the localized card dialog state', () => {
  const uiState = createLocalizedCardEditorUiState({
    board: createBoard(),
    card: createCard(),
    selectedLocale: 'en',
    mode: 'view',
    canEditLocalizedContent: false,
    currentActorRole: 'viewer'
  });

  assert.equal(uiState.isReadOnly, true);
  assert.equal(uiState.showSaveControls, false);
  assert.equal(uiState.showRequestLocaleButton, false);
  assert.equal(uiState.showClearLocaleRequestButton, false);
  assert.equal(uiState.showReadOnlyNotice, true);
  assert.deepEqual(uiState.localeEditSummaryState, {
    key: 'cardEditor.viewingLocaleValue',
    locale: 'en'
  });
});

test('switching locale updates request and save control state together', () => {
  const editableRequestedState = createLocalizedCardEditorUiState({
    board: createBoard(),
    card: createCard(),
    selectedLocale: 'ja',
    mode: 'edit',
    canEditLocalizedContent: true,
    currentActorRole: 'editor'
  });
  const editablePresentState = createLocalizedCardEditorUiState({
    board: createBoard(),
    card: createCard(),
    selectedLocale: 'es-CL',
    mode: 'edit',
    canEditLocalizedContent: true,
    currentActorRole: 'editor'
  });

  assert.equal(editableRequestedState.showSaveControls, true);
  assert.equal(editableRequestedState.showClearLocaleRequestButton, true);
  assert.equal(editablePresentState.showSaveControls, true);
  assert.equal(editablePresentState.showRequestLocaleButton, false);
  assert.equal(editablePresentState.showClearLocaleRequestButton, false);
  assert.deepEqual(editablePresentState.localeEditSummaryState, {
    key: 'cardEditor.editingLocaleValue',
    locale: 'es-CL'
  });
});

test('syncLocalizedCardView keeps fallback reference visible but blanks editable fields for a missing locale', () => {
  const controller = Object.create(CardEditorController.prototype);
  let editorValue = '';

  controller.board = {
    ...createBoard(),
    aiLocalization: {
      provider: 'openai',
      hasApiKey: false,
      apiKeyLast4: null
    }
  };
  controller.card = createCard();
  controller.selectedLocale = 'ja';
  controller.mode = 'edit';
  controller.currentActorRole = 'editor';
  controller.canEditLocalizedContent = true;
  controller.titleInputTarget = { value: '' };
  controller.t = createTranslator('en');
  controller.ensureEditor = () => ({
    value(nextValue) {
      if (arguments.length > 0) {
        editorValue = nextValue;
      }

      return editorValue;
    }
  });
  controller.renderLocalizedReadSection = (localizedView) => {
    controller.lastLocalizedView = localizedView;
  };

  CardEditorController.prototype.syncLocalizedCardView.call(controller);

  assert.equal(controller.titleInputTarget.value, '');
  assert.equal(editorValue, '');
  assert.equal(controller.lastLocalizedView.variant?.title, 'Titulo por defecto');
  assert.equal(controller.lastLocalizedView.editableVariant?.title, '');
  assert.equal(controller.lastLocalizedView.localeActionHelpKey, 'cardEditor.manualLocaleHelp');
});

test('card editor EasyMDE config uses compact toolbar text with full accessible labels', () => {
  const originalWindow = globalThis.window;
  const easyMdeCalls = [];

  class EasyMDEStub {
    static toggleBold = Symbol('toggleBold');
    static toggleItalic = Symbol('toggleItalic');
    static toggleHeading2 = Symbol('toggleHeading2');
    static toggleUnorderedList = Symbol('toggleUnorderedList');
    static toggleCodeBlock = Symbol('toggleCodeBlock');

    constructor(options) {
      this.options = options;
      easyMdeCalls.push(options);
    }
  }

  globalThis.window = { EasyMDE: EasyMDEStub };

  try {
    const controller = Object.create(CardEditorController.prototype);
    controller.editor = null;
    controller.markdownInputTarget = { value: '' };
    controller.t = createTranslator('en');

    const editor = CardEditorController.prototype.ensureEditor.call(controller);
    const { toolbar } = editor.options;

    assert.ok(editor instanceof EasyMDEStub);
    assert.equal(easyMdeCalls.length, 1);
    assert.deepEqual(
      toolbar.map((item) =>
        item === '|'
          ? item
          : {
              name: item.name,
              text: item.text,
              title: item.title,
              action: item.action
            }
      ),
      [
        {
          name: 'bold',
          text: 'B',
          title: 'Bold',
          action: EasyMDEStub.toggleBold
        },
        {
          name: 'italic',
          text: 'I',
          title: 'Italic',
          action: EasyMDEStub.toggleItalic
        },
        {
          name: 'heading-2',
          text: 'H',
          title: 'Heading 2',
          action: EasyMDEStub.toggleHeading2
        },
        '|',
        {
          name: 'unordered-list',
          text: '•',
          title: 'Bulleted list',
          action: EasyMDEStub.toggleUnorderedList
        },
        '|',
        {
          name: 'code',
          text: 'Code',
          title: 'Code',
          action: EasyMDEStub.toggleCodeBlock
        }
      ]
    );
  } finally {
    if (typeof originalWindow === 'undefined') {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('card editor assigns an id to the EasyMDE hidden textarea without adding a name', () => {
  const originalWindow = globalThis.window;
  const inputField = { nodeName: 'TEXTAREA', id: '' };

  class EasyMDEStub {
    constructor(options) {
      this.options = options;
      this.codemirror = {
        getInputField() {
          return inputField;
        }
      };
    }
  }

  globalThis.window = { EasyMDE: EasyMDEStub };

  try {
    const controller = Object.create(CardEditorController.prototype);
    controller.editor = null;
    controller.markdownInputTarget = { value: '' };
    controller.t = createTranslator('en');

    CardEditorController.prototype.ensureEditor.call(controller);

    assert.equal(inputField.id, 'card-editor-details-markdown-codemirror-input');
    assert.equal(inputField.name, undefined);
  } finally {
    if (typeof originalWindow === 'undefined') {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test('card editor toolbar copy keeps compact text while localizing accessible labels', () => {
  const spanish = createTranslator('es-CL');
  const japanese = createTranslator('ja');

  assert.equal(spanish('cardEditor.markdownToolbar.bold.text'), 'B');
  assert.equal(spanish('cardEditor.markdownToolbar.bold.label'), 'Negrita');
  assert.equal(spanish('cardEditor.markdownToolbar.code.text'), 'Code');
  assert.equal(spanish('cardEditor.markdownToolbar.code.label'), 'Código');
  assert.equal(japanese('cardEditor.markdownToolbar.heading.text'), 'H');
  assert.equal(japanese('cardEditor.markdownToolbar.heading.label'), '見出し 2');
  assert.equal(japanese('cardEditor.markdownToolbar.bullets.text'), '•');
  assert.equal(japanese('cardEditor.markdownToolbar.bullets.label'), '箇条書きリスト');
});

function createBoard() {
  return {
    id: 'board_localized',
    languagePolicy: {
      sourceLocale: 'en',
      defaultLocale: 'es-CL',
      supportedLocales: ['en', 'es-CL', 'ja'],
      requiredLocales: ['en', 'ja']
    }
  };
}

function createBoardWithOpenAiKey(overrides = {}) {
  const baseBoard = createBoard();
  const overrideAiLocalization = overrides.aiLocalization ?? {};

  return {
    ...baseBoard,
    ...overrides,
    languagePolicy: overrides.languagePolicy ?? baseBoard.languagePolicy,
    aiLocalization: {
      provider: 'openai',
      hasApiKey: true,
      apiKeyLast4: '1234',
      ...overrideAiLocalization
    }
  };
}

function createBoardWithFrench() {
  return {
    ...createBoard(),
    languagePolicy: {
      ...createBoard().languagePolicy,
      supportedLocales: ['en', 'es-CL', 'ja', 'fr']
    }
  };
}

function createCardWithHumanJapaneseLocalization() {
  const card = createCard();

  card.contentByLocale.ja = {
    title: '手動の日本語タイトル',
    detailsMarkdown: '人が編集しました。',
    provenance: createCardContentProvenance({
      actor: { type: 'human', id: 'viewer_123' },
      timestamp: '2026-03-31T13:00:00.000Z',
      includesHumanInput: true
    })
  };
  delete card.localeRequests.ja;

  return card;
}

function createCard() {
  return {
    id: 'card_1',
    title: 'Legacy English source',
    detailsMarkdown: 'Legacy English details',
    contentByLocale: {
      en: {
        title: 'English source',
        detailsMarkdown: 'English details',
        provenance: createCardContentProvenance({
          actor: { type: 'human', id: 'viewer_123' },
          timestamp: '2026-03-31T09:00:00.000Z',
          includesHumanInput: true
        })
      },
      'es-CL': {
        title: 'Titulo por defecto',
        detailsMarkdown: 'Detalles por defecto',
        provenance: createCardContentProvenance({
          actor: { type: 'agent', id: 'translator_1' },
          timestamp: '2026-03-31T10:00:00.000Z',
          includesHumanInput: false
        })
      }
    },
    localeRequests: {
      ja: {
        locale: 'ja',
        requestedBy: {
          type: 'human',
          id: 'viewer_123'
        },
        requestedAt: '2026-03-31T12:30:00.000Z'
      }
    }
  };
}
