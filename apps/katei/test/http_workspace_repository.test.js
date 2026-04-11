import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCard,
  createEmptyWorkspace,
  migrateWorkspaceSnapshot,
  validateWorkspaceShape
} from '../public/js/domain/workspace.js';
import {
  createLegacyV4WorkspaceStorageKey,
  readLocalV4Workspace
} from '../public/js/lib/workspace_import.js';
import {
  HttpWorkspaceRepository,
  WORKSPACE_CONFLICT_ERROR_MESSAGE
} from '../public/js/repositories/http_workspace_repository.js';

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
  assert.equal(repository.activeWorkspaceId, workspace.workspaceId);
  assert.equal(repository.isHomeWorkspace, true);
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

test('HttpWorkspaceRepository normalizes older workspace snapshots returned by the server API', async () => {
  const fetchDouble = createFetchDouble([
    createJsonResponse(createWorkspaceApiPayload(
      createLegacyV4Workspace({
        version: 5,
        title: 'Legacy API task',
        detailsMarkdown: 'Returned by an older server snapshot',
        priority: 'important'
      }),
      {
        revision: 2,
        updatedAt: '2026-04-03T10:15:00.000Z',
        lastChangedBy: 'sub_123',
        isPristine: false
      }
    ))
  ]);
  const repository = new HttpWorkspaceRepository({
    fetchImpl: fetchDouble.fetch,
    viewerSub: 'sub_123',
    storage: null
  });

  const loadedWorkspace = await repository.loadWorkspace();

  assert.equal(validateWorkspaceShape(loadedWorkspace), true);
  assert.equal(loadedWorkspace.boards.main.columnOrder, undefined);
  assert.equal(loadedWorkspace.boards.main.columns, undefined);
  assert.equal(loadedWorkspace.boards.main.cards.card_legacy_1.title, undefined);
  assert.equal(loadedWorkspace.boards.main.cards.card_legacy_1.contentByLocale.en.title, 'Legacy API task');
});

test('HttpWorkspaceRepository saves workspace snapshots to the server API', async () => {
  const workspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Ship launch checklist',
    detailsMarkdown: 'Owner: Mina',
    priority: 'urgent'
  });
  const normalizedWorkspace = migrateWorkspaceSnapshot(workspace);
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

  assert.deepEqual(savedWorkspace, normalizedWorkspace);
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
    workspace: normalizedWorkspace,
    workspaceId: normalizedWorkspace.workspaceId,
    expectedRevision: 0
  });
});

test('HttpWorkspaceRepository normalizes older snapshots before saving them back to the server API', async () => {
  const legacyWorkspace = createLegacyV4Workspace({
    version: 5,
    title: 'Legacy save task',
    detailsMarkdown: 'Normalized before save',
    priority: 'urgent'
  });
  const fetchDouble = createFetchDouble([
    createJsonResponse(createWorkspaceApiPayload(createCard(createEmptyWorkspace(), 'main', {
      title: 'Legacy save task',
      detailsMarkdown: 'Normalized before save',
      priority: 'urgent'
    }), {
      revision: 3,
      updatedAt: '2026-04-03T12:15:00.000Z',
      lastChangedBy: 'sub_123',
      isPristine: false
    }))
  ]);
  const repository = new HttpWorkspaceRepository({
    fetchImpl: fetchDouble.fetch,
    viewerSub: 'sub_123',
    storage: null
  });

  await repository.saveWorkspace(legacyWorkspace);
  const requestBody = JSON.parse(fetchDouble.calls[0].options.body);

  assert.equal(validateWorkspaceShape(requestBody.workspace), true);
  assert.equal(requestBody.workspace.boards.main.columnOrder, undefined);
  assert.equal(requestBody.workspace.boards.main.columns, undefined);
  assert.equal(requestBody.workspace.boards.main.cards.card_legacy_1.title, undefined);
  assert.equal(requestBody.workspace.boards.main.cards.card_legacy_1.contentByLocale.en.title, 'Legacy save task');
  assert.equal(requestBody.workspaceId, requestBody.workspace.workspaceId);
  assert.equal(requestBody.expectedRevision, 0);
});

test('HttpWorkspaceRepository imports valid v4 local data when the server record is pristine', async () => {
  const pristineServerWorkspace = createEmptyWorkspace();
  const storage = createStorageDouble({
    [createLegacyV4WorkspaceStorageKey('sub_123')]: JSON.stringify(
      createLegacyV4Workspace({
        title: 'Imported task',
        detailsMarkdown: 'Migrated from local storage',
        priority: 'important'
      })
    )
  });
  const importedWorkspace = readLocalV4Workspace(storage, 'sub_123');

  assert.notEqual(importedWorkspace, null);

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
    workspace: importedWorkspace,
    workspaceId: importedWorkspace.workspaceId
  });
  assert.equal(fetchDouble.calls[2].url, `/api/workspace?workspaceId=${encodeURIComponent(importedWorkspace.workspaceId)}`);
  assert.equal(fetchDouble.calls[3].url, `/api/workspace?workspaceId=${encodeURIComponent(importedWorkspace.workspaceId)}`);
});

test('HttpWorkspaceRepository safely ignores a repeated import attempt once the server rejects it', async () => {
  const storage = createStorageDouble({
    [createLegacyV4WorkspaceStorageKey('sub_123')]: JSON.stringify(
      createLegacyV4Workspace({
        title: 'Local v4 task',
        detailsMarkdown: 'Attempted import source',
        priority: 'important'
      })
    )
  });
  const localWorkspace = readLocalV4Workspace(storage, 'sub_123');
  const canonicalServerWorkspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Canonical server task',
    detailsMarkdown: 'Already imported earlier',
    priority: 'urgent'
  });
  const normalizedServerWorkspace = migrateWorkspaceSnapshot(canonicalServerWorkspace);

  assert.notEqual(localWorkspace, null);

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

  assert.deepEqual(loadedWorkspace, normalizedServerWorkspace);
  assert.equal(fetchDouble.calls.length, 3);
  assert.equal(fetchDouble.calls[0].url, '/api/workspace');
  assert.equal(fetchDouble.calls[1].url, '/api/workspace/import');
  assert.deepEqual(JSON.parse(fetchDouble.calls[1].options.body), {
    workspace: localWorkspace,
    workspaceId: localWorkspace.workspaceId
  });
  assert.equal(fetchDouble.calls[2].url, `/api/workspace?workspaceId=${encodeURIComponent(localWorkspace.workspaceId)}`);
});

test('HttpWorkspaceRepository skips import when local v4 data is invalid', async () => {
  const serverWorkspace = createEmptyWorkspace();
  const storage = createStorageDouble({
    [createLegacyV4WorkspaceStorageKey('sub_123')]: JSON.stringify({ version: -1 })
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
  const normalizedBootstrapWorkspace = migrateWorkspaceSnapshot(bootstrapWorkspace);
  const normalizedNetworkWorkspace = migrateWorkspaceSnapshot(networkWorkspace);
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

  assert.deepEqual(firstLoad, normalizedBootstrapWorkspace);
  assert.deepEqual(repository.meta, {
    revision: 3,
    updatedAt: '2026-04-03T11:00:00.000Z',
    lastChangedBy: 'sub_123',
    isPristine: false
  });
  assert.equal(repository.revision, 3);
  assert.equal(repository.activeWorkspaceId, normalizedBootstrapWorkspace.workspaceId);
  assert.equal(fetchDouble.calls.length, 0);

  const secondLoad = await repository.loadWorkspace();

  assert.deepEqual(secondLoad, normalizedNetworkWorkspace);
  assert.equal(fetchDouble.calls.length, 1);
  assert.equal(
    fetchDouble.calls[0].url,
    `/api/workspace?workspaceId=${encodeURIComponent(normalizedBootstrapWorkspace.workspaceId)}`
  );
});

test('HttpWorkspaceRepository bootstraps pendingWorkspaceInvites from the server-rendered payload', async () => {
  const pendingWorkspaceInvites = [createPendingWorkspaceInvitePayload()];
  const repository = new HttpWorkspaceRepository({
    fetchImpl: createFetchDouble([]).fetch,
    viewerSub: 'sub_123',
    storage: null,
    document: createDocumentDouble({
      'workspace-bootstrap': JSON.stringify(
        createWorkspaceApiPayload(createEmptyWorkspace(), {}, undefined, pendingWorkspaceInvites)
      )
    })
  });

  await repository.loadWorkspace();

  assert.deepEqual(repository.getPendingWorkspaceInvites(), [createPendingWorkspaceInviteSummary()]);
});

test('HttpWorkspaceRepository bootstraps accessibleWorkspaces from the server-rendered payload', async () => {
  const accessibleWorkspaces = [
    createAccessibleWorkspaceSummary({
      workspaceId: 'workspace_shared',
      workspaceTitle: 'Shared notes',
      boards: [
        {
          boardId: 'notes',
          boardTitle: 'Notes',
          role: 'editor'
        }
      ]
    })
  ];
  const repository = new HttpWorkspaceRepository({
    fetchImpl: createFetchDouble([]).fetch,
    viewerSub: 'sub_123',
    storage: null,
    document: createDocumentDouble({
      'workspace-bootstrap': JSON.stringify(
        createWorkspaceApiPayload(createEmptyWorkspace(), {}, undefined, [], accessibleWorkspaces)
      )
    })
  });

  await repository.loadWorkspace();

  assert.deepEqual(repository.getAccessibleWorkspaces(), accessibleWorkspaces);
});

test('HttpWorkspaceRepository updates pendingWorkspaceInvites from API responses', async () => {
  const pendingWorkspaceInvites = [createPendingWorkspaceInvitePayload()];
  const fetchDouble = createFetchDouble([
    createJsonResponse(createWorkspaceApiPayload(createEmptyWorkspace(), {}, undefined, pendingWorkspaceInvites))
  ]);
  const repository = new HttpWorkspaceRepository({
    fetchImpl: fetchDouble.fetch,
    viewerSub: 'sub_123',
    storage: null
  });

  await repository.loadWorkspace();

  assert.deepEqual(repository.getPendingWorkspaceInvites(), [createPendingWorkspaceInviteSummary()]);
});

test('HttpWorkspaceRepository updates accessibleWorkspaces from API responses and drops malformed summaries', async () => {
  const fetchDouble = createFetchDouble([
    createJsonResponse(
      createWorkspaceApiPayload(
        createEmptyWorkspace(),
        {},
        undefined,
        [],
        [
          createAccessibleWorkspaceSummary({
            workspaceId: 'workspace_shared',
            boards: [
              {
                boardId: 'notes',
                boardTitle: 'Notes',
                role: 'editor'
              }
            ]
          }),
          createAccessibleWorkspaceSummary({
            workspaceId: 'main',
            boards: [
              {
                boardId: 'main',
                boardTitle: 'Current workspace duplicate',
                role: 'admin'
              }
            ]
          }),
          null,
          { workspaceId: 'workspace_missing_boards' },
          {
            workspaceId: 'workspace_bad_role',
            boards: [
              {
                boardId: 'broken',
                boardTitle: 'Broken',
                role: 'not-a-role'
              }
            ]
          }
        ]
      )
    )
  ]);
  const repository = new HttpWorkspaceRepository({
    fetchImpl: fetchDouble.fetch,
    viewerSub: 'sub_123',
    storage: null
  });

  await repository.loadWorkspace();

  assert.deepEqual(repository.getAccessibleWorkspaces(), [
    createAccessibleWorkspaceSummary({
      workspaceId: 'workspace_shared',
      boards: [
        {
          boardId: 'notes',
          boardTitle: 'Notes',
          role: 'editor'
        }
      ]
    })
  ]);
});

test('HttpWorkspaceRepository drops malformed pendingWorkspaceInvites without crashing', async () => {
  const fetchDouble = createFetchDouble([
    createJsonResponse(
      createWorkspaceApiPayload(
        createEmptyWorkspace(),
        {},
        undefined,
        [
          createPendingWorkspaceInvitePayload(),
          null,
          { workspaceId: 'workspace_missing_fields' },
          { ...createPendingWorkspaceInvitePayload(), invitedAt: 'not-a-date' }
        ]
      )
    )
  ]);
  const repository = new HttpWorkspaceRepository({
    fetchImpl: fetchDouble.fetch,
    viewerSub: 'sub_123',
    storage: null
  });

  await repository.loadWorkspace();

  assert.deepEqual(repository.getPendingWorkspaceInvites(), [createPendingWorkspaceInviteSummary()]);
});

test('HttpWorkspaceRepository normalizes older bootstrap payloads before using them', async () => {
  const repository = new HttpWorkspaceRepository({
    fetchImpl: createFetchDouble([]).fetch,
    viewerSub: 'sub_123',
    storage: null,
    document: createDocumentDouble({
      'workspace-bootstrap': JSON.stringify(
        createWorkspaceApiPayload(createLegacyV4Workspace({
          version: 5,
          title: 'Legacy bootstrap task',
          detailsMarkdown: 'Normalized during hydration',
          priority: 'important'
        }), {
          revision: 3,
          updatedAt: '2026-04-03T11:00:00.000Z',
          lastChangedBy: 'sub_123',
          isPristine: false
        })
      )
    })
  });

  const firstLoad = await repository.loadWorkspace();

  assert.equal(validateWorkspaceShape(firstLoad), true);
  assert.equal(firstLoad.boards.main.columnOrder, undefined);
  assert.equal(firstLoad.boards.main.columns, undefined);
  assert.equal(firstLoad.boards.main.cards.card_legacy_1.title, undefined);
  assert.equal(firstLoad.boards.main.cards.card_legacy_1.contentByLocale.en.title, 'Legacy bootstrap task');
  assert.equal(repository.revision, 3);
});

test('HttpWorkspaceRepository sends the bootstrapped revision on save', async () => {
  const workspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Bootstrapped save',
    detailsMarkdown: 'Revision-aware save',
    priority: 'important'
  });
  const normalizedWorkspace = migrateWorkspaceSnapshot(workspace);
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
    workspace: normalizedWorkspace,
    workspaceId: normalizedWorkspace.workspaceId,
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
      stageId: 'backlog',
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
        stageId: 'backlog',
        title: 'Command result',
        priority: 'urgent'
      }
    },
    workspaceId: commandWorkspace.workspaceId,
    expectedRevision: 7
  });
});

test('HttpWorkspaceRepository setWorkspaceTitle sends workspace.title.set and updates local meta state', async () => {
  const commandWorkspace = createEmptyWorkspace();

  commandWorkspace.title = 'Studio HQ';

  const repository = new HttpWorkspaceRepository({
    fetchImpl: createFetchDouble([
      createJsonResponse(createWorkspaceApiPayload(commandWorkspace, {
        revision: 8,
        updatedAt: '2026-04-03T15:00:00.000Z',
        lastChangedBy: 'sub_123',
        isPristine: false,
        workspaceTitle: 'Studio HQ'
      }, {
        clientMutationId: 'm_title_1',
        type: 'workspace.title.set',
        noOp: false,
        workspaceId: commandWorkspace.workspaceId,
        workspaceTitle: 'Studio HQ'
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
      isPristine: false,
      workspaceTitle: 'Studio HQ'
    }, {
      clientMutationId: 'm_title_1',
      type: 'workspace.title.set',
      noOp: false,
      workspaceId: commandWorkspace.workspaceId,
      workspaceTitle: 'Studio HQ'
    }))
  ]);
  repository.fetchImpl = fetchDouble.fetch;

  const payload = await repository.setWorkspaceTitle({
    clientMutationId: 'm_title_1',
    title: '  Studio HQ  '
  });

  assert.deepEqual(payload.result, {
    clientMutationId: 'm_title_1',
    type: 'workspace.title.set',
    noOp: false,
    workspaceId: commandWorkspace.workspaceId,
    workspaceTitle: 'Studio HQ'
  });
  assert.equal(payload.activeWorkspace.workspaceTitle, 'Studio HQ');
  assert.equal(payload.workspace.title, 'Studio HQ');
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
      clientMutationId: 'm_title_1',
      type: 'workspace.title.set',
      payload: {
        title: '  Studio HQ  '
      }
    },
    workspaceId: commandWorkspace.workspaceId,
    expectedRevision: 7
  });
});

test('HttpWorkspaceRepository createWorkspace calls the dedicated create endpoint without mutating active workspace state', async () => {
  const repository = new HttpWorkspaceRepository({
    fetchImpl: createFetchDouble([
      createJsonResponse({
        ok: true,
        result: {
          workspaceId: 'workspace_created_1',
          workspaceTitle: 'Felipe Budinich 1'
        }
      })
    ]).fetch,
    viewerSub: 'sub_123',
    workspaceId: 'workspace_home',
    storage: null,
    document: null
  });

  repository.activeWorkspaceId = 'workspace_home';
  repository.revision = 7;
  repository.lastRevisionWorkspaceId = 'workspace_home';
  repository.lastStateSource = 'bootstrap';
  const fetchDouble = createFetchDouble([
    createJsonResponse({
      ok: true,
      result: {
        workspaceId: 'workspace_created_1',
        workspaceTitle: 'Felipe Budinich 1'
      }
    })
  ]);
  repository.fetchImpl = fetchDouble.fetch;

  const payload = await repository.createWorkspace({
    title: '   '
  });

  assert.deepEqual(payload, {
    ok: true,
    result: {
      workspaceId: 'workspace_created_1',
      workspaceTitle: 'Felipe Budinich 1'
    }
  });
  assert.equal(repository.activeWorkspaceId, 'workspace_home');
  assert.equal(repository.revision, 7);
  assert.equal(repository.lastRevisionWorkspaceId, 'workspace_home');
  assert.equal(fetchDouble.calls[0].url, '/api/workspace/create');
  assert.equal(fetchDouble.calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(fetchDouble.calls[0].options.body), {
    title: '   '
  });
});

test('HttpWorkspaceRepository generateCardLocalization sends expectedRevision and updates local meta state', async () => {
  const localizedWorkspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Command result',
    detailsMarkdown: 'Applied by the server',
    priority: 'urgent'
  });
  const [cardId] = Object.keys(localizedWorkspace.boards.main.cards);

  localizedWorkspace.boards.main.cards[cardId].contentByLocale.ja = {
    title: 'コマンド結果',
    detailsMarkdown: 'サーバーが生成しました。',
    provenance: {
      actor: { type: 'agent', id: 'openai-localizer' },
      timestamp: '2026-04-03T15:10:00.000Z',
      includesHumanInput: false
    }
  };
  const repository = new HttpWorkspaceRepository({
    fetchImpl: createFetchDouble([
      createJsonResponse(createWorkspaceApiPayload(localizedWorkspace, {
        revision: 8,
        updatedAt: '2026-04-03T15:10:00.000Z',
        lastChangedBy: 'sub_123',
        isPristine: false
      }, {
        clientMutationId: 'm_generate_1',
        type: 'card.locale.generate',
        noOp: false,
        boardId: 'main',
        cardId,
        locale: 'ja',
        sourceLocale: 'en'
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
    createJsonResponse(createWorkspaceApiPayload(localizedWorkspace, {
      revision: 8,
      updatedAt: '2026-04-03T15:10:00.000Z',
      lastChangedBy: 'sub_123',
      isPristine: false
    }, {
      clientMutationId: 'm_generate_1',
      type: 'card.locale.generate',
      noOp: false,
      boardId: 'main',
      cardId,
      locale: 'ja',
      sourceLocale: 'en'
    }))
  ]);
  repository.fetchImpl = fetchDouble.fetch;

  const payload = await repository.generateCardLocalization({
    clientMutationId: 'm_generate_1',
    boardId: 'main',
    cardId,
    targetLocale: 'ja'
  });

  assert.deepEqual(payload.result, {
    clientMutationId: 'm_generate_1',
    type: 'card.locale.generate',
    noOp: false,
    boardId: 'main',
    cardId,
    locale: 'ja',
    sourceLocale: 'en'
  });
  assert.deepEqual(repository.meta, {
    revision: 8,
    updatedAt: '2026-04-03T15:10:00.000Z',
    lastChangedBy: 'sub_123',
    isPristine: false
  });
  assert.equal(repository.revision, 8);
  assert.equal(fetchDouble.calls[0].url, '/api/workspace/localizations/generate');
  assert.equal(fetchDouble.calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(fetchDouble.calls[0].options.body), {
    clientMutationId: 'm_generate_1',
    workspaceId: localizedWorkspace.workspaceId,
    boardId: 'main',
    cardId,
    targetLocale: 'ja',
    expectedRevision: 7
  });
});

test('HttpWorkspaceRepository runStagePrompt sends expectedRevision and updates local meta state', async () => {
  const promptWorkspace = createEmptyWorkspace({
    workspaceId: 'workspace_prompt'
  });
  const cardId = Object.keys(promptWorkspace.boards.main.cards)[0] ?? 'card_1';
  const repository = new HttpWorkspaceRepository({
    fetchImpl: createFetchDouble([]).fetch,
    viewerSub: 'sub_123',
    storage: null
  });

  repository.activeWorkspaceId = promptWorkspace.workspaceId;
  repository.revision = 7;
  repository.meta = {
    revision: 7,
    updatedAt: '2026-04-03T15:00:00.000Z',
    lastChangedBy: 'sub_123',
    isPristine: false
  };

  const fetchDouble = createFetchDouble([
    createJsonResponse(createWorkspaceApiPayload(promptWorkspace, {
      revision: 8,
      updatedAt: '2026-04-03T15:12:00.000Z',
      lastChangedBy: 'sub_123',
      isPristine: false
    }, {
      clientMutationId: 'm_stage_prompt_1',
      type: 'card.stage-prompt.run',
      noOp: false,
      boardId: 'main',
      sourceCardId: cardId,
      createdCardId: 'card_generated_1',
      sourceStageId: 'backlog',
      targetStageId: 'doing'
    }))
  ]);
  repository.fetchImpl = fetchDouble.fetch;

  const payload = await repository.runStagePrompt({
    clientMutationId: 'm_stage_prompt_1',
    boardId: 'main',
    cardId
  });

  assert.deepEqual(payload.result, {
    clientMutationId: 'm_stage_prompt_1',
    type: 'card.stage-prompt.run',
    noOp: false,
    boardId: 'main',
    sourceCardId: cardId,
    createdCardId: 'card_generated_1',
    sourceStageId: 'backlog',
    targetStageId: 'doing'
  });
  assert.deepEqual(repository.meta, {
    revision: 8,
    updatedAt: '2026-04-03T15:12:00.000Z',
    lastChangedBy: 'sub_123',
    isPristine: false
  });
  assert.equal(repository.revision, 8);
  assert.equal(fetchDouble.calls[0].url, '/api/workspace/stage-prompts/run');
  assert.equal(fetchDouble.calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(fetchDouble.calls[0].options.body), {
    clientMutationId: 'm_stage_prompt_1',
    workspaceId: promptWorkspace.workspaceId,
    boardId: 'main',
    cardId,
    expectedRevision: 7
  });
});

test('HttpWorkspaceRepository resolves a cross-workspace revision without replacing the active cached workspace state', async () => {
  const homeWorkspace = createEmptyWorkspace({
    workspaceId: 'workspace_home'
  });
  const sharedWorkspace = createEmptyWorkspace({
    workspaceId: 'workspace_shared'
  });
  const repository = new HttpWorkspaceRepository({
    fetchImpl: createFetchDouble([]).fetch,
    viewerSub: 'sub_123',
    storage: null,
    document: createDocumentDouble({
      'workspace-bootstrap': JSON.stringify(
        createWorkspaceApiPayload(homeWorkspace, {
          revision: 344,
          updatedAt: '2026-04-03T14:00:00.000Z',
          lastChangedBy: 'sub_123',
          isPristine: false,
          workspaceId: 'workspace_home',
          isHomeWorkspace: true
        })
      )
    })
  });

  await repository.loadWorkspace();
  const fetchDouble = createFetchDouble([
    createJsonResponse(createWorkspaceApiPayload(sharedWorkspace, {
      revision: 3,
      updatedAt: '2026-04-03T15:00:00.000Z',
      lastChangedBy: 'sub_owner',
      isPristine: false,
      workspaceId: 'workspace_shared',
      isHomeWorkspace: false
    }))
  ]);
  repository.fetchImpl = fetchDouble.fetch;

  const resolvedRevision = await repository.resolveWorkspaceRevision('workspace_shared');

  assert.equal(resolvedRevision, 3);
  assert.equal(repository.activeWorkspaceId, 'workspace_home');
  assert.equal(repository.revision, 344);
  assert.equal(repository.lastRevisionWorkspaceId, 'workspace_home');
  assert.equal(fetchDouble.calls[0].url, '/api/workspace?workspaceId=workspace_shared');
  assert.equal(fetchDouble.calls[0].options.method, 'GET');
});

test('HttpWorkspaceRepository applyCommand honors explicit workspace command context', async () => {
  const sharedWorkspace = createEmptyWorkspace({
    workspaceId: 'workspace_shared'
  });
  const repository = new HttpWorkspaceRepository({
    fetchImpl: createFetchDouble([]).fetch,
    viewerSub: 'sub_123',
    storage: null,
    document: createDocumentDouble({
      'workspace-bootstrap': JSON.stringify(
        createWorkspaceApiPayload(createEmptyWorkspace({
          workspaceId: 'workspace_home'
        }), {
          revision: 344,
          updatedAt: '2026-04-03T14:00:00.000Z',
          lastChangedBy: 'sub_123',
          isPristine: false,
          workspaceId: 'workspace_home',
          isHomeWorkspace: true
        })
      )
    })
  });

  await repository.loadWorkspace();
  const fetchDouble = createFetchDouble([
    createJsonResponse(createWorkspaceApiPayload(sharedWorkspace, {
      revision: 4,
      updatedAt: '2026-04-03T15:05:00.000Z',
      lastChangedBy: 'sub_123',
      isPristine: false,
      workspaceId: 'workspace_shared',
      isHomeWorkspace: false
    }, {
      clientMutationId: 'm_cross_accept',
      type: 'board.invite.accept',
      noOp: false
    }))
  ]);
  repository.fetchImpl = fetchDouble.fetch;

  await repository.applyCommand({
    clientMutationId: 'm_cross_accept',
    type: 'board.invite.accept',
    payload: {
      boardId: 'casa',
      inviteId: 'invite_1'
    }
  }, {
    workspaceId: 'workspace_shared',
    expectedRevision: 3
  });

  assert.deepEqual(JSON.parse(fetchDouble.calls[0].options.body), {
    command: {
      clientMutationId: 'm_cross_accept',
      type: 'board.invite.accept',
      payload: {
        boardId: 'casa',
        inviteId: 'invite_1'
      }
    },
    workspaceId: 'workspace_shared',
    expectedRevision: 3
  });
});

test('HttpWorkspaceRepository targets the selected active workspace on subsequent loads', async () => {
  const sharedWorkspace = createEmptyWorkspace({
    workspaceId: 'workspace_shared'
  });
  const fetchDouble = createFetchDouble([
    createJsonResponse(createWorkspaceApiPayload(sharedWorkspace, {
      revision: 1,
      updatedAt: '2026-04-03T16:00:00.000Z',
      lastChangedBy: 'sub_123',
      isPristine: false,
      workspaceId: 'workspace_shared',
      isHomeWorkspace: false
    }))
  ]);
  const repository = new HttpWorkspaceRepository({
    fetchImpl: fetchDouble.fetch,
    viewerSub: 'sub_123',
    storage: null
  });

  repository.setActiveWorkspace('workspace_shared');
  await repository.loadWorkspace();

  assert.equal(fetchDouble.calls[0].url, '/api/workspace?workspaceId=workspace_shared');
  assert.equal(repository.activeWorkspaceId, 'workspace_shared');
  assert.equal(repository.isHomeWorkspace, false);
});

test('HttpWorkspaceRepository loads filtered shared workspace payloads without breaking active workspace state', async () => {
  const filteredWorkspace = createFilteredSharedWorkspace();
  const fetchDouble = createFetchDouble([
    createJsonResponse(createWorkspaceApiPayload(filteredWorkspace, {
      revision: 2,
      updatedAt: '2026-04-03T16:15:00.000Z',
      lastChangedBy: 'sub_owner',
      isPristine: false,
      workspaceId: 'workspace_shared_filtered',
      isHomeWorkspace: false
    }))
  ]);
  const repository = new HttpWorkspaceRepository({
    fetchImpl: fetchDouble.fetch,
    viewerSub: 'sub_member',
    storage: null
  });

  repository.setActiveWorkspace('workspace_shared_filtered');
  const workspace = await repository.loadWorkspace();

  assert.equal(validateWorkspaceShape(workspace), true);
  assert.deepEqual(workspace.boardOrder, ['member', 'invite']);
  assert.equal(workspace.ui.activeBoardId, 'member');
  assert.deepEqual(workspace.boards.invite.cards, {});
  assert.equal(repository.activeWorkspaceId, 'workspace_shared_filtered');
  assert.equal(repository.isHomeWorkspace, false);
});

test('HttpWorkspaceRepository sends commands against the selected active workspace id', async () => {
  const sharedWorkspace = createEmptyWorkspace({
    workspaceId: 'workspace_shared'
  });
  const fetchDouble = createFetchDouble([
    createJsonResponse(createWorkspaceApiPayload(sharedWorkspace, {
      revision: 2,
      updatedAt: '2026-04-03T16:30:00.000Z',
      lastChangedBy: 'sub_123',
      isPristine: false,
      workspaceId: 'workspace_shared',
      isHomeWorkspace: false
    }, {
      clientMutationId: 'm2',
      type: 'board.invite.accept',
      noOp: false
    }))
  ]);
  const repository = new HttpWorkspaceRepository({
    fetchImpl: fetchDouble.fetch,
    viewerSub: 'sub_123',
    storage: null
  });

  repository.setActiveWorkspace('workspace_shared');
  await repository.applyCommand({
    clientMutationId: 'm2',
    type: 'board.invite.accept',
    payload: {
      boardId: 'main',
      inviteId: 'invite_1'
    }
  });

  assert.deepEqual(JSON.parse(fetchDouble.calls[0].options.body), {
    command: {
      clientMutationId: 'm2',
      type: 'board.invite.accept',
      payload: {
        boardId: 'main',
        inviteId: 'invite_1'
      }
    },
    workspaceId: 'workspace_shared',
    expectedRevision: 0
  });
});

test('HttpWorkspaceRepository can land the client in a shared workspace after invite acceptance', async () => {
  const sharedWorkspace = createEmptyWorkspace({
    workspaceId: 'workspace_shared'
  });
  const fetchDouble = createFetchDouble([
    createJsonResponse(createWorkspaceApiPayload(sharedWorkspace, {
      revision: 3,
      updatedAt: '2026-04-03T17:00:00.000Z',
      lastChangedBy: 'sub_123',
      isPristine: false,
      workspaceId: 'workspace_shared',
      isHomeWorkspace: false
    }, {
      clientMutationId: 'm3',
      type: 'board.invite.accept',
      noOp: false
    })),
    createJsonResponse(createWorkspaceApiPayload(sharedWorkspace, {
      revision: 4,
      updatedAt: '2026-04-03T17:05:00.000Z',
      lastChangedBy: 'sub_123',
      isPristine: false,
      workspaceId: 'workspace_shared',
      isHomeWorkspace: false
    }))
  ]);
  const repository = new HttpWorkspaceRepository({
    fetchImpl: fetchDouble.fetch,
    viewerSub: 'sub_123',
    storage: null
  });

  await repository.applyCommand({
    clientMutationId: 'm3',
    type: 'board.invite.accept',
    payload: {
      boardId: 'main',
      inviteId: 'invite_1'
    }
  });
  const sharedLoad = await repository.loadWorkspace();

  assert.equal(repository.activeWorkspaceId, 'workspace_shared');
  assert.equal(fetchDouble.calls[1].url, '/api/workspace?workspaceId=workspace_shared');
  assert.deepEqual(sharedLoad, migrateWorkspaceSnapshot(sharedWorkspace));
});

test('HttpWorkspaceRepository accepts empty actor-facing command projections after the last invite disappears', async () => {
  const emptyProjection = createEmptyActorFacingWorkspace('workspace_shared_filtered');
  const repository = new HttpWorkspaceRepository({
    fetchImpl: createFetchDouble([
      createJsonResponse(createWorkspaceApiPayload(emptyProjection, {
        revision: 5,
        updatedAt: '2026-04-03T17:10:00.000Z',
        lastChangedBy: 'sub_member',
        isPristine: false,
        workspaceId: 'workspace_shared_filtered',
        isHomeWorkspace: false
      }, {
        clientMutationId: 'm4',
        type: 'board.invite.decline',
        noOp: false
      }))
    ]).fetch,
    viewerSub: 'sub_member',
    storage: null
  });

  const payload = await repository.applyCommand({
    clientMutationId: 'm4',
    type: 'board.invite.decline',
    payload: {
      boardId: 'invite',
      inviteId: 'invite_1'
    }
  });

  assert.deepEqual(payload.workspace ?? payload, emptyProjection);
  assert.equal(repository.activeWorkspaceId, 'workspace_shared_filtered');
  assert.deepEqual(repository.meta, {
    revision: 5,
    updatedAt: '2026-04-03T17:10:00.000Z',
    lastChangedBy: 'sub_member',
    isPristine: false
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

test('HttpWorkspaceRepository setWorkspaceTitle surfaces revision conflicts with a friendly error', async () => {
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
    repository.setWorkspaceTitle({
      clientMutationId: 'm_title_conflict_1',
      title: 'Studio HQ'
    }),
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

function createWorkspaceApiPayload(
  workspace,
  meta = {},
  result = undefined,
  pendingWorkspaceInvites = [],
  accessibleWorkspaces = []
) {
  const payload = {
    ok: true,
    workspace,
    activeWorkspace: {
      workspaceId: meta.workspaceId ?? workspace?.workspaceId ?? null,
      workspaceTitle: meta.workspaceTitle ?? workspace?.title ?? null,
      isHomeWorkspace: meta.isHomeWorkspace ?? true
    },
    meta: {
      revision: meta.revision ?? 0,
      updatedAt: meta.updatedAt ?? '2026-04-03T10:00:00.000Z',
      lastChangedBy: meta.lastChangedBy ?? null,
      isPristine: meta.isPristine ?? true
    },
    pendingWorkspaceInvites,
    accessibleWorkspaces
  };

  if (result !== undefined) {
    payload.result = result;
  }

  return payload;
}

function createPendingWorkspaceInviteSummary() {
  return {
    workspaceId: 'workspace_shared',
    boardId: 'casa',
    boardTitle: 'Casa',
    inviteId: 'invite_1',
    role: 'viewer',
    invitedAt: '2026-04-03T10:00:00.000Z',
    invitedBy: {
      id: 'sub_owner',
      email: 'owner@example.com',
      displayName: 'Owner'
    }
  };
}

function createPendingWorkspaceInvitePayload() {
  return createPendingWorkspaceInviteSummary();
}

function createAccessibleWorkspaceSummary({
  workspaceId = 'workspace_shared',
  workspaceTitle = null,
  isHomeWorkspace = false,
  boards = [
    {
      boardId: 'notes',
      boardTitle: 'Notes',
      role: 'viewer'
    }
  ]
} = {}) {
  return {
    workspaceId,
    workspaceTitle,
    isHomeWorkspace,
    boards: boards.map((board) => ({ ...board }))
  };
}

function createLegacyV4Workspace({
  version = 4,
  title = 'Legacy v4 card',
  detailsMarkdown = '',
  priority = 'important'
} = {}) {
  const workspace = createEmptyWorkspace();
  const board = workspace.boards.main;

  return {
    version,
    workspaceId: workspace.workspaceId,
    ui: structuredClone(workspace.ui),
    boardOrder: [...workspace.boardOrder],
    boards: {
      [board.id]: {
        id: board.id,
        title: board.title,
        createdAt: board.createdAt,
        updatedAt: board.updatedAt,
        columnOrder: ['backlog', 'doing', 'done', 'archived'],
        columns: {
          backlog: {
            id: 'backlog',
            title: 'Backlog',
            cardIds: ['card_legacy_1'],
            allowedTransitionStageIds: ['doing', 'done'],
            templateIds: []
          },
          doing: {
            id: 'doing',
            title: 'Doing',
            cardIds: [],
            allowedTransitionStageIds: ['backlog', 'done'],
            templateIds: []
          },
          done: {
            id: 'done',
            title: 'Done',
            cardIds: [],
            allowedTransitionStageIds: ['backlog', 'doing', 'archived'],
            templateIds: []
          },
          archived: {
            id: 'archived',
            title: 'Archived',
            cardIds: [],
            allowedTransitionStageIds: ['backlog', 'doing', 'done'],
            templateIds: []
          }
        },
        cards: {
          card_legacy_1: {
            id: 'card_legacy_1',
            title,
            detailsMarkdown,
            priority,
            createdAt: '2026-04-03T09:00:00.000Z',
            updatedAt: '2026-04-03T09:30:00.000Z'
          }
        }
      }
    }
  };
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

function createFilteredSharedWorkspace() {
  let workspace = createEmptyWorkspace({
    workspaceId: 'workspace_shared_filtered'
  });

  workspace.boards.main.id = 'member';
  workspace.boards.main.title = 'Member board';
  workspace.boards.main.collaboration.memberships = [
    {
      actor: { type: 'human', id: 'sub_member', email: 'member@example.com' },
      role: 'viewer',
      joinedAt: workspace.boards.main.createdAt
    }
  ];
  workspace.boards.member = workspace.boards.main;
  delete workspace.boards.main;
  workspace = createCard(workspace, 'member', {
    title: 'Visible card',
    detailsMarkdown: 'Visible after filtering.',
    priority: 'important'
  });

  const inviteBoard = createEmptyWorkspace({
    workspaceId: 'workspace_shared_filtered_invite'
  }).boards.main;
  inviteBoard.id = 'invite';
  inviteBoard.title = 'Invite board';
  inviteBoard.collaboration.memberships = [
    {
      actor: { type: 'human', id: 'sub_owner', email: 'owner@example.com' },
      role: 'admin',
      joinedAt: inviteBoard.createdAt
    }
  ];
  inviteBoard.collaboration.invites = [
    {
      id: 'invite_1',
      email: 'member@example.com',
      role: 'viewer',
      status: 'pending',
      invitedBy: { type: 'human', id: 'sub_owner', email: 'owner@example.com' },
      invitedAt: '2026-04-03T10:00:00.000Z'
    }
  ];
  inviteBoard.cards = {};
  workspace.boards.invite = inviteBoard;
  workspace.boardOrder = ['member', 'invite'];
  workspace.ui.activeBoardId = 'member';

  return workspace;
}

function createEmptyActorFacingWorkspace(workspaceId) {
  const workspace = createEmptyWorkspace({
    workspaceId
  });

  workspace.boardOrder = [];
  workspace.boards = {};
  workspace.ui.activeBoardId = null;
  return workspace;
}
