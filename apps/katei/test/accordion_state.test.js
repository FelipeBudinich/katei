import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAccordionItemStates,
  getAccordionNextOpenIndex,
  normalizeAccordionOpenIndex
} from '../public/js/controllers/accordion_state.js';

test('normalizeAccordionOpenIndex falls back to the first panel for invalid indices', () => {
  assert.equal(normalizeAccordionOpenIndex(undefined, 2), 0);
  assert.equal(normalizeAccordionOpenIndex(Number.NaN, 2), 0);
  assert.equal(normalizeAccordionOpenIndex(-1, 2), 0);
  assert.equal(normalizeAccordionOpenIndex(3, 2), 0);
});

test('getAccordionNextOpenIndex keeps one panel open and switches when a closed trigger is chosen', () => {
  assert.equal(
    getAccordionNextOpenIndex({
      currentOpenIndex: 0,
      requestedIndex: 0,
      itemCount: 2
    }),
    0
  );
  assert.equal(
    getAccordionNextOpenIndex({
      currentOpenIndex: 0,
      requestedIndex: 1,
      itemCount: 2
    }),
    1
  );
});

test('createAccordionItemStates marks exactly one panel open and hides the others', () => {
  assert.deepEqual(
    createAccordionItemStates({
      itemCount: 2,
      openIndex: 1
    }),
    [
      {
        index: 0,
        isOpen: false,
        ariaExpanded: 'false',
        hidden: true
      },
      {
        index: 1,
        isOpen: true,
        ariaExpanded: 'true',
        hidden: false
      }
    ]
  );
});
