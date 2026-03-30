import test from 'node:test';
import assert from 'node:assert/strict';
import {
  markdownToHtml,
  markdownToPreviewText,
  renderMarkdownInto
} from '../public/js/lib/markdown.js';

test('markdownToHtml renders markdown and sanitizes the resulting HTML', () => {
  installMarkdownGlobals({
    renderedHtml: '<h1>Hello</h1><script>alert(1)</script>',
    sanitizedHtml: '<h1>Hello</h1>'
  });

  const result = markdownToHtml('# Hello');

  assert.equal(result, '<h1>Hello</h1>');
});

test('renderMarkdownInto replaces container contents with sanitized HTML', () => {
  installMarkdownGlobals({
    renderedHtml: '<p>Safe</p><script>alert(1)</script>',
    sanitizedHtml: '<p>Safe</p>'
  });
  const element = createContainerElement('stale');

  renderMarkdownInto(element, 'Safe');

  assert.equal(element.innerHTML, '<p>Safe</p>');
});

test('markdownToPreviewText uses sanitized HTML text, collapses whitespace, and trims', () => {
  installMarkdownGlobals({
    renderedHtml: '<p>Hello   <strong>world</strong></p>\n<p>  again </p>',
    sanitizedHtml: '<p>Hello   <strong>world</strong></p>\n<p>  again </p>'
  });

  const result = markdownToPreviewText('Hello world');

  assert.equal(result, 'Hello world again');
});

test('markdownToPreviewText truncates with a single ellipsis when needed', () => {
  installMarkdownGlobals({
    renderedHtml: '<p>Hello brave new world</p>',
    sanitizedHtml: '<p>Hello brave new world</p>'
  });

  const result = markdownToPreviewText('Hello brave new world', 12);

  assert.equal(result, 'Hello brave…');
});

test('markdownToPreviewText returns only an ellipsis when the limit is too small', () => {
  installMarkdownGlobals({
    renderedHtml: '<p>Hello brave new world</p>',
    sanitizedHtml: '<p>Hello brave new world</p>'
  });

  const result = markdownToPreviewText('Hello brave new world', 1);

  assert.equal(result, '…');
});

test('markdownToPreviewText returns an empty string when maxLength is zero', () => {
  installMarkdownGlobals({
    renderedHtml: '<p>Hello brave new world</p>',
    sanitizedHtml: '<p>Hello brave new world</p>'
  });

  const result = markdownToPreviewText('Hello brave new world', 0);

  assert.equal(result, '');
});

function installMarkdownGlobals({ renderedHtml, sanitizedHtml }) {
  global.window = {
    marked: {
      parse(input) {
        assert.equal(typeof input, 'string');
        return renderedHtml;
      }
    },
    DOMPurify: {
      sanitize(input) {
        assert.equal(input, renderedHtml);
        return sanitizedHtml;
      }
    }
  };

  global.document = {
    createElement() {
      return createContainerElement();
    }
  };
}

function createContainerElement(initialHtml = '') {
  let innerHtml = initialHtml;

  return {
    get innerHTML() {
      return innerHtml;
    },
    set innerHTML(value) {
      innerHtml = value;
    },
    get textContent() {
      return innerHtml.replace(/<[^>]*>/g, ' ');
    }
  };
}
