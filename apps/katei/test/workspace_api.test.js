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
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
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
});

test('POST /api/workspace/commands returns the filtered resulting workspace', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_commands', {
    memberRole: 'admin',
    includeInvite: false
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
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
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble();
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
});

function createTestApp({ workspaceRecordRepository } = {}) {
  return createApp({
    env: {
      NODE_ENV: 'test',
      GOOGLE_CLIENT_ID: 'test-google-client-id',
      KATEI_SESSION_SECRET: 'test-session-secret'
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
