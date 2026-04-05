const PREVIEW_ELLIPSIS = '…';

export function markdownToHtml(markdown) {
  const renderedHtml = window.marked.parse(markdown ?? '');
  return window.DOMPurify.sanitize(renderedHtml);
}

export function renderMarkdownInto(element, markdown) {
  element.innerHTML = markdownToHtml(markdown);
}

export function markdownToPreviewText(markdown, maxLength = 160) {
  const html = markdownToHtml(markdown);
  const previewContainer = getDetachedContainer();
  previewContainer.innerHTML = html;

  const previewText = collapseWhitespace(previewContainer.textContent ?? '');
  const normalizedMaxLength = normalizeMaxLength(maxLength);

  if (previewText.length <= normalizedMaxLength) {
    return previewText;
  }

  if (normalizedMaxLength === 0) {
    return '';
  }

  if (normalizedMaxLength <= PREVIEW_ELLIPSIS.length) {
    return PREVIEW_ELLIPSIS;
  }

  return `${previewText.slice(0, normalizedMaxLength - PREVIEW_ELLIPSIS.length).trimEnd()}${PREVIEW_ELLIPSIS}`;
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
