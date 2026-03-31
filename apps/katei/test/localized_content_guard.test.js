import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isHumanAuthoredVariant,
  shouldBlockAutomatedLocaleOverwrite
} from '../public/js/domain/localized_content_guard.js';

test('isHumanAuthoredVariant distinguishes human-authored and automation-authored localized variants', () => {
  assert.equal(
    isHumanAuthoredVariant({
      title: 'Human title',
      detailsMarkdown: 'Human details',
      provenance: {
        actor: { type: 'human', id: 'viewer_123' },
        timestamp: '2026-03-31T09:00:00.000Z',
        includesHumanInput: true
      }
    }),
    true
  );

  assert.equal(
    isHumanAuthoredVariant({
      title: 'Legacy title',
      detailsMarkdown: 'Legacy details',
      provenance: null
    }),
    true
  );

  assert.equal(
    isHumanAuthoredVariant({
      title: 'Machine title',
      detailsMarkdown: 'Machine details',
      provenance: {
        actor: { type: 'agent', id: 'translator_1' },
        timestamp: '2026-03-31T10:00:00.000Z',
        includesHumanInput: false
      }
    }),
    false
  );

  assert.equal(
    isHumanAuthoredVariant({
      title: '',
      detailsMarkdown: '',
      provenance: {
        actor: { type: 'human', id: 'viewer_123' },
        timestamp: '2026-03-31T12:00:00.000Z',
        includesHumanInput: true
      }
    }),
    false
  );
});

test('shouldBlockAutomatedLocaleOverwrite blocks only automated overwrites of human-authored variants', () => {
  const existingHumanVariant = {
    title: 'Human title',
    detailsMarkdown: 'Human details',
    provenance: {
      actor: { type: 'human', id: 'viewer_123' },
      timestamp: '2026-03-31T09:00:00.000Z',
      includesHumanInput: true
    }
  };
  const existingAutomatedVariant = {
    title: 'Machine title',
    detailsMarkdown: 'Machine details',
    provenance: {
      actor: { type: 'agent', id: 'translator_1' },
      timestamp: '2026-03-31T10:00:00.000Z',
      includesHumanInput: false
    }
  };

  assert.equal(
    shouldBlockAutomatedLocaleOverwrite({
      existingVariant: existingHumanVariant,
      incomingProvenance: {
        actor: { type: 'agent', id: 'translator_2' },
        timestamp: '2026-03-31T11:00:00.000Z',
        includesHumanInput: false
      }
    }),
    true
  );

  assert.equal(
    shouldBlockAutomatedLocaleOverwrite({
      existingVariant: {
        title: '',
        detailsMarkdown: '',
        provenance: {
          actor: { type: 'human', id: 'viewer_123' },
          timestamp: '2026-03-31T09:00:00.000Z',
          includesHumanInput: true
        }
      },
      incomingProvenance: {
        actor: { type: 'agent', id: 'translator_2' },
        timestamp: '2026-03-31T11:00:00.000Z',
        includesHumanInput: false
      }
    }),
    false
  );

  assert.equal(
    shouldBlockAutomatedLocaleOverwrite({
      existingVariant: existingAutomatedVariant,
      incomingProvenance: {
        actor: { type: 'agent', id: 'translator_2' },
        timestamp: '2026-03-31T11:00:00.000Z',
        includesHumanInput: false
      }
    }),
    false
  );

  assert.equal(
    shouldBlockAutomatedLocaleOverwrite({
      existingVariant: existingHumanVariant,
      incomingProvenance: {
        actor: { type: 'system', id: 'browser-mutation' },
        timestamp: '2026-03-31T11:00:00.000Z',
        includesHumanInput: true
      }
    }),
    false
  );
});
