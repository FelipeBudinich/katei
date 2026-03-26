import { sortCardIdsForColumn } from '../domain/workspace.js';

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
});

export function renderBoardState({ board, collapsedColumns = {}, regions, templates }) {
  if (regions.boardTitle) {
    regions.boardTitle.textContent = board.title;
  }

  replaceRegionChildren(
    regions.desktopColumns,
    board.columnOrder.map((columnId) => createColumnPanel({ board, columnId, collapsedColumns, templates }))
  );
}

function createColumnPanel({ board, columnId, collapsedColumns, templates }) {
  const column = board.columns[columnId];
  const columnNode = cloneTemplate(templates.columnTemplate);
  const isCollapsed = Boolean(collapsedColumns[columnId]);
  columnNode.dataset.columnId = column.id;
  columnNode.dataset.collapsed = String(isCollapsed);

  const titleElement = columnNode.querySelector('[data-column-field="title"]');
  if (titleElement) {
    titleElement.textContent = column.title;
  }

  const countElement = columnNode.querySelector('[data-column-field="count"]');
  if (countElement) {
    countElement.textContent = String(column.cardIds.length);
  }

  const countChipElement = columnNode.querySelector('.count-chip');
  if (countChipElement) {
    countChipElement.setAttribute('aria-label', `${column.cardIds.length} cards`);
  }

  const toggleElement = columnNode.querySelector('[data-column-toggle]');
  const bodyElement = columnNode.querySelector('.column-panel-body');

  if (toggleElement) {
    toggleElement.dataset.columnId = column.id;
    toggleElement.setAttribute('aria-expanded', String(!isCollapsed));
  }

  if (bodyElement) {
    bodyElement.id = `column-panel-body-${column.id}`;
    bodyElement.hidden = isCollapsed || column.cardIds.length === 0;

    if (toggleElement) {
      toggleElement.setAttribute('aria-controls', bodyElement.id);
    }
  }

  const cardsContainer = columnNode.querySelector('[data-column-cards]');

  if (cardsContainer) {
    cardsContainer.innerHTML = '';

    if (column.cardIds.length) {
      for (const cardId of sortCardIdsForColumn(board, columnId)) {
        cardsContainer.appendChild(
          createCardElement({
            board,
            card: board.cards[cardId],
            columnId,
            templates
          })
        );
      }
    }
  }

  return columnNode;
}

function createCardElement({ board, card, columnId, templates }) {
  const cardNode = cloneTemplate(templates.cardTemplate);
  cardNode.dataset.cardId = card.id;
  cardNode.dataset.columnId = columnId;

  if (card.priority) {
    cardNode.dataset.priority = card.priority;
  } else {
    delete cardNode.dataset.priority;
  }

  const titleElement = cardNode.querySelector('[data-card-field="title"]');
  if (titleElement) {
    titleElement.textContent = card.title;
  }

  const descriptionElement = cardNode.querySelector('[data-card-field="description"]');
  if (descriptionElement) {
    descriptionElement.textContent = card.description;
    descriptionElement.classList.toggle('hidden', !card.description);
  }

  const metaElement = cardNode.querySelector('[data-card-field="meta"]');
  if (metaElement) {
    metaElement.textContent = timestampFormatter.format(new Date(card.updatedAt));
  }

  for (const button of cardNode.querySelectorAll('[data-card-id]')) {
    button.dataset.cardId = card.id;
  }

  for (const button of cardNode.querySelectorAll('[data-column-id]')) {
    button.dataset.columnId = columnId;
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
