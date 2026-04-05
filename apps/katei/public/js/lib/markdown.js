import { startRenderDebugTimer } from './render_debug.js';

const PREVIEW_ELLIPSIS = '…';

export function markdownToHtml(markdown) {
  const renderedHtml = window.marked.parse(markdown ?? '');
  return window.DOMPurify.sanitize(renderedHtml);
}

export function renderMarkdownInto(element, markdown) {
  element.innerHTML = markdownToHtml(markdown);
}

export function markdownToPreviewText(markdown, maxLength = 160) {
  const finishDebugTimer = startRenderDebugTimer('markdownToPreviewText', {
    maxLength
  });
  const html = markdownToHtml(markdown);
  const previewContainer = getDetachedContainer();
  previewContainer.innerHTML = html;

  const previewText = collapseWhitespace(previewContainer.textContent ?? '');
  const normalizedMaxLength = normalizeMaxLength(maxLength);

  if (previewText.length <= normalizedMaxLength) {
    finishDebugTimer({
      previewLength: previewText.length,
      truncated: false
    });
    return previewText;
  }

  if (normalizedMaxLength === 0) {
    finishDebugTimer({
      previewLength: 0,
      truncated: true
    });
    return '';
  }

  if (normalizedMaxLength <= PREVIEW_ELLIPSIS.length) {
    finishDebugTimer({
      previewLength: PREVIEW_ELLIPSIS.length,
      truncated: true
    });
    return PREVIEW_ELLIPSIS;
  }

  const nextPreviewText = `${previewText.slice(0, normalizedMaxLength - PREVIEW_ELLIPSIS.length).trimEnd()}${PREVIEW_ELLIPSIS}`;

  finishDebugTimer({
    previewLength: nextPreviewText.length,
    truncated: previewText.length > normalizedMaxLength
  });

  return nextPreviewText;
}

function getDetachedContainer() {
  return document.createElement('div');
}

function collapseWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeMaxLength(maxLength) {
  if (!Number.isFinite(maxLength)) {
    return 160;
  }

  return Math.max(0, Math.floor(maxLength));
}
