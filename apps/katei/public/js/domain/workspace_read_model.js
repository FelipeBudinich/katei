import { createDefaultBoardLanguagePolicy } from './board_language_policy.js';
import { createDefaultBoardStages, createDefaultBoardTemplates } from './board_workflow.js';

export const WORKSPACE_VERSION = 5;
export const WORKSPACE_ID = 'main';
export const STORAGE_KEY = 'katei.workspace.v5';
export const APP_TITLE = '過程 (katei)';
export const DEFAULT_BOARD_ID = 'main';
export const DEFAULT_BOARD_TITLE = '過程';
export const COLUMN_DEFINITIONS = Object.freeze(
  createDefaultBoardStages().map(({ id, title }) => Object.freeze({ id, title }))
);
export const COLUMN_ORDER = Object.freeze(COLUMN_DEFINITIONS.map(({ id }) => id));
export const COLUMN_TITLES = Object.freeze(
  Object.fromEntries(COLUMN_DEFINITIONS.map(({ id, title }) => [id, title]))
);
export const PRIORITY_ORDER = Object.freeze(['urgent', 'important', 'normal']);
export const PRIORITY_LABELS = Object.freeze({
  urgent: 'Urgent',
  important: 'Important',
  normal: 'Normal'
});
export const PRIORITY_DEFINITIONS = Object.freeze(
  PRIORITY_ORDER.map((id) => ({ id, label: PRIORITY_LABELS[id] }))
);
export const DEFAULT_PRIORITY = 'important';
export const DEFAULT_WORKSPACE_STATE = Object.freeze(createEmptyWorkspace());

export function createEmptyWorkspace() {
  const timestamp = createTimestamp();
  const board = createWorkspaceBoard({
    id: DEFAULT_BOARD_ID,
    title: DEFAULT_BOARD_TITLE,
    createdAt: timestamp,
    updatedAt: timestamp
  });

  return {
    version: WORKSPACE_VERSION,
    workspaceId: WORKSPACE_ID,
    ui: {
      activeBoardId: board.id,
      collapsedColumnsByBoard: {
        [board.id]: createCollapsedColumns()
      }
    },
    boardOrder: [board.id],
    boards: {
      [board.id]: board
    }
  };
}

export function createWorkspaceBoard({ id, title, createdAt, updatedAt }) {
  const stages = {};

  for (const stage of createDefaultBoardStages()) {
    stages[stage.id] = stage;
  }

  return {
    id: String(id),
    title: String(title),
    createdAt,
    updatedAt,
    stageOrder: Object.keys(stages),
    stages,
    templates: createDefaultBoardTemplates(),
    languagePolicy: createDefaultBoardLanguagePolicy(),
    cards: {}
  };
}

export function createCollapsedColumns(stageIds = COLUMN_ORDER) {
  const collapsedColumns = {};

  for (const stageId of stageIds) {
    collapsedColumns[stageId] = false;
  }

  return collapsedColumns;
}

export function cloneWorkspace(workspace) {
  return structuredClone(workspace);
}

function createTimestamp() {
  return new Date().toISOString();
}
