import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import {
  KATEI_SESSION_COOKIE_NAME,
  createSessionPayload,
  createSignedSessionCookieValue
} from '../src/auth/session_cookie.js';
import {
  createCard,
  createEmptyWorkspace,
  validateWorkspaceShape
} from '../public/js/domain/workspace.js';
import {
  createHomeWorkspaceId,
  createInitialWorkspaceRecord,
  createUpdatedWorkspaceRecord,
  createWorkspaceRecord
} from '../src/workspaces/workspace_record.js';
import {
  WorkspaceAccessDeniedError,
  WorkspaceImportConflictError,
  WorkspaceRevisionConflictError
} from '../src/workspaces/workspace_record_repository.js';
import { canViewerAccessWorkspace, filterWorkspaceForViewer } from '../src/workspaces/workspace_access.js';

test('GET /api/workspace returns normalized actor-filtered shared workspace data', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_get', {
    memberRole: 'viewer',
    includeInvite: true
  });
  const homeRecord = createHomeWorkspaceRecordFixture({
    viewerSub: 'sub_member'
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([
    homeRecord,
    sharedRecord,
    createCrossWorkspaceInviteRecordFixture('workspace_invited_casa')
  ]);
  const app = createTestApp({ workspaceRecordRepository });

  const response = await request(app)
    .get('/api/workspace?workspaceId=workspace_shared_api_get')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }));

  assert.equal(response.status, 200);
  assert.equal(validateWorkspaceShape(response.body.workspace), true);
  assert.deepEqual(response.body.workspace.boardOrder, ['member', 'invite']);
  assert.equal(response.body.workspace.ui.activeBoardId, 'member');
  assert.equal(response.body.workspace.boards.main, undefined);
  assert.equal(firstCardTitle(response.body.workspace.boards.member), 'Member board card');
  assert.deepEqual(response.body.workspace.boards.invite.cards, {});
  assert.equal(response.body.workspace.boards.invite.collaboration.invites[0].email, 'member@example.com');
  assert.deepEqual(response.body.pendingWorkspaceInvites, [
    {
      workspaceId: 'workspace_shared_api_get',
      boardId: 'invite',
      boardTitle: 'Invite board',
      inviteId: 'invite_1',
      role: 'viewer',
      invitedAt: '2026-04-04T10:15:00.000Z',
      invitedBy: {
        id: 'sub_owner',
        email: 'owner@example.com',
        displayName: null
      }
    },
    {
      workspaceId: 'workspace_invited_casa',
      boardId: 'casa',
      boardTitle: 'Casa',
      inviteId: 'invite_casa_1',
      role: 'editor',
      invitedAt: '2026-04-04T10:20:00.000Z',
      invitedBy: {
        id: 'sub_owner_casa',
        email: 'owner-casa@example.com',
        displayName: 'Casa owner'
      }
    }
  ]);
  assert.deepEqual(response.body.accessibleWorkspaces, [
    {
      workspaceId: homeRecord.workspaceId,
      isHomeWorkspace: true,
      boards: [
        {
          boardId: 'main',
          boardTitle: homeRecord.workspace.boards.main.title,
          role: 'admin'
        }
      ]
    }
  ]);
  assert.deepEqual(Object.keys(response.body), ['ok', 'workspace', 'activeWorkspace', 'meta', 'pendingWorkspaceInvites', 'accessibleWorkspaces']);
});

test('POST /api/workspace/commands returns the filtered resulting workspace', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_commands', {
    memberRole: 'admin',
    includeInvite: false
  });
  const homeRecord = createHomeWorkspaceRecordFixture({
    viewerSub: 'sub_member'
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([
    homeRecord,
    sharedRecord,
    createCrossWorkspaceInviteRecordFixture('workspace_command_invite')
  ]);
  const app = createTestApp({ workspaceRecordRepository });

  const response = await request(app)
    .post('/api/workspace/commands')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send({
      workspaceId: 'workspace_shared_api_commands',
      command: {
        clientMutationId: 'rename_member_board',
        type: 'board.rename',
        payload: {
          boardId: 'member',
          title: 'Member board renamed'
        }
      },
      expectedRevision: 1
    });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.workspace.boardOrder, ['member']);
  assert.equal(response.body.workspace.boards.main, undefined);
  assert.equal(response.body.workspace.boards.member.title, 'Member board renamed');
  assert.equal(response.body.pendingWorkspaceInvites.length, 1);
  assert.equal(response.body.pendingWorkspaceInvites[0].workspaceId, 'workspace_command_invite');
  assert.deepEqual(response.body.accessibleWorkspaces, [
    {
      workspaceId: homeRecord.workspaceId,
      isHomeWorkspace: true,
      boards: [
        {
          boardId: 'main',
          boardTitle: homeRecord.workspace.boards.main.title,
          role: 'admin'
        }
      ]
    }
  ]);
  assert.deepEqual(Object.keys(response.body), ['ok', 'workspace', 'activeWorkspace', 'meta', 'pendingWorkspaceInvites', 'accessibleWorkspaces', 'result']);
});

test('PUT /api/workspace rejects shared snapshot replacement when hidden boards exist', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_put', {
    memberRole: 'admin',
    includeInvite: false
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({ workspaceRecordRepository });
  const filteredWorkspace = filterWorkspaceForViewer({
    viewerSub: 'sub_member',
    viewerEmail: 'member@example.com',
    ownerSub: sharedRecord.viewerSub,
    workspace: sharedRecord.workspace
  });

  const response = await request(app)
    .put('/api/workspace')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send({
      workspaceId: 'workspace_shared_api_put',
      workspace: filteredWorkspace,
      expectedRevision: 1
    });

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, {
    ok: false,
    error: 'Use board commands to update shared workspaces when some boards are hidden from you.'
  });
  assert.equal(workspaceRecordRepository.replaceCalls.length, 0);
});

test('POST /api/workspace/import still accepts older snapshots and returns the normalized shape', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([
    createCrossWorkspaceInviteRecordFixture('workspace_import_invite', {
      viewerSub: 'sub_legacy',
      viewerEmail: 'legacy@example.com'
    })
  ]);
  const app = createTestApp({ workspaceRecordRepository });
  const legacyWorkspace = createLegacyWorkspaceSnapshot();

  const response = await request(app)
    .post('/api/workspace/import')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_legacy', email: 'legacy@example.com', name: 'Legacy User' }))
    .send({ workspace: legacyWorkspace });

  assert.equal(response.status, 200);
  assert.equal(validateWorkspaceShape(response.body.workspace), true);
  assert.equal(response.body.workspace.boards.main.columnOrder, undefined);
  assert.equal(response.body.workspace.boards.main.cards.card_legacy_1.title, undefined);
  assert.equal(response.body.workspace.boards.main.cards.card_legacy_1.contentByLocale.en.title, 'Legacy import card');
  assert.equal(response.body.pendingWorkspaceInvites.length, 1);
  assert.equal(response.body.pendingWorkspaceInvites[0].workspaceId, 'workspace_import_invite');
  assert.deepEqual(response.body.accessibleWorkspaces, []);
  assert.deepEqual(Object.keys(response.body), ['ok', 'workspace', 'activeWorkspace', 'meta', 'pendingWorkspaceInvites', 'accessibleWorkspaces']);
});

test('PUT /api/workspace responses include pendingWorkspaceInvites without changing the actor-facing payload shape', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([
    createCrossWorkspaceInviteRecordFixture('workspace_put_invite')
  ]);
  const app = createTestApp({ workspaceRecordRepository });
  const workspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Ship launch checklist',
    detailsMarkdown: 'Owner: Mina',
    priority: 'urgent'
  });

  const response = await request(app)
    .put('/api/workspace')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_123', email: 'member@example.com', name: 'Tester' }))
    .send({ workspace, expectedRevision: 0 });

  assert.equal(response.status, 200);
  assert.equal(response.body.pendingWorkspaceInvites.length, 1);
  assert.equal(response.body.pendingWorkspaceInvites[0].workspaceId, 'workspace_put_invite');
  assert.deepEqual(response.body.accessibleWorkspaces, []);
  assert.deepEqual(Object.keys(response.body), ['ok', 'workspace', 'activeWorkspace', 'meta', 'pendingWorkspaceInvites', 'accessibleWorkspaces']);
});

function createTestApp({ workspaceRecordRepository } = {}) {
  return createApp({
    env: {
      NODE_ENV: 'test',
      GOOGLE_CLIENT_ID: 'test-google-client-id',
      KATEI_SESSION_SECRET: 'test-session-secret',
      MONGODB_URI: 'mongodb://127.0.0.1:27017',
      MONGODB_DB_NAME: 'katei_test'
    },
    googleTokenVerifier: async () => ({ sub: 'sub_any' }),
    workspaceRecordRepository: workspaceRecordRepository ?? createWorkspaceRecordRepositoryDouble()
  });
}

function createSessionCookieHeader(viewer, { ttlSeconds = 300, now = '2099-01-01T00:00:00Z' } = {}) {
  const payload = createSessionPayload(viewer, ttlSeconds, new Date(now));
  const value = createSignedSessionCookieValue(payload, 'test-session-secret');
  return `${KATEI_SESSION_COOKIE_NAME}=${value}`;
}

function createWorkspaceRecordRepositoryDouble(initialRecords = []) {
  const records = new Map(initialRecords.map((record) => [record.workspaceId, structuredClone(record)]));

  function projectRecord(record, { viewerSub, viewerEmail = null } = {}) {
    const normalizedRecord = createWorkspaceRecord(record);

    return {
      ...structuredClone(normalizedRecord),
      workspace: filterWorkspaceForViewer({
        viewerSub,
        viewerEmail,
        ownerSub: normalizedRecord.viewerSub,
        workspace: normalizedRecord.workspace
      })
    };
  }

  async function loadFullRecord({ viewerSub, viewerEmail = null, workspaceId = null } = {}) {
    if (workspaceId) {
      const requestedRecord = records.get(workspaceId);
      const normalizedRequestedRecord = requestedRecord ? createWorkspaceRecord(requestedRecord) : null;

      if (
        !normalizedRequestedRecord ||
        !canViewerAccessWorkspace({
          viewerSub,
          viewerEmail,
          ownerSub: normalizedRequestedRecord.viewerSub,
          workspace: normalizedRequestedRecord.workspace
        })
      ) {
        throw new WorkspaceAccessDeniedError();
      }

      return normalizedRequestedRecord;
    }

    const homeWorkspaceId = createHomeWorkspaceId(viewerSub);
    const existingHomeRecord =
      records.get(homeWorkspaceId)
      ?? records.get(viewerSub)
      ?? [...records.values()].find((record) => record.viewerSub === viewerSub && record.isHomeWorkspace);

    if (existingHomeRecord) {
      return createWorkspaceRecord(existingHomeRecord);
    }

    if (!records.has(homeWorkspaceId)) {
      records.set(
        homeWorkspaceId,
        createInitialWorkspaceRecord(viewerSub, {
          now: '2026-04-04T10:00:00.000Z'
        })
      );
    }

    return createWorkspaceRecord(records.get(homeWorkspaceId));
  }

  return {
    replaceCalls: [],

    async loadOrCreateWorkspaceRecord({ viewerSub, viewerEmail = null, workspaceId = null } = {}) {
      return projectRecord(
        await loadFullRecord({ viewerSub, viewerEmail, workspaceId }),
        { viewerSub, viewerEmail }
      );
    },

    async loadOrCreateAuthoritativeWorkspaceRecord({ viewerSub, viewerEmail = null, workspaceId = null } = {}) {
      return loadFullRecord({ viewerSub, viewerEmail, workspaceId });
    },

    async listPendingWorkspaceInvitesForViewer({ viewerSub, viewerEmail = null } = {}) {
      return listPendingWorkspaceInvites(records.values(), { viewerSub, viewerEmail });
    },

    async listAccessibleWorkspacesForViewer({ viewerSub, viewerEmail = null, excludeWorkspaceId = null } = {}) {
      await loadFullRecord({ viewerSub, viewerEmail });
      return listAccessibleWorkspaces(records.values(), { viewerSub, viewerEmail, excludeWorkspaceId });
    },

    async replaceWorkspaceSnapshot({ viewerSub, viewerEmail = null, workspaceId = null, workspace, actor, expectedRevision }) {
      this.replaceCalls.push({
        viewerSub,
        viewerEmail,
        workspaceId,
        workspace,
        actor,
        expectedRevision
      });

      const currentRecord = await loadFullRecord({ viewerSub, viewerEmail, workspaceId });

      if (currentRecord.revision !== expectedRevision) {
        throw new WorkspaceRevisionConflictError();
      }

      const nextRecord = createUpdatedWorkspaceRecord(currentRecord, {
        workspace,
        actor,
        now: '2026-04-04T11:00:00.000Z',
        createActivityEventId: () => 'activity_saved_api_test'
      });
      records.set(nextRecord.workspaceId, nextRecord);
      return createWorkspaceRecord(nextRecord);
    },

    async importWorkspaceSnapshot({ viewerSub, viewerEmail = null, workspaceId = null, workspace, actor }) {
      const currentRecord = await loadFullRecord({ viewerSub, viewerEmail, workspaceId });

      if (currentRecord.revision !== 0) {
        throw new WorkspaceImportConflictError();
      }

      const nextRecord = createUpdatedWorkspaceRecord(currentRecord, {
        workspace,
        actor,
        now: '2026-04-04T11:00:00.000Z',
        activityType: 'workspace.imported',
        createActivityEventId: () => 'activity_imported_api_test'
      });
      records.set(nextRecord.workspaceId, nextRecord);
      return createWorkspaceRecord(nextRecord);
    },

    async replaceWorkspaceRecord({ record, expectedRevision }) {
      const currentRecord =
        records.get(record.workspaceId)
        ?? createInitialWorkspaceRecord(record.viewerSub, {
          workspaceId: record.workspaceId,
          now: '2026-04-04T10:00:00.000Z'
        });

      if (currentRecord.revision !== expectedRevision) {
        throw new WorkspaceRevisionConflictError();
      }

      records.set(record.workspaceId, structuredClone(record));
      return createWorkspaceRecord(record);
    }
  };
}

function createHomeWorkspaceRecordFixture({
  viewerSub = 'sub_member',
  boardTitle = 'Home board'
} = {}) {
  const initialRecord = createInitialWorkspaceRecord(viewerSub, {
    workspaceId: createHomeWorkspaceId(viewerSub),
    now: '2026-04-04T09:30:00.000Z'
  });
  const workspace = structuredClone(initialRecord.workspace);

  workspace.boards.main.title = boardTitle;

  return createUpdatedWorkspaceRecord(initialRecord, {
    workspace,
    actor: {
      type: 'human',
      id: viewerSub
    },
    now: '2026-04-04T09:45:00.000Z'
  });
}

function createSharedWorkspaceRecordFixture(workspaceId, { memberRole = 'viewer', includeInvite = true } = {}) {
  let workspace = createCard(
    createEmptyWorkspace({
      workspaceId,
      creator: {
        type: 'human',
        id: 'sub_owner',
        email: 'owner@example.com'
      }
    }),
    'main',
    {
      title: 'Owner board card',
      detailsMarkdown: 'Hidden from the collaborator.',
      priority: 'important'
    }
  );

  workspace.boards.main.title = 'Owner board';
  workspace.boards.main.collaboration.memberships = [
    {
      actor: { type: 'human', id: 'sub_owner', email: 'owner@example.com' },
      role: 'admin',
      joinedAt: workspace.boards.main.createdAt
    }
  ];

  workspace = addSharedBoard(workspace, 'member', 'Member board', {
    memberships: [
      {
        actor: { type: 'human', id: 'sub_member', email: 'member@example.com' },
        role: memberRole,
        joinedAt: '2026-04-04T10:05:00.000Z'
      }
    ],
    card: {
      title: 'Member board card',
      detailsMarkdown: 'Visible to the collaborator.',
      priority: 'urgent'
    }
  });

  if (includeInvite) {
    workspace = addSharedBoard(workspace, 'invite', 'Invite board', {
      invites: [
        {
          id: 'invite_1',
          email: 'member@example.com',
          role: 'viewer',
          status: 'pending',
          invitedBy: { type: 'human', id: 'sub_owner', email: 'owner@example.com' },
          invitedAt: '2026-04-04T10:15:00.000Z'
        }
      ],
      card: {
        title: 'Invite board card',
        detailsMarkdown: 'Should be redacted until the invite is accepted.',
        priority: 'normal'
      }
    });
  }

  workspace.boardOrder = includeInvite ? ['main', 'member', 'invite'] : ['main', 'member'];
  workspace.ui.activeBoardId = 'main';

  const record = createUpdatedWorkspaceRecord(
    createInitialWorkspaceRecord('sub_owner', {
      workspaceId,
      now: '2026-04-04T10:00:00.000Z'
    }),
    {
      workspace,
      actor: { type: 'human', id: 'sub_owner' },
      now: '2026-04-04T10:30:00.000Z'
    }
  );
  record.isHomeWorkspace = false;
  return record;
}

function createCrossWorkspaceInviteRecordFixture(
  workspaceId,
  {
    viewerSub = 'sub_123',
    viewerEmail = 'member@example.com',
    inviteStatus = 'pending'
  } = {}
) {
  const ownerActor = {
    type: 'human',
    id: 'sub_owner_casa',
    email: 'owner-casa@example.com',
    displayName: 'Casa owner'
  };
  let workspace = createEmptyWorkspace({
    workspaceId,
    creator: ownerActor
  });

  workspace.boards.main.title = 'Owner board';
  workspace.boards.main.collaboration.memberships = [
    {
      actor: ownerActor,
      role: 'admin',
      joinedAt: workspace.boards.main.createdAt
    }
  ];
  workspace = addSharedBoard(workspace, 'casa', 'Casa', {
    invites: [
      {
        id: 'invite_casa_1',
        actor: { type: 'human', id: viewerSub },
        email: viewerEmail,
        role: 'editor',
        status: inviteStatus,
        invitedBy: ownerActor,
        invitedAt: '2026-04-04T10:20:00.000Z'
      }
    ]
  });
  workspace.boardOrder = ['main', 'casa'];
  workspace.ui.activeBoardId = 'main';

  const record = createUpdatedWorkspaceRecord(
    createInitialWorkspaceRecord('sub_owner_casa', {
      workspaceId,
      now: '2026-04-04T10:00:00.000Z'
    }),
    {
      workspace,
      actor: { type: 'human', id: 'sub_owner_casa' },
      now: '2026-04-04T10:30:00.000Z'
    }
  );
  record.isHomeWorkspace = false;
  return record;
}

function listPendingWorkspaceInvites(records, { viewerSub, viewerEmail = null } = {}) {
  const normalizedViewerEmail = normalizeOptionalEmail(viewerEmail);
  const inviteSummaries = [];
  const seenInviteKeys = new Set();

  for (const record of records) {
    const workspace = createWorkspaceRecord(record).workspace;

    for (const [boardId, board] of Object.entries(workspace.boards ?? {})) {
      const invites = Array.isArray(board?.collaboration?.invites) ? board.collaboration.invites : [];

      for (const invite of invites) {
        if (invite?.status !== 'pending') {
          continue;
        }

        const matchesViewer =
          (typeof invite?.actor?.id === 'string' && invite.actor.id.trim() === viewerSub) ||
          (normalizeOptionalEmail(invite?.email) && normalizeOptionalEmail(invite.email) === normalizedViewerEmail);

        if (!matchesViewer) {
          continue;
        }

        const summary = {
          workspaceId: record.workspaceId,
          boardId,
          boardTitle: board.title,
          inviteId: invite.id,
          role: invite.role,
          invitedAt: invite.invitedAt,
          invitedBy: {
            id: invite.invitedBy?.id ?? null,
            email: invite.invitedBy?.email ?? null,
            displayName: invite.invitedBy?.displayName ?? invite.invitedBy?.name ?? null
          }
        };
        const inviteKey = `${summary.workspaceId}:${summary.boardId}:${summary.inviteId}`;

        if (seenInviteKeys.has(inviteKey)) {
          continue;
        }

        seenInviteKeys.add(inviteKey);
        inviteSummaries.push(summary);
      }
    }
  }

  return inviteSummaries;
}

function listAccessibleWorkspaces(records, { viewerSub, viewerEmail = null, excludeWorkspaceId = null } = {}) {
  const summaries = [];
  const seenWorkspaceIds = new Set();

  for (const record of records) {
    const projectedRecord = createWorkspaceRecord(record);
    const projectedWorkspace = filterWorkspaceForViewer({
      viewerSub,
      viewerEmail,
      ownerSub: projectedRecord.viewerSub,
      workspace: projectedRecord.workspace
    });
    const boards = [];

    for (const boardId of projectedWorkspace.boardOrder ?? []) {
      const board = projectedWorkspace.boards?.[boardId];
      const membership = board?.collaboration?.memberships?.find((entry) => entry?.actor?.id === viewerSub);

      if (!board?.title || !membership?.role) {
        continue;
      }

      boards.push({
        boardId,
        boardTitle: board.title,
        role: membership.role
      });
    }

    if (
      !projectedRecord.workspaceId
      || projectedRecord.workspaceId === excludeWorkspaceId
      || boards.length === 0
      || seenWorkspaceIds.has(projectedRecord.workspaceId)
    ) {
      continue;
    }

    seenWorkspaceIds.add(projectedRecord.workspaceId);
    summaries.push({
      workspaceId: projectedRecord.workspaceId,
      isHomeWorkspace: projectedRecord.isHomeWorkspace === true,
      boards
    });
  }

  return summaries.sort((left, right) => {
    if (left.isHomeWorkspace && !right.isHomeWorkspace) {
      return -1;
    }

    if (!left.isHomeWorkspace && right.isHomeWorkspace) {
      return 1;
    }

    return left.workspaceId.localeCompare(right.workspaceId);
  });
}

function normalizeOptionalEmail(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

function addSharedBoard(workspace, boardId, title, { memberships = [], invites = [], card = null } = {}) {
  const sourceBoard = createEmptyWorkspace({
    workspaceId: `${workspace.workspaceId}_${boardId}`,
    creator: {
      type: 'human',
      id: 'sub_owner',
      email: 'owner@example.com'
    }
  }).boards.main;
  const board = structuredClone(sourceBoard);

  board.id = boardId;
  board.title = title;
  board.collaboration.memberships = memberships.map((membership) => structuredClone(membership));
  board.collaboration.invites = invites.map((invite) => structuredClone(invite));
  workspace.boards[boardId] = board;

  if (card) {
    return createCard(workspace, boardId, card);
  }

  return workspace;
}

function createLegacyWorkspaceSnapshot() {
  const workspace = createEmptyWorkspace();
  const board = workspace.boards.main;

  return {
    version: 4,
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
            title: 'Legacy import card',
            detailsMarkdown: 'Migrated through the API.',
            priority: 'important',
            createdAt: '2026-04-04T09:00:00.000Z',
            updatedAt: '2026-04-04T09:30:00.000Z'
          }
        }
      }
    }
  };
}

function firstCardTitle(board) {
  const firstCard = Object.values(board.cards)[0];
  return firstCard?.contentByLocale?.en?.title ?? null;
}
