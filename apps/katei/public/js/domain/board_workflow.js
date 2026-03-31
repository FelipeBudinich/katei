const DEFAULT_BOARD_STAGES = Object.freeze([
  Object.freeze({
    id: 'backlog',
    title: 'Backlog',
    allowedTransitionStageIds: Object.freeze(['doing', 'done']),
    templateIds: Object.freeze([])
  }),
  Object.freeze({
    id: 'doing',
    title: 'Doing',
    allowedTransitionStageIds: Object.freeze(['backlog', 'done']),
    templateIds: Object.freeze([])
  }),
  Object.freeze({
    id: 'done',
    title: 'Done',
    allowedTransitionStageIds: Object.freeze(['backlog', 'doing', 'archived']),
    templateIds: Object.freeze([])
  }),
  Object.freeze({
    id: 'archived',
    title: 'Archived',
    allowedTransitionStageIds: Object.freeze(['backlog', 'doing', 'done']),
    templateIds: Object.freeze([])
  })
]);

export function createDefaultBoardStages() {
  return DEFAULT_BOARD_STAGES.map(({ id, title, allowedTransitionStageIds, templateIds }) => ({
    id,
    title,
    cardIds: [],
    allowedTransitionStageIds: [...allowedTransitionStageIds],
    templateIds: [...templateIds]
  }));
}

export function createDefaultBoardTemplates() {
  return [];
}

export function validateBoardStages(board) {
  if (!isPlainObject(board) || !Array.isArray(board.stageOrder) || !isPlainObject(board.stages)) {
    return false;
  }

  if (board.stageOrder.length < 1 || Object.keys(board.stages).length !== board.stageOrder.length) {
    return false;
  }

  const validStageIds = new Set();

  for (const stageId of board.stageOrder) {
    if (!isNonEmptyString(stageId) || validStageIds.has(stageId)) {
      return false;
    }

    validStageIds.add(stageId);
  }

  for (const stageId of board.stageOrder) {
    const stage = board.stages[stageId];

    if (
      !isPlainObject(stage) ||
      stage.id !== stageId ||
      !isNonEmptyString(stage.title) ||
      !isStringArray(stage.cardIds) ||
      !isUniqueStringArray(stage.allowedTransitionStageIds) ||
      !isUniqueStringArray(stage.templateIds)
    ) {
      return false;
    }

    if (stage.allowedTransitionStageIds.some((targetStageId) => !validStageIds.has(targetStageId))) {
      return false;
    }
  }

  return true;
}

export function validateBoardTemplates(board) {
  if (!isPlainObject(board) || !Array.isArray(board.stageOrder) || !isPlainObject(board.stages)) {
    return false;
  }

  if (!Array.isArray(board.templates)) {
    return false;
  }

  const validStageIds = new Set(board.stageOrder);
  const seenTemplateIds = new Set();
  const templateById = new Map();

  for (const template of board.templates) {
    if (
      !isPlainObject(template) ||
      !isNonEmptyString(template.id) ||
      !isNonEmptyString(template.title) ||
      !isNonEmptyString(template.initialStageId)
    ) {
      return false;
    }

    if (seenTemplateIds.has(template.id)) {
      return false;
    }

    seenTemplateIds.add(template.id);
    templateById.set(template.id, template);

    if (!validStageIds.has(template.initialStageId)) {
      return false;
    }
  }

  for (const stageId of board.stageOrder) {
    const stage = board.stages[stageId];
    const seenStageTemplateIds = new Set();

    if (!isPlainObject(stage) || !Array.isArray(stage.templateIds)) {
      return false;
    }

    for (const templateId of stage.templateIds) {
      if (!isNonEmptyString(templateId) || seenStageTemplateIds.has(templateId)) {
        return false;
      }

      if (!templateById.has(templateId) || templateById.get(templateId).initialStageId !== stageId) {
        return false;
      }

      seenStageTemplateIds.add(templateId);
    }
  }

  return true;
}

export function projectWorkspaceWithLegacyColumns(workspace) {
  if (!isPlainObject(workspace) || !isPlainObject(workspace.boards)) {
    return workspace;
  }

  const projectedWorkspace = structuredClone(workspace);

  for (const board of Object.values(projectedWorkspace.boards)) {
    if (!isPlainObject(board) || !Array.isArray(board.stageOrder) || !isPlainObject(board.stages)) {
      continue;
    }

    board.columnOrder = [...board.stageOrder];
    board.columns = structuredClone(board.stages);
  }

  return projectedWorkspace;
}

export function stripLegacyColumnAliasesFromWorkspace(workspace) {
  if (!isPlainObject(workspace) || !isPlainObject(workspace.boards)) {
    return workspace;
  }

  const normalizedWorkspace = structuredClone(workspace);

  for (const board of Object.values(normalizedWorkspace.boards)) {
    if (!isPlainObject(board)) {
      continue;
    }

    delete board.columnOrder;
    delete board.columns;
  }

  return normalizedWorkspace;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isUniqueStringArray(value) {
  return isStringArray(value) && new Set(value).size === value.length && value.every(isNonEmptyString);
}
