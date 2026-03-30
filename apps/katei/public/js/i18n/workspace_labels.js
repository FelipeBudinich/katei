const COLUMN_MESSAGE_KEYS = Object.freeze({
  backlog: 'workspace.columns.backlog',
  doing: 'workspace.columns.doing',
  done: 'workspace.columns.done',
  archived: 'workspace.columns.archived'
});

const PRIORITY_MESSAGE_KEYS = Object.freeze({
  urgent: 'workspace.priorities.urgent',
  important: 'workspace.priorities.important',
  normal: 'workspace.priorities.normal'
});

export function getColumnDisplayLabel(columnId, t) {
  return getFixedWorkspaceLabel(columnId, COLUMN_MESSAGE_KEYS, t);
}

export function getPriorityDisplayLabel(priorityId, t) {
  return getFixedWorkspaceLabel(priorityId, PRIORITY_MESSAGE_KEYS, t);
}

export function formatCardCount(count, t) {
  return t('workspace.cardCount', { count });
}

function getFixedWorkspaceLabel(id, keyMap, t) {
  const messageKey = keyMap[id];

  if (!messageKey || typeof t !== 'function') {
    return String(id);
  }

  return t(messageKey);
}
