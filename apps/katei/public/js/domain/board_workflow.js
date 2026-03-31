const DEFAULT_BOARD_STAGES = Object.freeze([
  Object.freeze({ id: 'backlog', title: 'Backlog' }),
  Object.freeze({ id: 'doing', title: 'Doing' }),
  Object.freeze({ id: 'done', title: 'Done' }),
  Object.freeze({ id: 'archived', title: 'Archived' })
]);

export function createDefaultBoardStages() {
  return DEFAULT_BOARD_STAGES.map(({ id, title }) => ({ id, title }));
}

export function validateBoardStages(board) {
  if (!isPlainObject(board) || !Array.isArray(board.columnOrder) || !isPlainObject(board.columns)) {
    return false;
  }

  if (board.columnOrder.length !== DEFAULT_BOARD_STAGES.length) {
    return false;
  }

  for (let index = 0; index < DEFAULT_BOARD_STAGES.length; index += 1) {
    if (board.columnOrder[index] !== DEFAULT_BOARD_STAGES[index].id) {
      return false;
    }
  }

  for (const stage of DEFAULT_BOARD_STAGES) {
    const column = board.columns[stage.id];

    if (
      !isPlainObject(column) ||
      column.id !== stage.id ||
      column.title !== stage.title ||
      !Array.isArray(column.cardIds)
    ) {
      return false;
    }
  }

  return true;
}

export function validateBoardTemplates(board) {
  if (!isPlainObject(board)) {
    return false;
  }

  if (board.templates == null) {
    return true;
  }

  if (!Array.isArray(board.templates)) {
    return false;
  }

  const validStageIds = new Set(DEFAULT_BOARD_STAGES.map(({ id }) => id));
  const seenTemplateIds = new Set();

  for (const template of board.templates) {
    if (!isPlainObject(template) || !isNonEmptyString(template.id) || !isNonEmptyString(template.title)) {
      return false;
    }

    if (seenTemplateIds.has(template.id)) {
      return false;
    }

    seenTemplateIds.add(template.id);

    if (template.detailsMarkdown != null && typeof template.detailsMarkdown !== 'string') {
      return false;
    }

    if (template.priority != null && typeof template.priority !== 'string') {
      return false;
    }

    if (template.stageId != null && !validStageIds.has(template.stageId)) {
      return false;
    }
  }

  return true;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
