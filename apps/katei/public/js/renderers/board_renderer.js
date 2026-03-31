import { markdownToPreviewText } from '../lib/markdown.js';
import { getBoardCardContentVariant } from '../domain/card_localization.js';
import { sortCardIdsForColumn } from '../domain/workspace_selectors.js';
import { createBrowserDateTimeFormatter, getBrowserTranslator } from '../i18n/browser.js';
import { formatCardCount } from '../i18n/workspace_labels.js';

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

export function getCardRenderState(board, card) {
  const content = getBoardCardContentVariant(card, board);

  return {
    title: content?.title ?? '',
    previewText: markdownToPreviewText(content?.detailsMarkdown ?? '')
  };
}

export function renderBoardState({
  board,
  collapsedColumns = {},
  regions,
  templates,
  t = getBrowserTranslator(),
  dateTimeFormatter = createBrowserDateTimeFormatter()
}) {

  if (regions.boardTitle) {
    regions.boardTitle.textContent = board.title;
  }

  replaceRegionChildren(
    regions.desktopColumns,
    getBoardRenderStages(board).map(({ stageId, stage }) =>
      createStagePanel({ board, stageId, stage, collapsedColumns, templates, t, dateTimeFormatter })
    )
  );
}

function createStagePanel({ board, stageId, stage, collapsedColumns, templates, t, dateTimeFormatter }) {
  const columnNode = cloneTemplate(templates.columnTemplate);
  const isCollapsed = Boolean(collapsedColumns[stageId]);
  columnNode.dataset.stageId = stage.id;
  columnNode.dataset.columnId = stage.id;
  columnNode.dataset.collapsed = String(isCollapsed);

  const titleElement = columnNode.querySelector('[data-column-field="title"]');
  if (titleElement) {
    titleElement.textContent = stage.title;
  }

  const countElement = columnNode.querySelector('[data-column-field="count"]');
  if (countElement) {
    countElement.textContent = String(stage.cardIds.length);
  }

  const countChipElement = columnNode.querySelector('.count-chip');
  if (countChipElement) {
    countChipElement.setAttribute('aria-label', formatCardCount(stage.cardIds.length, t));
  }

  const toggleElement = columnNode.querySelector('[data-column-toggle]');
  const bodyElement = columnNode.querySelector('.column-panel-body');

  if (toggleElement) {
    toggleElement.dataset.stageId = stage.id;
    toggleElement.dataset.columnId = stage.id;
    toggleElement.setAttribute('aria-expanded', String(!isCollapsed));
  }

  if (bodyElement) {
    bodyElement.id = `column-panel-body-${stage.id}`;
    bodyElement.hidden = isCollapsed || stage.cardIds.length === 0;

    if (toggleElement) {
      toggleElement.setAttribute('aria-controls', bodyElement.id);
    }
  }

  const cardsContainer = columnNode.querySelector('[data-column-cards]');

  if (cardsContainer) {
    cardsContainer.innerHTML = '';

    if (stage.cardIds.length) {
      for (const cardId of sortCardIdsForColumn(board, stageId)) {
        cardsContainer.appendChild(
          createCardElement({
            board,
            card: board.cards[cardId],
            stageId,
            templates,
            dateTimeFormatter
          })
        );
      }
    }
  }

  return columnNode;
}

function createCardElement({ board, card, stageId, templates, dateTimeFormatter }) {
  const cardNode = cloneTemplate(templates.cardTemplate);
  const renderState = getCardRenderState(board, card);
  cardNode.dataset.cardId = card.id;
  cardNode.dataset.stageId = stageId;
  cardNode.dataset.columnId = stageId;

  if (card.priority) {
    cardNode.dataset.priority = card.priority;
  } else {
    delete cardNode.dataset.priority;
  }

  const titleElement = cardNode.querySelector('[data-card-field="title"]');
  if (titleElement) {
    titleElement.textContent = renderState.title;
  }

  const previewElement = cardNode.querySelector('[data-card-field="preview"]');
  if (previewElement) {
    previewElement.textContent = renderState.previewText;
    previewElement.classList.toggle('hidden', !renderState.previewText);
  }

  const metaElement = cardNode.querySelector('[data-card-field="meta"]');
  if (metaElement) {
    metaElement.textContent = dateTimeFormatter.format(new Date(card.updatedAt));
  }

  for (const button of cardNode.querySelectorAll('[data-card-id]')) {
    button.dataset.cardId = card.id;
  }

  for (const button of cardNode.querySelectorAll('[data-column-id], [data-stage-id]')) {
    button.dataset.stageId = stageId;
    button.dataset.columnId = stageId;
  }

  return cardNode;
}

function replaceRegionChildren(region, nodes) {
  if (!region) {
    return;
  }

  region.replaceChildren(...nodes);
}

function cloneTemplate(template) {
  return template.content.firstElementChild.cloneNode(true);
}
