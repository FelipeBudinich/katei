import { markdownToPreviewText } from '../lib/markdown.js';
import { recordRenderDebugEvent, startRenderDebugTimer } from '../lib/render_debug.js';
import { getBoardCardContentVariant } from '../domain/card_localization.js';
import { sortCardIdsForColumn } from '../domain/workspace_selectors.js';
import { createBrowserDateTimeFormatter, getBrowserTranslator } from '../i18n/browser.js';
import { formatCardCount } from '../i18n/workspace_labels.js';

const RENDER_KEY_SEPARATOR = '\u0000';
const previewTextCache = new Map();

export function getBoardRenderStages(board) {
  if (!Array.isArray(board?.stageOrder) || !board?.stages || typeof board.stages !== 'object') {
    return [];
  }

  return board.stageOrder
    .map((stageId) => ({
      stageId,
      stage: board.stages[stageId]
    }))
    .filter(({ stageId, stage }) => typeof stageId === 'string' && stage?.id === stageId);
}

export function getCardRenderState(board, card, uiLocale = null, options = {}) {
  const renderState = getCardElementRenderState(board, card, uiLocale, options);

  return {
    title: renderState.title,
    previewText: renderState.previewText
  };
}

export function renderBoardState({
  board,
  boardRenderKey = buildDefaultBoardRenderKey(board),
  collapsedColumns = {},
  canReadBoard = true,
  canEditBoard = true,
  regions,
  templates,
  t = getBrowserTranslator(),
  dateTimeFormatter = createBrowserDateTimeFormatter()
}) {
  const finishDebugTimer = startRenderDebugTimer('renderBoardState', {
    boardId: normalizeString(board?.id),
    boardRenderKey,
    canReadBoard,
    canEditBoard
  });
  const renderMetrics = createBoardRenderMetrics({
    board,
    boardRenderKey,
    canReadBoard
  });
  const previousRegionBoardRenderKey = getNodeDatasetValue(regions.desktopColumns, 'boardRenderKey');

  if (regions.boardTitle) {
    syncTextContent(regions.boardTitle, board.title);
  }

  if (regions.desktopColumns) {
    regions.desktopColumns.hidden = !canReadBoard;
    syncDatasetValue(regions.desktopColumns, 'boardRenderKey', boardRenderKey);
  }

  if (!canReadBoard) {
    renderMetrics.destructiveClears += 1;
    cleanupPreviewCacheForRegion(regions.desktopColumns);
    replaceRegionChildren(regions.desktopColumns, []);
    finishDebugTimer(renderMetrics);
    recordRenderDebugEvent('renderBoardState:summary', renderMetrics);
    return renderMetrics;
  }

  const desktopColumns = regions.desktopColumns;
  const shouldReuseLegacyStageNodes = !previousRegionBoardRenderKey || previousRegionBoardRenderKey === boardRenderKey;
  const existingStageNodesByKey = buildStageNodeMap(desktopColumns, {
    boardRenderKey,
    shouldReuseLegacyStageNodes
  });
  const desiredStageNodes = [];

  for (const { stageId, stage } of getBoardRenderStages(board)) {
    const stageRenderKey = createStageRenderKey(boardRenderKey, stageId);
    let columnNode = existingStageNodesByKey.get(stageRenderKey) ?? null;

    if (columnNode) {
      existingStageNodesByKey.delete(stageRenderKey);
      renderMetrics.reusedStagePanels += 1;
      updateStagePanel({
        columnNode,
        board,
        boardRenderKey,
        stageId,
        stage,
        collapsedColumns,
        canReadBoard,
        canEditBoard,
        templates,
        t,
        uiLocale: t.locale,
        dateTimeFormatter,
        renderMetrics
      });
    } else {
      columnNode = createStagePanel({
        board,
        boardRenderKey,
        stageId,
        stage,
        collapsedColumns,
        canReadBoard,
        canEditBoard,
        templates,
        t,
        uiLocale: t.locale,
        dateTimeFormatter,
        renderMetrics
      });
      renderMetrics.createdStagePanels += 1;
    }

    desiredStageNodes.push(columnNode);
  }

  for (const staleStageNode of existingStageNodesByKey.values()) {
    renderMetrics.removedStagePanels += 1;
    cleanupPreviewCacheForStageNode(staleStageNode);
    removeNode(staleStageNode);
  }

  reconcileChildren(desktopColumns, desiredStageNodes);

  finishDebugTimer(renderMetrics);
  recordRenderDebugEvent('renderBoardState:summary', renderMetrics);
  return renderMetrics;
}

function createStagePanel({
  board,
  boardRenderKey,
  stageId,
  stage,
  collapsedColumns,
  canReadBoard,
  canEditBoard,
  templates,
  t,
  uiLocale,
  dateTimeFormatter,
  renderMetrics
}) {
  const columnNode = cloneTemplate(templates.columnTemplate);

  recordRenderDebugEvent('createStagePanel', {
    boardId: normalizeString(board?.id),
    boardRenderKey,
    stageId
  });

  updateStagePanel({
    columnNode,
    board,
    boardRenderKey,
    stageId,
    stage,
    collapsedColumns,
    canReadBoard,
    canEditBoard,
    templates,
    t,
    uiLocale,
    dateTimeFormatter,
    renderMetrics
  });

  return columnNode;
}

function updateStagePanel({
  columnNode,
  board,
  boardRenderKey,
  stageId,
  stage,
  collapsedColumns,
  canReadBoard,
  canEditBoard,
  templates,
  t,
  uiLocale,
  dateTimeFormatter,
  renderMetrics
}) {
  const isCollapsed = Boolean(collapsedColumns[stageId]);
  const shouldShowCreateButton = canEditBoard && Array.isArray(stage?.actionIds) && stage.actionIds.includes('card.create');
  const stageRenderKey = createStageRenderKey(boardRenderKey, stageId);

  syncDatasetValue(columnNode, 'boardRenderKey', boardRenderKey);
  syncDatasetValue(columnNode, 'stageRenderKey', stageRenderKey);
  syncDatasetValue(columnNode, 'stageId', stage.id);
  syncDatasetValue(columnNode, 'columnId', stage.id);
  syncDatasetValue(columnNode, 'collapsed', String(isCollapsed));

  const titleElement = columnNode.querySelector('[data-column-field="title"]');
  if (titleElement) {
    syncTextContent(titleElement, stage.title);
  }

  const countElement = columnNode.querySelector('[data-column-field="count"]');
  if (countElement) {
    syncTextContent(countElement, String(stage.cardIds.length));
  }

  const countChipElement = columnNode.querySelector('.count-chip');
  if (countChipElement) {
    countChipElement.setAttribute('aria-label', formatCardCount(stage.cardIds.length, t));
  }

  const toggleElements = Array.from(columnNode.querySelectorAll('[data-column-toggle]'));
  const createButton = columnNode.querySelector('[data-column-create]');
  const bodyElement = columnNode.querySelector('.column-panel-body');

  for (const toggleElement of toggleElements) {
    syncDatasetValue(toggleElement, 'stageId', stage.id);
    syncDatasetValue(toggleElement, 'columnId', stage.id);
    toggleElement.setAttribute('aria-expanded', String(!isCollapsed));
    toggleElement.disabled = !canReadBoard;
    toggleElement.setAttribute('aria-disabled', String(!canReadBoard));
  }

  if (createButton) {
    syncDatasetValue(createButton, 'stageId', stage.id);
    syncDatasetValue(createButton, 'columnId', stage.id);
    createButton.hidden = !shouldShowCreateButton;
    createButton.disabled = !shouldShowCreateButton;
    createButton.setAttribute('aria-disabled', String(!shouldShowCreateButton));
  }

  if (bodyElement) {
    bodyElement.id = `column-panel-body-${stage.id}`;
    bodyElement.hidden = isCollapsed || stage.cardIds.length === 0;

    for (const toggleElement of toggleElements) {
      toggleElement.setAttribute('aria-controls', bodyElement.id);
    }
  }

  const cardsContainer = columnNode.querySelector('[data-column-cards]');

  if (cardsContainer) {
    const previousCardsBoardRenderKey = getNodeDatasetValue(cardsContainer, 'boardRenderKey');
    syncDatasetValue(cardsContainer, 'boardRenderKey', boardRenderKey);
    syncStageCards({
      cardsContainer,
      previousCardsBoardRenderKey,
      board,
      boardRenderKey,
      stageId,
      templates,
      uiLocale,
      dateTimeFormatter,
      renderMetrics
    });
  }

  columnNode.__stageRenderStateKey = createStageRenderStateKey({
    boardRenderKey,
    stageId,
    collapsed: isCollapsed,
    cardCount: stage.cardIds.length,
    title: stage.title,
    canReadBoard,
    shouldShowCreateButton
  });
}

function syncStageCards({
  cardsContainer,
  previousCardsBoardRenderKey,
  board,
  boardRenderKey,
  stageId,
  templates,
  uiLocale,
  dateTimeFormatter,
  renderMetrics
}) {
  const shouldReuseLegacyCardNodes = !previousCardsBoardRenderKey || previousCardsBoardRenderKey === boardRenderKey;
  const existingCardNodesByKey = buildCardNodeMap(cardsContainer, {
    boardRenderKey,
    shouldReuseLegacyCardNodes
  });
  const desiredCardNodes = [];

  for (const cardId of sortCardIdsForColumn(board, stageId)) {
    const card = board.cards[cardId];

    if (!card) {
      continue;
    }

    const cardRenderKey = createCardRenderKey(boardRenderKey, card.id);
    let cardNode = existingCardNodesByKey.get(cardRenderKey) ?? null;

    if (cardNode) {
      existingCardNodesByKey.delete(cardRenderKey);
      renderMetrics.reusedCardNodes += 1;
      updateCardElement({
        cardNode,
        board,
        boardRenderKey,
        card,
        stageId,
        uiLocale,
        dateTimeFormatter,
        renderMetrics
      });
    } else {
      cardNode = createCardElement({
        board,
        boardRenderKey,
        card,
        stageId,
        templates,
        uiLocale,
        dateTimeFormatter,
        renderMetrics
      });
      renderMetrics.createdCardNodes += 1;
    }

    desiredCardNodes.push(cardNode);
  }

  for (const staleCardNode of existingCardNodesByKey.values()) {
    renderMetrics.removedCardNodes += 1;
    cleanupPreviewCacheForCardNode(staleCardNode);
    removeNode(staleCardNode);
  }

  reconcileChildren(cardsContainer, desiredCardNodes);
}

function createCardElement({ board, boardRenderKey, card, stageId, templates, uiLocale, dateTimeFormatter, renderMetrics }) {
  const cardNode = cloneTemplate(templates.cardTemplate);

  recordRenderDebugEvent('createCardElement', {
    boardId: normalizeString(board?.id),
    boardRenderKey,
    stageId,
    cardId: normalizeString(card?.id)
  });

  updateCardElement({
    cardNode,
    board,
    boardRenderKey,
    card,
    stageId,
    uiLocale,
    dateTimeFormatter,
    renderMetrics
  });

  return cardNode;
}

function updateCardElement({ cardNode, board, boardRenderKey, card, stageId, uiLocale, dateTimeFormatter, renderMetrics }) {
  const renderState = getCardElementRenderState(board, card, uiLocale, {
    boardRenderKey,
    renderMetrics
  });
  const cardRenderKey = createCardRenderKey(boardRenderKey, card.id);
  const nextRenderStateKey = createCardRenderStateKey({
    boardRenderKey,
    cardId: card.id,
    stageId,
    uiLocale,
    title: renderState.title,
    detailsMarkdown: renderState.detailsMarkdown,
    priority: card.priority,
    updatedAt: card.updatedAt
  });

  if (cardNode.__renderStateKey === nextRenderStateKey) {
    renderMetrics.skippedCardUpdates += 1;
    return;
  }

  cleanupPreviewCacheForCardNode(cardNode, renderState.previewCacheKey);

  syncDatasetValue(cardNode, 'boardRenderKey', boardRenderKey);
  syncDatasetValue(cardNode, 'cardRenderKey', cardRenderKey);
  syncDatasetValue(cardNode, 'cardId', card.id);
  syncDatasetValue(cardNode, 'stageId', stageId);
  syncDatasetValue(cardNode, 'columnId', stageId);

  if (card.priority) {
    syncDatasetValue(cardNode, 'priority', card.priority);
  } else if (cardNode?.dataset) {
    delete cardNode.dataset.priority;
  }

  const titleElement = cardNode.querySelector('[data-card-field="title"]');
  if (titleElement) {
    syncTextContent(titleElement, renderState.title);
  }

  const previewElement = cardNode.querySelector('[data-card-field="preview"]');
  if (previewElement) {
    syncTextContent(previewElement, renderState.previewText);
    previewElement.classList.toggle('hidden', !renderState.previewText);
  }

  const metaElement = cardNode.querySelector('[data-card-field="meta"]');
  if (metaElement) {
    syncTextContent(metaElement, dateTimeFormatter.format(new Date(card.updatedAt)));
  }

  for (const triggerElement of cardNode.querySelectorAll('[data-card-id]')) {
    syncDatasetValue(triggerElement, 'cardId', card.id);
  }

  for (const triggerElement of cardNode.querySelectorAll('[data-column-id], [data-stage-id]')) {
    syncDatasetValue(triggerElement, 'stageId', stageId);
    syncDatasetValue(triggerElement, 'columnId', stageId);
  }

  cardNode.__previewCacheKey = renderState.previewCacheKey;
  cardNode.__renderStateKey = nextRenderStateKey;
}

function getCardElementRenderState(board, card, uiLocale = null, {
  boardRenderKey = buildDefaultBoardRenderKey(board),
  renderMetrics = null
} = {}) {
  const content = getBoardCardContentVariant(card, board, { uiLocale });
  const title = content?.title ?? '';
  const detailsMarkdown = content?.detailsMarkdown ?? '';
  const previewCacheKey = createPreviewCacheKey({
    boardRenderKey,
    cardId: card?.id,
    uiLocale,
    detailsMarkdown
  });

  return {
    title,
    detailsMarkdown,
    previewCacheKey,
    previewText: getMemoizedPreviewText(previewCacheKey, detailsMarkdown, renderMetrics)
  };
}

function getMemoizedPreviewText(cacheKey, detailsMarkdown, renderMetrics) {
  if (previewTextCache.has(cacheKey)) {
    if (renderMetrics) {
      renderMetrics.previewCacheHits += 1;
    }

    recordRenderDebugEvent('renderBoardState:preview-cache-hit', {
      cacheKey
    });

    return previewTextCache.get(cacheKey);
  }

  if (renderMetrics) {
    renderMetrics.previewCacheMisses += 1;
  }

  recordRenderDebugEvent('renderBoardState:preview-cache-miss', {
    cacheKey
  });

  const previewText = markdownToPreviewText(detailsMarkdown ?? '');
  previewTextCache.set(cacheKey, previewText);
  return previewText;
}

function buildStageNodeMap(region, { boardRenderKey, shouldReuseLegacyStageNodes }) {
  const stageNodesByKey = new Map();

  for (const childNode of getChildNodes(region)) {
    const stageRenderKey = getNodeDatasetValue(childNode, 'stageRenderKey')
      || (shouldReuseLegacyStageNodes
        ? createStageRenderKey(boardRenderKey, getNodeDatasetValue(childNode, 'stageId'))
        : null);

    if (stageRenderKey) {
      stageNodesByKey.set(stageRenderKey, childNode);
    }
  }

  return stageNodesByKey;
}

function buildCardNodeMap(cardsContainer, { boardRenderKey, shouldReuseLegacyCardNodes }) {
  const cardNodesByKey = new Map();

  for (const childNode of getChildNodes(cardsContainer)) {
    const cardRenderKey = getNodeDatasetValue(childNode, 'cardRenderKey')
      || (shouldReuseLegacyCardNodes
        ? createCardRenderKey(boardRenderKey, getNodeDatasetValue(childNode, 'cardId'))
        : null);

    if (cardRenderKey) {
      cardNodesByKey.set(cardRenderKey, childNode);
    }
  }

  return cardNodesByKey;
}

function reconcileChildren(parentNode, desiredChildNodes) {
  if (!parentNode) {
    return;
  }

  desiredChildNodes.forEach((childNode, index) => {
    const currentChildNodes = getChildNodes(parentNode);
    const currentChildNode = currentChildNodes[index] ?? null;

    if (currentChildNode === childNode) {
      return;
    }

    insertNodeBefore(parentNode, childNode, currentChildNode);
  });
}

function getChildNodes(parentNode) {
  if (!parentNode) {
    return [];
  }

  if (Array.isArray(parentNode.children)) {
    return [...parentNode.children];
  }

  return Array.from(parentNode.children ?? []);
}

function insertNodeBefore(parentNode, childNode, referenceNode) {
  if (!parentNode || !childNode) {
    return;
  }

  if (typeof parentNode.insertBefore === 'function') {
    parentNode.insertBefore(childNode, referenceNode ?? null);
    return;
  }

  if (typeof parentNode.appendChild === 'function' && referenceNode == null) {
    parentNode.appendChild(childNode);
    return;
  }

  if (Array.isArray(parentNode.children)) {
    detachNodeFromParent(childNode);
    const insertionIndex = referenceNode ? parentNode.children.indexOf(referenceNode) : -1;

    if (insertionIndex === -1) {
      parentNode.children.push(childNode);
    } else {
      parentNode.children.splice(insertionIndex, 0, childNode);
    }

    childNode.parentNode = parentNode;
  }
}

function removeNode(node) {
  if (!node) {
    return;
  }

  if (typeof node.remove === 'function') {
    node.remove();
    return;
  }

  detachNodeFromParent(node);
}

function detachNodeFromParent(node) {
  const parentNode = node?.parentNode ?? null;

  if (!parentNode || !Array.isArray(parentNode.children)) {
    return;
  }

  const childIndex = parentNode.children.indexOf(node);

  if (childIndex >= 0) {
    parentNode.children.splice(childIndex, 1);
  }

  node.parentNode = null;
}

function cleanupPreviewCacheForRegion(region) {
  for (const stageNode of getChildNodes(region)) {
    cleanupPreviewCacheForStageNode(stageNode);
  }
}

function cleanupPreviewCacheForStageNode(stageNode) {
  const cardsContainer = stageNode?.querySelector?.('[data-column-cards]') ?? stageNode?.cardsContainer ?? null;

  for (const cardNode of getChildNodes(cardsContainer)) {
    cleanupPreviewCacheForCardNode(cardNode);
  }
}

function cleanupPreviewCacheForCardNode(cardNode, nextPreviewCacheKey = null) {
  if (typeof cardNode?.__previewCacheKey !== 'string') {
    return;
  }

  if (cardNode.__previewCacheKey !== nextPreviewCacheKey) {
    previewTextCache.delete(cardNode.__previewCacheKey);
  }
}

function replaceRegionChildren(region, nodes) {
  if (!region) {
    return;
  }

  region.replaceChildren(...nodes);
}

function syncTextContent(element, value) {
  if (!element) {
    return;
  }

  if (element.textContent !== value) {
    element.textContent = value;
  }
}

function syncDatasetValue(node, key, value) {
  if (!node) {
    return;
  }

  if (!node.dataset) {
    node.dataset = {};
  }

  node.dataset[key] = String(value ?? '');
}

function getNodeDatasetValue(node, key) {
  const value = node?.dataset?.[key];
  return typeof value === 'string' && value ? value : null;
}

function createBoardRenderMetrics({ board, boardRenderKey, canReadBoard }) {
  return {
    boardId: normalizeString(board?.id),
    boardRenderKey,
    canReadBoard,
    stageCount: Array.isArray(board?.stageOrder) ? board.stageOrder.length : 0,
    cardCount: Object.keys(board?.cards ?? {}).length,
    createdStagePanels: 0,
    reusedStagePanels: 0,
    removedStagePanels: 0,
    createdCardNodes: 0,
    reusedCardNodes: 0,
    removedCardNodes: 0,
    skippedCardUpdates: 0,
    previewCacheHits: 0,
    previewCacheMisses: 0,
    destructiveClears: 0
  };
}

function createStageRenderKey(boardRenderKey, stageId) {
  return [boardRenderKey, normalizeString(stageId)].join(RENDER_KEY_SEPARATOR);
}

function createCardRenderKey(boardRenderKey, cardId) {
  return [boardRenderKey, normalizeString(cardId)].join(RENDER_KEY_SEPARATOR);
}

function createPreviewCacheKey({ boardRenderKey, cardId, uiLocale, detailsMarkdown }) {
  return [
    boardRenderKey,
    normalizeString(cardId),
    normalizeString(uiLocale),
    String(detailsMarkdown ?? '')
  ].join(RENDER_KEY_SEPARATOR);
}

function createCardRenderStateKey({ boardRenderKey, cardId, stageId, uiLocale, title, detailsMarkdown, priority, updatedAt }) {
  return [
    boardRenderKey,
    normalizeString(cardId),
    normalizeString(stageId),
    normalizeString(uiLocale),
    String(title ?? ''),
    String(detailsMarkdown ?? ''),
    normalizeString(priority),
    normalizeString(updatedAt)
  ].join(RENDER_KEY_SEPARATOR);
}

function createStageRenderStateKey({ boardRenderKey, stageId, collapsed, cardCount, title, canReadBoard, shouldShowCreateButton }) {
  return [
    boardRenderKey,
    normalizeString(stageId),
    String(collapsed),
    String(cardCount),
    String(title ?? ''),
    String(canReadBoard),
    String(shouldShowCreateButton)
  ].join(RENDER_KEY_SEPARATOR);
}

function buildDefaultBoardRenderKey(board) {
  return normalizeString(board?.id);
}

function cloneTemplate(template) {
  return template.content.firstElementChild.cloneNode(true);
}

function normalizeString(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}
