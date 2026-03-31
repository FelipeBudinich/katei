import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearCardLocaleRequest,
  getOpenLocalizationRequest,
  getRequestedMissingLocales,
  listCardLocaleStatuses,
  requestCardLocale
} from '../public/js/domain/card_localization_requests.js';

test('listCardLocaleStatuses derives present, requested, and missing locales from content and requests', () => {
  const board = {
    languagePolicy: {
      sourceLocale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en', 'es-CL', 'ja'],
      requiredLocales: ['en', 'es-CL', 'ja']
    }
  };
  const card = {
    id: 'card_1',
    title: 'Legacy English title',
    detailsMarkdown: 'Legacy English details',
    contentByLocale: {
      es_cl: {
        title: 'Titulo en español',
        detailsMarkdown: 'Detalle en español',
        provenance: null
      }
    },
    localeRequests: {
      ja: {
        locale: 'ja',
        requestedBy: { type: 'human', id: 'viewer_123' },
        requestedAt: '2026-03-31T12:00:00.000Z'
      }
    }
  };

  assert.deepEqual(listCardLocaleStatuses(board, card), [
    {
      locale: 'en',
      status: 'present',
      hasContent: true,
      isRequested: false,
      isSourceLocale: true,
      isDefaultLocale: true,
      isRequired: true,
      request: null
    },
    {
      locale: 'es-CL',
      status: 'present',
      hasContent: true,
      isRequested: false,
      isSourceLocale: false,
      isDefaultLocale: false,
      isRequired: true,
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
        requestedBy: { type: 'human', id: 'viewer_123' },
        requestedAt: '2026-03-31T12:00:00.000Z'
      }
    }
  ]);
  assert.deepEqual(getRequestedMissingLocales(board, card), ['ja']);
  assert.deepEqual(getOpenLocalizationRequest(card, 'JA'), {
    locale: 'ja',
    status: 'open',
    requestedBy: { type: 'human', id: 'viewer_123' },
    requestedAt: '2026-03-31T12:00:00.000Z'
  });
});

test('requestCardLocale and clearCardLocaleRequest manage canonical locale requests without mutating the source card', () => {
  const card = {
    id: 'card_2'
  };
  const requestedCard = requestCardLocale(
    card,
    'es_cl',
    { type: 'human', id: 'viewer_123' },
    '2026-03-31T13:00:00.000Z'
  );

  assert.equal(card.localeRequests, undefined);
  assert.deepEqual(requestedCard.localeRequests, {
    'es-CL': {
      locale: 'es-CL',
      status: 'open',
      requestedBy: { type: 'human', id: 'viewer_123' },
      requestedAt: '2026-03-31T13:00:00.000Z'
    }
  });

  const clearedCard = clearCardLocaleRequest(requestedCard, 'es-CL');

  assert.equal(clearedCard.localeRequests, undefined);
});
