import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyWorkspace, validateWorkspaceShape } from '../public/js/domain/workspace.js';
import {
  LocalWorkspaceRepository,
  WORKSPACE_STORAGE_PREFIX,
  createWorkspaceStorageKey
} from '../public/js/repositories/local_workspace_repository.js';

test('createWorkspaceStorageKey scopes workspace storage by verified Google sub', () => {
  assert.equal(createWorkspaceStorageKey('sub_123'), `${WORKSPACE_STORAGE_PREFIX}sub_123`);
});

test('LocalWorkspaceRepository reads and writes only the viewer-scoped workspace key', async () => {
  const legacyWorkspaceV2 = JSON.stringify({ legacy: 'v2' });
  const legacyWorkspaceV3 = JSON.stringify({ legacy: 'v3' });
  const storage = createStorageDouble({
    'katei.workspace.v2': legacyWorkspaceV2,
    'katei.workspace.v3:sub_123': legacyWorkspaceV3
  });
  const repository = new LocalWorkspaceRepository(storage, 'sub_123');
  const workspace = createEmptyWorkspace();
  const workspaceStorageKey = createWorkspaceStorageKey('sub_123');

  await repository.saveWorkspace(workspace);

  assert.deepEqual(JSON.parse(storage.getItem(workspaceStorageKey)), workspace);
  assert.equal(storage.getItem('katei.workspace.v2'), legacyWorkspaceV2);
  assert.equal(storage.getItem('katei.workspace.v3:sub_123'), legacyWorkspaceV3);
  assert.deepEqual(await repository.loadWorkspace(), workspace);
});

test('LocalWorkspaceRepository round-trips titled workspaces and keeps stored titles normalized', async () => {
  const storage = createStorageDouble();
  const repository = new LocalWorkspaceRepository(storage, 'sub_123');
  const workspace = createEmptyWorkspace();
  const workspaceStorageKey = createWorkspaceStorageKey('sub_123');

  workspace.title = '  Team archive  ';

  await repository.saveWorkspace(workspace);

  assert.deepEqual(JSON.parse(storage.getItem(workspaceStorageKey)).title, 'Team archive');

  const loadedWorkspace = await repository.loadWorkspace();

  assert.equal(loadedWorkspace.title, 'Team archive');
  assert.equal(validateWorkspaceShape(loadedWorkspace), true);
});

test('LocalWorkspaceRepository normalizes stored cards that still carry an unused legacy description field', async () => {
  const workspace = createEmptyWorkspace();
  const board = workspace.boards.main;

  board.cards.card_legacy = {
    id: 'card_legacy',
    title: 'Legacy card',
    description: 'Old field name',
    priority: 'important',
    createdAt: '2026-03-30T00:00:00.000Z',
    updatedAt: '2026-03-30T00:00:00.000Z'
  };
  board.stages.backlog.cardIds.push('card_legacy');
  const storage = createStorageDouble({
    [createWorkspaceStorageKey('sub_123')]: JSON.stringify(workspace)
  });
  const repository = new LocalWorkspaceRepository(storage, 'sub_123');
  const loadedWorkspace = await repository.loadWorkspace();

  assert.equal(validateWorkspaceShape(loadedWorkspace), true);
  assert.equal(loadedWorkspace.boards.main.cards.card_legacy.title, undefined);
  assert.equal(loadedWorkspace.boards.main.cards.card_legacy.contentByLocale.en.title, 'Legacy card');
  assert.equal(loadedWorkspace.boards.main.cards.card_legacy.contentByLocale.en.detailsMarkdown, '');
});

function createStorageDouble(initialEntries = {}) {
  const entries = new Map(Object.entries(initialEntries));

  return {
    getItem(key) {
      return entries.has(key) ? entries.get(key) : null;
    },
    setItem(key, value) {
      entries.set(key, String(value));
    },
    removeItem(key) {
      entries.delete(key);
    }
  };
}
