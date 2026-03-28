import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyWorkspace } from '../public/js/domain/workspace.js';
import {
  LocalWorkspaceRepository,
  WORKSPACE_STORAGE_PREFIX,
  createWorkspaceStorageKey
} from '../public/js/repositories/local_workspace_repository.js';

test('createWorkspaceStorageKey scopes workspace storage by verified Google sub', () => {
  assert.equal(createWorkspaceStorageKey('sub_123'), `${WORKSPACE_STORAGE_PREFIX}sub_123`);
});

test('LocalWorkspaceRepository reads and writes only the viewer-scoped workspace key', async () => {
  const storage = createStorageDouble({
    'katei.workspace.v2': JSON.stringify({ legacy: true })
  });
  const repository = new LocalWorkspaceRepository(storage, 'sub_123');
  const workspace = createEmptyWorkspace();

  await repository.saveWorkspace(workspace);

  assert.deepEqual(JSON.parse(storage.getItem('katei.workspace.v3:sub_123')), workspace);
  assert.equal(storage.getItem('katei.workspace.v2'), JSON.stringify({ legacy: true }));
  assert.deepEqual(await repository.loadWorkspace(), workspace);
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
