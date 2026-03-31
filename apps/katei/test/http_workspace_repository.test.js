import test from 'node:test';
import assert from 'node:assert/strict';
import { createCard, createEmptyWorkspace } from '../public/js/domain/workspace.js';
import { readLocalV4Workspace } from '../public/js/lib/workspace_import.js';
import {
  HttpWorkspaceRepository,
  WORKSPACE_CONFLICT_ERROR_MESSAGE
} from '../public/js/repositories/http_workspace_repository.js';
import { createWorkspaceStorageKey } from '../public/js/repositories/local_workspace_repository.js';

test('HttpWorkspaceRepository loads workspace snapshots from the server API', async () => {
  const workspace = createEmptyWorkspace();
  const fetchDouble = createFetchDouble([
    createJsonResponse(createWorkspaceApiPayload(workspace))
  ]);
  const repository = new HttpWorkspaceRepository({
    fetchImpl: fetchDouble.fetch,
    viewerSub: 'sub_123',
    storage: null
  });

  const loadedWorkspace = await repository.loadWorkspace();

  assert.deepEqual(loadedWorkspace, workspace);
  assert.deepEqual(repository.meta, {
    revision: 0,
    updatedAt: '2026-04-03T10:00:00.000Z',
    lastChangedBy: null,
    isPristine: true
  });
  assert.deepEqual(fetchDouble.calls, [
    {
      url: '/api/workspace',
      options: {
        credentials: 'same-origin',
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      }
    }
  ]);
});

test('HttpWorkspaceRepository saves workspace snapshots to the server API', async () => {
  const workspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Ship launch checklist',
    detailsMarkdown: 'Owner: Mina',
    priority: 'urgent'
  });
  const fetchDouble = createFetchDouble([
    createJsonResponse(createWorkspaceApiPayload(workspace, {
      revision: 2,
      updatedAt: '2026-04-03T12:00:00.000Z',
      lastChangedBy: 'sub_123',
      isPristine: false
    }))
  ]);
  const repository = new HttpWorkspaceRepository({
    fetchImpl: fetchDouble.fetch,
    viewerSub: 'sub_123',
    storage: null
  });

  const savedWorkspace = await repository.saveWorkspace(workspace);

  assert.deepEqual(savedWorkspace, workspace);
  assert.deepEqual(repository.meta, {
    revision: 2,
    updatedAt: '2026-04-03T12:00:00.000Z',
    lastChangedBy: 'sub_123',
    isPristine: false
  });
  assert.equal(fetchDouble.calls[0].url, '/api/workspace');
  assert.equal(fetchDouble.calls[0].options.method, 'PUT');
  assert.equal(fetchDouble.calls[0].options.credentials, 'same-origin');
  assert.equal(fetchDouble.calls[0].options.headers.Accept, 'application/json');
  assert.equal(fetchDouble.calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(fetchDouble.calls[0].options.body), {
    workspace,
    expectedRevision: 0
  });
});

test('HttpWorkspaceRepository imports valid v4 local data when the server record is pristine', async () => {
  const importedWorkspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Imported task',
    detailsMarkdown: 'Migrated from local storage',
    priority: 'important'
  });
  const pristineServerWorkspace = createEmptyWorkspace();
  const storage = createStorageDouble({
    [createWorkspaceStorageKey('sub_123')]: JSON.stringify(importedWorkspace)
  });
  const fetchDouble = createFetchDouble([
    createJsonResponse(createWorkspaceApiPayload(pristineServerWorkspace)),
    createJsonResponse(createWorkspaceApiPayload(importedWorkspace, {
      revision: 1,
      updatedAt: '2026-04-03T10:30:00.000Z',
      lastChangedBy: 'sub_123',
      isPristine: false
    })),
    createJsonResponse(createWorkspaceApiPayload(importedWorkspace, {
      revision: 1,
      updatedAt: '2026-04-03T10:30:00.000Z',
      lastChangedBy: 'sub_123',
      isPristine: false
    })),
    createJsonResponse(createWorkspaceApiPayload(importedWorkspace, {
      revision: 1,
      updatedAt: '2026-04-03T10:30:00.000Z',
      lastChangedBy: 'sub_123',
      isPristine: false
    }))
  ]);
  const repository = new HttpWorkspaceRepository({
    fetchImpl: fetchDouble.fetch,
    viewerSub: 'sub_123',
    storage
  });

  const loadedWorkspace = await repository.loadWorkspace();
  const canonicalWorkspace = await repository.loadWorkspace();

  assert.deepEqual(loadedWorkspace, importedWorkspace);
  assert.deepEqual(canonicalWorkspace, importedWorkspace);
  assert.equal(fetchDouble.calls.length, 4);
  assert.equal(fetchDouble.calls[0].url, '/api/workspace');
  assert.equal(fetchDouble.calls[1].url, '/api/workspace/import');
  assert.equal(fetchDouble.calls[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(fetchDouble.calls[1].options.body), {
    workspace: importedWorkspace
  });
  assert.equal(fetchDouble.calls[2].url, '/api/workspace');
  assert.equal(fetchDouble.calls[3].url, '/api/workspace');
});

test('HttpWorkspaceRepository safely ignores a repeated import attempt once the server rejects it', async () => {
  const localWorkspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Local v4 task',
    detailsMarkdown: 'Attempted import source',
    priority: 'important'
  });
  const canonicalServerWorkspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Canonical server task',
    detailsMarkdown: 'Already imported earlier',
    priority: 'urgent'
  });
  const storage = createStorageDouble({
    [createWorkspaceStorageKey('sub_123')]: JSON.stringify(localWorkspace)
  });
  const fetchDouble = createFetchDouble([
    createJsonResponse(createWorkspaceApiPayload(createEmptyWorkspace())),
    createJsonResponse({
      ok: false,
      error: 'Workspace import is only allowed while the server workspace is still pristine.'
    }, 409),
    createJsonResponse(createWorkspaceApiPayload(canonicalServerWorkspace, {
      revision: 1,
      updatedAt: '2026-04-03T10:45:00.000Z',
      lastChangedBy: 'sub_123',
      isPristine: false
    }))
  ]);
  const repository = new HttpWorkspaceRepository({
    fetchImpl: fetchDouble.fetch,
    viewerSub: 'sub_123',
    storage
  });

  const loadedWorkspace = await repository.loadWorkspace();

  assert.deepEqual(loadedWorkspace, canonicalServerWorkspace);
  assert.equal(fetchDouble.calls.length, 3);
  assert.equal(fetchDouble.calls[0].url, '/api/workspace');
  assert.equal(fetchDouble.calls[1].url, '/api/workspace/import');
  assert.equal(fetchDouble.calls[2].url, '/api/workspace');
});

test('HttpWorkspaceRepository skips import when local v4 data is invalid', async () => {
  const serverWorkspace = createEmptyWorkspace();
  const storage = createStorageDouble({
    [createWorkspaceStorageKey('sub_123')]: JSON.stringify({ version: -1 })
  });
  const fetchDouble = createFetchDouble([
    createJsonResponse(createWorkspaceApiPayload(serverWorkspace))
  ]);
  const repository = new HttpWorkspaceRepository({
    fetchImpl: fetchDouble.fetch,
    viewerSub: 'sub_123',
    storage
  });

  const loadedWorkspace = await repository.loadWorkspace();

  assert.deepEqual(loadedWorkspace, serverWorkspace);
  assert.equal(readLocalV4Workspace(storage, 'sub_123'), null);
  assert.equal(fetchDouble.calls.length, 1);
  assert.equal(fetchDouble.calls[0].url, '/api/workspace');
});

test('HttpWorkspaceRepository prefers bootstrap payload on first load and consumes it once', async () => {
  const bootstrapWorkspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Bootstrap task',
    detailsMarkdown: 'Server-rendered before client hydration',
    priority: 'important'
  });
  const networkWorkspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Fetched task',
    detailsMarkdown: 'Loaded after bootstrap is consumed',
    priority: 'urgent'
  });
  const fetchDouble = createFetchDouble([
    createJsonResponse(createWorkspaceApiPayload(networkWorkspace, {
      revision: 4,
      updatedAt: '2026-04-03T12:00:00.000Z',
      lastChangedBy: 'sub_123',
      isPristine: false
    }))
  ]);
  const repository = new HttpWorkspaceRepository({
    fetchImpl: fetchDouble.fetch,
    viewerSub: 'sub_123',
    storage: null,
    document: createDocumentDouble({
      'workspace-bootstrap': JSON.stringify(
        createWorkspaceApiPayload(bootstrapWorkspace, {
          revision: 3,
          updatedAt: '2026-04-03T11:00:00.000Z',
          lastChangedBy: 'sub_123',
          isPristine: false
        })
      )
    })
  });

  const firstLoad = await repository.loadWorkspace();

  assert.deepEqual(firstLoad, bootstrapWorkspace);
  assert.deepEqual(repository.meta, {
    revision: 3,
    updatedAt: '2026-04-03T11:00:00.000Z',
    lastChangedBy: 'sub_123',
    isPristine: false
  });
  assert.equal(repository.revision, 3);
  assert.equal(fetchDouble.calls.length, 0);

  const secondLoad = await repository.loadWorkspace();

  assert.deepEqual(secondLoad, networkWorkspace);
  assert.equal(fetchDouble.calls.length, 1);
  assert.equal(fetchDouble.calls[0].url, '/api/workspace');
});

test('HttpWorkspaceRepository sends the bootstrapped revision on save', async () => {
  const workspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Bootstrapped save',
    detailsMarkdown: 'Revision-aware save',
    priority: 'important'
  });
  const repository = new HttpWorkspaceRepository({
    fetchImpl: createFetchDouble([
      createJsonResponse(createWorkspaceApiPayload(workspace, {
        revision: 6,
        updatedAt: '2026-04-03T13:00:00.000Z',
        lastChangedBy: 'sub_123',
        isPristine: false
      }))
    ]).fetch,
    viewerSub: 'sub_123',
    storage: null,
    document: createDocumentDouble({
      'workspace-bootstrap': JSON.stringify(
        createWorkspaceApiPayload(createEmptyWorkspace(), {
          revision: 5,
          updatedAt: '2026-04-03T12:00:00.000Z',
          lastChangedBy: 'sub_123',
          isPristine: false
        })
      )
    })
  });

  await repository.loadWorkspace();
  const fetchDouble = createFetchDouble([
    createJsonResponse(createWorkspaceApiPayload(workspace, {
      revision: 6,
      updatedAt: '2026-04-03T13:00:00.000Z',
      lastChangedBy: 'sub_123',
      isPristine: false
    }))
  ]);
  repository.fetchImpl = fetchDouble.fetch;

  await repository.saveWorkspace(workspace);

  assert.deepEqual(JSON.parse(fetchDouble.calls[0].options.body), {
    workspace,
    expectedRevision: 5
  });
  assert.equal(repository.revision, 6);
});

test('HttpWorkspaceRepository applyCommand sends expectedRevision and updates local meta state', async () => {
  const commandWorkspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Command result',
    detailsMarkdown: 'Applied by the server',
    priority: 'urgent'
  });
  const repository = new HttpWorkspaceRepository({
    fetchImpl: createFetchDouble([
      createJsonResponse(createWorkspaceApiPayload(commandWorkspace, {
        revision: 8,
        updatedAt: '2026-04-03T15:00:00.000Z',
        lastChangedBy: 'sub_123',
        isPristine: false
      }, {
        clientMutationId: 'm1',
        type: 'card.create',
        noOp: false,
        cardId: 'card_server_1'
      }))
    ]).fetch,
    viewerSub: 'sub_123',
    storage: null,
    document: createDocumentDouble({
      'workspace-bootstrap': JSON.stringify(
        createWorkspaceApiPayload(createEmptyWorkspace(), {
          revision: 7,
          updatedAt: '2026-04-03T14:00:00.000Z',
          lastChangedBy: 'sub_123',
          isPristine: false
        })
      )
    })
  });

  await repository.loadWorkspace();
  const fetchDouble = createFetchDouble([
    createJsonResponse(createWorkspaceApiPayload(commandWorkspace, {
      revision: 8,
      updatedAt: '2026-04-03T15:00:00.000Z',
      lastChangedBy: 'sub_123',
      isPristine: false
    }, {
      clientMutationId: 'm1',
      type: 'card.create',
      noOp: false,
      cardId: 'card_server_1'
    }))
  ]);
  repository.fetchImpl = fetchDouble.fetch;

  const payload = await repository.applyCommand({
    clientMutationId: 'm1',
    type: 'card.create',
    payload: {
      boardId: 'main',
      title: 'Command result',
      priority: 'urgent'
    }
  });

  assert.deepEqual(payload.result, {
    clientMutationId: 'm1',
    type: 'card.create',
    noOp: false,
    cardId: 'card_server_1'
  });
  assert.deepEqual(repository.meta, {
    revision: 8,
    updatedAt: '2026-04-03T15:00:00.000Z',
    lastChangedBy: 'sub_123',
    isPristine: false
  });
  assert.equal(repository.revision, 8);
  assert.equal(fetchDouble.calls[0].url, '/api/workspace/commands');
  assert.equal(fetchDouble.calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(fetchDouble.calls[0].options.body), {
    command: {
      clientMutationId: 'm1',
      type: 'card.create',
      payload: {
        boardId: 'main',
        title: 'Command result',
        priority: 'urgent'
      }
    },
    expectedRevision: 7
  });
});

test('HttpWorkspaceRepository surfaces revision conflicts with a friendly error', async () => {
  const workspace = createEmptyWorkspace();
  const fetchDouble = createFetchDouble([
    createJsonResponse({
      ok: false,
      error: 'Workspace revision mismatch.'
    }, 409)
  ]);
  const repository = new HttpWorkspaceRepository({
    fetchImpl: fetchDouble.fetch,
    viewerSub: 'sub_123',
    storage: null
  });

  await assert.rejects(
    repository.saveWorkspace(workspace),
    {
      message: WORKSPACE_CONFLICT_ERROR_MESSAGE,
      status: 409
    }
  );
});

test('HttpWorkspaceRepository rejects invalid applyCommand responses', async () => {
  const fetchDouble = createFetchDouble([
    createJsonResponse({
      ok: true,
      workspace: {
        version: -1
      },
      meta: {
        revision: 1,
        updatedAt: '2026-04-03T15:00:00.000Z',
        lastChangedBy: 'sub_123',
        isPristine: false
      },
      result: {
        clientMutationId: 'm1',
        type: 'board.create',
        noOp: false
      }
    })
  ]);
  const repository = new HttpWorkspaceRepository({
    fetchImpl: fetchDouble.fetch,
    viewerSub: 'sub_123',
    storage: null
  });

  await assert.rejects(
    repository.applyCommand({
      clientMutationId: 'm1',
      type: 'board.create',
      payload: {
        title: 'Broken response'
      }
    }),
    {
      message: 'Workspace API returned an invalid workspace.'
    }
  );
});

function createWorkspaceApiPayload(workspace, meta = {}, result = undefined) {
  const payload = {
    ok: true,
    workspace,
    meta: {
      revision: meta.revision ?? 0,
      updatedAt: meta.updatedAt ?? '2026-04-03T10:00:00.000Z',
      lastChangedBy: meta.lastChangedBy ?? null,
      isPristine: meta.isPristine ?? true
    }
  };

  if (result !== undefined) {
    payload.result = result;
  }

  return payload;
}

function createJsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return structuredClone(body);
    }
  };
}

function createFetchDouble(responses) {
  const queue = [...responses];
  const calls = [];

  return {
    calls,
    async fetch(url, options = {}) {
      calls.push({
        url,
        options: structuredClone(options)
      });

      if (queue.length === 0) {
        throw new Error(`Unexpected fetch call for ${url}.`);
      }

      return queue.shift();
    }
  };
}

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

function createDocumentDouble(initialTextById = {}) {
  const elements = new Map(
    Object.entries(initialTextById).map(([id, textContent]) => [id, { textContent }])
  );

  return {
    getElementById(id) {
      return elements.get(id) ?? null;
    }
  };
}
