import { createBoardCollaboration } from './board_collaboration.js';
import { createDefaultBoardAiLocalization } from './board_ai_localization.js';
import { createDefaultBoardLanguagePolicy } from './board_language_policy.js';
import { createDefaultBoardLocalizationGlossary } from './board_localization_glossary.js';
import { createDefaultBoardStages, createDefaultBoardTemplates } from './board_workflow.js';

export const WORKSPACE_VERSION = 6;
export const WORKSPACE_ID = 'main';
export const STORAGE_KEY = 'katei.workspace.v6';
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

export function createEmptyWorkspace({ workspaceId = WORKSPACE_ID, title = undefined, creator = undefined } = {}) {
  const owner = normalizeWorkspaceActor(creator) ?? createDefaultWorkspaceCreator();
  const timestamp = createTimestamp();
  const board = createWorkspaceBoard({
    id: DEFAULT_BOARD_ID,
    title: DEFAULT_BOARD_TITLE,
    createdAt: timestamp,
    updatedAt: timestamp,
    creator: owner
  });
  const normalizedTitle = normalizeWorkspaceTitle(title);

  return {
    version: WORKSPACE_VERSION,
    workspaceId: normalizeWorkspaceId(workspaceId),
    ...(normalizedTitle ? { title: normalizedTitle } : {}),
    ownership: createWorkspaceOwnership({
      owner
    }),
    access: createWorkspaceAccess(),
    ui: {
      activeBoardId: board.id
    },
    boardOrder: [board.id],
    boards: {
      [board.id]: board
    }
  };
}

export function createWorkspaceOwnership({ owner = createDefaultWorkspaceCreator() } = {}) {
  return {
    owner: normalizeWorkspaceActor(owner) ?? createDefaultWorkspaceCreator()
  };
}

export function createWorkspaceAccess({ kind = 'private' } = {}) {
  return {
    kind: normalizeWorkspaceAccessKind(kind) ?? 'private'
  };
}

export function createWorkspaceBoard({ id, title, createdAt, updatedAt, creator = createDefaultBoardCreator() }) {
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
    collaboration: createBoardCollaboration({
      creator,
      joinedAt: createdAt
    }),
    aiLocalization: createDefaultBoardAiLocalization(),
    languagePolicy: createDefaultBoardLanguagePolicy(),
    localizationGlossary: createDefaultBoardLocalizationGlossary(),
    cards: {}
  };
}

export function cloneWorkspace(workspace) {
  return structuredClone(workspace);
}

export function normalizeWorkspaceTitle(title) {
  const normalizedTitle = normalizeWorkspaceString(title);
  return normalizedTitle || null;
}

function createTimestamp() {
  return new Date().toISOString();
}

function createDefaultWorkspaceCreator() {
  return {
    type: 'system',
    id: 'workspace-bootstrap'
  };
}

function createDefaultBoardCreator() {
  return createDefaultWorkspaceCreator();
}

function normalizeWorkspaceId(workspaceId) {
  const normalizedWorkspaceId = typeof workspaceId === 'string' ? workspaceId.trim() : '';

  if (!normalizedWorkspaceId) {
    throw new Error('Workspace id is required.');
  }

  return normalizedWorkspaceId;
}

function normalizeWorkspaceActor(actor) {
  if (!actor || typeof actor !== 'object' || Array.isArray(actor)) {
    return null;
  }

  const type = typeof actor.type === 'string' ? actor.type.trim().toLowerCase() : '';
  const id = typeof actor.id === 'string' ? actor.id.trim() : '';
  const email = normalizeWorkspaceEmail(actor.email ?? null);
  const displayName = normalizeWorkspaceString(actor.displayName ?? actor.name ?? null);

  if (!['human', 'agent', 'system'].includes(type) || !id) {
    return null;
  }

  return {
    type,
    id,
    ...(email ? { email } : {}),
    ...(displayName ? { displayName } : {})
  };
}

function normalizeWorkspaceAccessKind(kind) {
  const normalizedKind = normalizeWorkspaceString(kind).toLowerCase();
  return normalizedKind || null;
}

function normalizeWorkspaceEmail(email) {
  const normalizedEmail = normalizeWorkspaceString(email).toLowerCase();
  return normalizedEmail.includes('@') ? normalizedEmail : '';
}

function normalizeWorkspaceString(value) {
  return typeof value === 'string' ? value.trim() : '';
}
