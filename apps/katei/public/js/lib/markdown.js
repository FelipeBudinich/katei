const PREVIEW_ELLIPSIS = '…';
const BLOCK_TEXT_BREAK_PATTERN = /<\/?(?:article|aside|blockquote|div|figcaption|figure|footer|h[1-6]|header|hr|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi;
const BREAK_TAG_PATTERN = /<br\s*\/?>/gi;
const LIST_ITEM_OPEN_PATTERN = /<li\b[^>]*>/gi;
const LIST_ITEM_CLOSE_PATTERN = /<\/li>/gi;

export function markdownToHtml(markdown) {
  const renderedHtml = window.marked.parse(markdown ?? '');
  return window.DOMPurify.sanitize(renderedHtml);
}

export function renderMarkdownInto(element, markdown) {
  element.innerHTML = markdownToHtml(markdown);
}

export function markdownToPlainText(markdown) {
  const plainTextContainer = getDetachedContainer();
  plainTextContainer.innerHTML = prepareHtmlForPlainText(markdownToHtml(markdown));
  return normalizePlainText(plainTextContainer.textContent ?? '');
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

function prepareHtmlForPlainText(html) {
  return String(html ?? '')
    .replace(BREAK_TAG_PATTERN, '\n')
    .replace(LIST_ITEM_OPEN_PATTERN, '\n- ')
    .replace(LIST_ITEM_CLOSE_PATTERN, '')
    .replace(BLOCK_TEXT_BREAK_PATTERN, '\n');
}

function normalizePlainText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeMaxLength(maxLength) {
  if (!Number.isFinite(maxLength)) {
    return 160;
  }

  return Math.max(0, Math.floor(maxLength));
}
