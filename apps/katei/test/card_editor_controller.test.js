import test from 'node:test';
import assert from 'node:assert/strict';
import { createCardContentProvenance } from '../public/js/domain/card_localization.js';
import {
  createLocalizedCardEditorUiState,
  createLocalizedCardViewState
} from '../public/js/controllers/card_editor_locale_view.js';

test('locale dropdown state uses the board supported locales and defaults to the board default locale', () => {
  const board = createBoard();
  const card = createCard();

  const state = createLocalizedCardViewState({ board, card });

  assert.deepEqual(state.supportedLocales, ['en', 'es-CL', 'ja']);
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
