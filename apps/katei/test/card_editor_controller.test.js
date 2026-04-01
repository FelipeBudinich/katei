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

function createBoardWithFrench() {
  return {
    ...createBoard(),
    languagePolicy: {
      ...createBoard().languagePolicy,
      supportedLocales: ['en', 'es-CL', 'ja', 'fr']
    }
  };
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
