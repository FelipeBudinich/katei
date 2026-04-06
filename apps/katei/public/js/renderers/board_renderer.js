import { markdownToPreviewText } from '../lib/markdown.js';
import { stageSupportsAction } from '../domain/board_stage_actions.js';
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

export function getCardRenderState(board, card, uiLocale = null) {
  const content = getBoardCardContentVariant(card, board, { uiLocale });

  return {
    title: content?.title ?? '',
    previewText: markdownToPreviewText(content?.detailsMarkdown ?? '')
  };
}

export function renderBoardState({
  board,
  collapsedColumns = {},
  canReadBoard = true,
  canEditBoard = true,
  regions,
  templates,
  t = getBrowserTranslator(),
  dateTimeFormatter = createBrowserDateTimeFormatter()
}) {

  if (regions.boardTitle) {
    regions.boardTitle.textContent = board.title;
  }

  if (regions.desktopColumns) {
    regions.desktopColumns.hidden = !canReadBoard;
  }

  if (!canReadBoard) {
    replaceRegionChildren(regions.desktopColumns, []);
    return;
  }

  replaceRegionChildren(
    regions.desktopColumns,
    getBoardRenderStages(board).map(({ stageId, stage }) =>
      createStagePanel({
        board,
        stageId,
        stage,
        collapsedColumns,
        canReadBoard,
        canEditBoard,
        templates,
        t,
        uiLocale: t.locale,
        dateTimeFormatter
      })
    )
  );
}

function createStagePanel({ board, stageId, stage, collapsedColumns, canReadBoard, canEditBoard, templates, t, uiLocale, dateTimeFormatter }) {
  const columnNode = cloneTemplate(templates.columnTemplate);
  const isCollapsed = Boolean(collapsedColumns[stageId]);
  const shouldShowCreateButton = canEditBoard && stageSupportsAction(board, stageId, 'card.create');
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

  const toggleElements = Array.from(columnNode.querySelectorAll('[data-column-toggle]'));
  const createButton = columnNode.querySelector('[data-column-create]');
  const bodyElement = columnNode.querySelector('.column-panel-body');

  for (const toggleElement of toggleElements) {
    toggleElement.dataset.stageId = stage.id;
    toggleElement.dataset.columnId = stage.id;
    toggleElement.setAttribute('aria-expanded', String(!isCollapsed));
    toggleElement.disabled = !canReadBoard;
    toggleElement.setAttribute('aria-disabled', String(!canReadBoard));
  }

  if (createButton) {
    createButton.dataset.stageId = stage.id;
    createButton.dataset.columnId = stage.id;
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
    cardsContainer.innerHTML = '';

    if (stage.cardIds.length) {
      for (const cardId of sortCardIdsForColumn(board, stageId)) {
        cardsContainer.appendChild(
          createCardElement({
            board,
            card: board.cards[cardId],
            stageId,
            templates,
            uiLocale,
            dateTimeFormatter
          })
        );
      }
    }
  }

  return columnNode;
}

function createCardElement({ board, card, stageId, templates, uiLocale, dateTimeFormatter }) {
  const cardNode = cloneTemplate(templates.cardTemplate);
  const renderState = getCardRenderState(board, card, uiLocale);
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

  for (const triggerElement of cardNode.querySelectorAll('[data-card-id]')) {
    triggerElement.dataset.cardId = card.id;
  }

  for (const triggerElement of cardNode.querySelectorAll('[data-column-id], [data-stage-id]')) {
    triggerElement.dataset.stageId = stageId;
    triggerElement.dataset.columnId = stageId;
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
