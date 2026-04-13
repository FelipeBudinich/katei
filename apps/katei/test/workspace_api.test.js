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
  WorkspaceBoardDeletionPermissionError,
  WorkspaceBoardRoleAssignmentPermissionError,
  WorkspaceCreationPermissionError,
  WorkspaceDeletionPermissionError,
  WorkspaceImportConflictError,
  WorkspaceRevisionConflictError,
  WorkspaceTitleManagementPermissionError
} from '../src/workspaces/workspace_record_repository.js';
import { canViewerAccessWorkspace, filterWorkspaceForViewer } from '../src/workspaces/workspace_access.js';
import { encryptBoardSecret } from '../src/security/board_secret_crypto.js';
import { OpenAiLocalizerError } from '../src/ai/openai_localizer.js';
import { OpenAiStagePromptRunnerError } from '../src/ai/openai_stage_prompt_runner.js';

function createReview(origin) {
  return {
    origin,
    verificationRequestedBy: null,
    verificationRequestedAt: null,
    verifiedBy: null,
    verifiedAt: null
  };
}

test('GET /api/workspace returns normalized actor-filtered shared workspace data', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_get', {
    workspaceTitle: 'Shared API workspace',
    memberRole: 'viewer',
    includeInvite: true
  });
  seedBoardOpenAiKey(sharedRecord.workspace.boards.member, 'sk-member-9876');
  const homeRecord = createHomeWorkspaceRecordFixture({
    viewerSub: 'sub_member',
    workspaceTitle: 'Member home'
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
  assert.deepEqual(response.body.workspace.boards.member.aiLocalization, {
    provider: 'openai',
    hasApiKey: true,
    apiKeyLast4: '9876'
  });
  assert.equal(response.body.workspace.boards.member.aiLocalizationSecrets, undefined);
  assert.deepEqual(response.body.activeWorkspace, {
    workspaceId: 'workspace_shared_api_get',
    workspaceTitle: 'Shared API workspace',
    isHomeWorkspace: false
  });
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
      workspaceTitle: 'Member home',
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

test('GET /api/workspace treats another viewer home workspace as an external accessible workspace', async () => {
  const homeRecord = createHomeWorkspaceRecordFixture({
    viewerSub: 'sub_member',
    boardTitle: '過程'
  });
  const foreignHomeRecord = createHomeWorkspaceRecordFixture({
    viewerSub: 'sub_owner_casa',
    boardTitle: 'Casa'
  });
  foreignHomeRecord.workspace.boards.main.collaboration.memberships.push({
    actor: { type: 'human', id: 'sub_member', email: 'member@example.com' },
    role: 'viewer',
    joinedAt: '2026-04-04T10:05:00.000Z'
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([
    homeRecord,
    foreignHomeRecord
  ]);
  const app = createTestApp({ workspaceRecordRepository });

  const response = await request(app)
    .get('/api/workspace')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }));

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.pendingWorkspaceInvites, []);
  assert.deepEqual(response.body.accessibleWorkspaces, [
    {
      workspaceId: foreignHomeRecord.workspaceId,
      workspaceTitle: null,
      isHomeWorkspace: false,
      boards: [
        {
          boardId: 'main',
          boardTitle: 'Casa',
          role: 'viewer'
        }
      ]
    }
  ]);
});

test('GET /api/workspace falls back from a stale workspaceId to the oldest pending invite board', async () => {
  const homeRecord = createHomeWorkspaceRecordFixture({
    viewerSub: 'sub_member',
    workspaceTitle: 'Member home'
  });
  const olderInviteRecord = createCrossWorkspaceInviteRecordFixture('workspace_invited_old', {
    viewerSub: 'sub_member',
    viewerEmail: 'member@example.com'
  });
  const newerInviteRecord = createCrossWorkspaceInviteRecordFixture('workspace_invited_new', {
    viewerSub: 'sub_member',
    viewerEmail: 'member@example.com'
  });

  olderInviteRecord.workspace.boards.casa.collaboration.invites[0].invitedAt = '2026-04-04T10:10:00.000Z';
  newerInviteRecord.workspace.boards.casa.collaboration.invites[0].invitedAt = '2026-04-04T10:20:00.000Z';

  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([
    homeRecord,
    olderInviteRecord,
    newerInviteRecord
  ]);
  const app = createTestApp({ workspaceRecordRepository });

  const response = await request(app)
    .get('/api/workspace?workspaceId=workspace_missing_target')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }));

  assert.equal(response.status, 200);
  assert.equal(response.body.activeWorkspace.workspaceId, 'workspace_invited_old');
  assert.equal(response.body.activeWorkspace.isHomeWorkspace, false);
  assert.equal(response.body.workspace.ui.activeBoardId, 'casa');
  assert.deepEqual(workspaceRecordRepository.resolveCalls, [
    {
      viewerSub: 'sub_member',
      viewerEmail: 'member@example.com',
      viewerName: 'Member',
      requestedWorkspaceId: 'workspace_missing_target'
    }
  ]);
});

test('POST /api/workspace/create lets super admins create a workspace with a default stored title', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble();
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'admin@example.com'
    },
    workspaceRecordRepository
  });

  const response = await request(app)
    .post('/api/workspace/create')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_admin', email: 'admin@example.com', name: 'Felipe Budinich' }))
    .send({
      title: '   '
    });

  assert.equal(response.status, 201);
  assert.deepEqual(response.body, {
    ok: true,
    result: {
      workspaceId: 'workspace_created_1',
      workspaceTitle: 'Felipe Budinich 1'
    }
  });
  assert.deepEqual(workspaceRecordRepository.createWorkspaceForSuperAdminCalls, [
    {
      viewerIsSuperAdmin: true,
      viewerSub: 'sub_admin',
      viewerEmail: 'admin@example.com',
      viewerName: 'Felipe Budinich',
      title: '   '
    }
  ]);
});

test('POST /api/workspace/create preserves explicit titles for super admins', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble();
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'admin@example.com'
    },
    workspaceRecordRepository
  });

  const response = await request(app)
    .post('/api/workspace/create')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_admin', email: 'admin@example.com', name: 'Felipe Budinich' }))
    .send({
      title: '  Studio HQ  '
    });

  assert.equal(response.status, 201);
  assert.deepEqual(response.body.result, {
    workspaceId: 'workspace_created_1',
    workspaceTitle: 'Studio HQ'
  });
});

test('POST /api/workspace/create rejects non-super-admin callers', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble();
  const app = createTestApp({ workspaceRecordRepository });

  const response = await request(app)
    .post('/api/workspace/create')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send({
      title: ''
    });

  assert.equal(response.status, 403);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error, 'Workspace creation is only available to super admins.');
});

test('POST /api/workspace/boards/delete lets super admins delete a board without board membership', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_admin_board_delete', {
    includeInvite: false
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'admin@example.com'
    },
    workspaceRecordRepository
  });

  const response = await request(app)
    .post('/api/workspace/boards/delete')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_admin', email: 'admin@example.com', name: 'Admin' }))
    .send({
      workspaceId: sharedRecord.workspaceId,
      boardId: 'main'
    });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true,
    result: {
      workspaceId: sharedRecord.workspaceId,
      boardId: 'main'
    }
  });
  assert.deepEqual(workspaceRecordRepository.loadSuperAdminBoardDeletionCalls, [
    {
      viewerIsSuperAdmin: true,
      workspaceId: sharedRecord.workspaceId
    }
  ]);
  assert.equal(workspaceRecordRepository.loadAuthoritativeCalls.length, 0);
  assert.equal(workspaceRecordRepository.replaceRecordCalls.length, 1);
  assert.deepEqual(workspaceRecordRepository.getStoredRecord(sharedRecord.workspaceId)?.workspace.boardOrder, ['member']);
  assert.equal(workspaceRecordRepository.getStoredRecord(sharedRecord.workspaceId)?.workspace.ui.activeBoardId, 'member');
});

test('POST /api/workspace/boards/delete lets super admins delete the last remaining board', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_admin_delete_last_board', {
    includeInvite: false
  });
  sharedRecord.workspace.boardOrder = ['main'];
  sharedRecord.workspace.boards = {
    main: structuredClone(sharedRecord.workspace.boards.main)
  };
  sharedRecord.workspace.ui.activeBoardId = 'main';

  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'admin@example.com'
    },
    workspaceRecordRepository
  });

  const response = await request(app)
    .post('/api/workspace/boards/delete')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_admin', email: 'admin@example.com', name: 'Admin' }))
    .send({
      workspaceId: sharedRecord.workspaceId,
      boardId: 'main'
    });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true,
    result: {
      workspaceId: sharedRecord.workspaceId,
      boardId: 'main'
    }
  });
  assert.deepEqual(workspaceRecordRepository.getStoredRecord(sharedRecord.workspaceId)?.workspace.boardOrder, []);
  assert.deepEqual(workspaceRecordRepository.getStoredRecord(sharedRecord.workspaceId)?.workspace.boards, {});
  assert.equal(workspaceRecordRepository.getStoredRecord(sharedRecord.workspaceId)?.workspace.ui.activeBoardId, null);
});

test('POST /api/workspace/delete lets super admins delete an entire workspace', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_admin_workspace_delete');
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'admin@example.com'
    },
    workspaceRecordRepository
  });

  const response = await request(app)
    .post('/api/workspace/delete')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_admin', email: 'admin@example.com', name: 'Admin' }))
    .send({
      workspaceId: sharedRecord.workspaceId
    });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true,
    result: {
      workspaceId: sharedRecord.workspaceId
    }
  });
  assert.deepEqual(workspaceRecordRepository.deleteWorkspaceForSuperAdminCalls, [
    {
      viewerIsSuperAdmin: true,
      workspaceId: sharedRecord.workspaceId
    }
  ]);
  assert.equal(workspaceRecordRepository.getStoredRecord(sharedRecord.workspaceId), null);
});

test('POST /api/workspace/boards/delete rejects non-super-admin callers', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_admin_delete_forbidden');
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({ workspaceRecordRepository });

  const response = await request(app)
    .post('/api/workspace/boards/delete')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send({
      workspaceId: sharedRecord.workspaceId,
      boardId: 'main'
    });

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, {
    ok: false,
    error: 'Board deletion is only available to super admins.'
  });
  assert.deepEqual(workspaceRecordRepository.loadSuperAdminBoardDeletionCalls, [
    {
      viewerIsSuperAdmin: false,
      workspaceId: sharedRecord.workspaceId
    }
  ]);
  assert.equal(workspaceRecordRepository.replaceRecordCalls.length, 0);
});

test('POST /api/workspace/delete returns 404 when the workspace is missing', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble();
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'admin@example.com'
    },
    workspaceRecordRepository
  });

  const response = await request(app)
    .post('/api/workspace/delete')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_admin', email: 'admin@example.com', name: 'Admin' }))
    .send({
      workspaceId: 'workspace_missing_delete_target'
    });

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, {
    ok: false,
    error: 'Workspace not found.'
  });
  assert.deepEqual(workspaceRecordRepository.deleteWorkspaceForSuperAdminCalls, [
    {
      viewerIsSuperAdmin: true,
      workspaceId: 'workspace_missing_delete_target'
    }
  ]);
});

test('POST /api/workspace/boards/delete returns 404 when the board is missing', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_admin_missing_board');
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'admin@example.com'
    },
    workspaceRecordRepository
  });

  const response = await request(app)
    .post('/api/workspace/boards/delete')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_admin', email: 'admin@example.com', name: 'Admin' }))
    .send({
      workspaceId: sharedRecord.workspaceId,
      boardId: 'missing_board'
    });

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, {
    ok: false,
    error: 'Board not found.'
  });
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
      workspaceTitle: null,
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

test('POST /api/workspace/commands loads workspace.title.set through the super-admin title management seam', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_admin_title', {
    workspaceTitle: 'Old workspace title',
    includeInvite: false
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'admin@example.com'
    },
    workspaceRecordRepository
  });

  const response = await request(app)
    .post('/api/workspace/commands')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_admin', email: 'admin@example.com', name: 'Admin' }))
    .send({
      workspaceId: sharedRecord.workspaceId,
      command: {
        clientMutationId: 'workspace_title_admin_1',
        type: 'workspace.title.set',
        payload: {
          title: '  Studio HQ  '
        }
      },
      expectedRevision: sharedRecord.revision
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.workspace.title, 'Studio HQ');
  assert.deepEqual(response.body.workspace.boardOrder, []);
  assert.deepEqual(Object.keys(response.body.workspace.boards), []);
  assert.deepEqual(response.body.activeWorkspace, {
    workspaceId: sharedRecord.workspaceId,
    workspaceTitle: 'Studio HQ',
    isHomeWorkspace: false
  });
  assert.deepEqual(response.body.result, {
    clientMutationId: 'workspace_title_admin_1',
    type: 'workspace.title.set',
    noOp: false,
    workspaceId: sharedRecord.workspaceId,
    workspaceTitle: 'Studio HQ'
  });
  assert.deepEqual(workspaceRecordRepository.loadAuthoritativeCalls, []);
  assert.deepEqual(workspaceRecordRepository.loadSuperAdminTitleManagementCalls, [
    {
      viewerIsSuperAdmin: true,
      workspaceId: sharedRecord.workspaceId
    }
  ]);
  assert.deepEqual(workspaceRecordRepository.loadSuperAdminBoardRoleAssignmentCalls, []);
  assert.equal(workspaceRecordRepository.replaceRecordCalls.length, 1);
});

test('POST /api/workspace/commands rejects workspace.title.set for non-super-admin callers before membership checks', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_admin_title_forbidden', {
    memberRole: 'admin',
    includeInvite: false
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({ workspaceRecordRepository });

  const response = await request(app)
    .post('/api/workspace/commands')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send({
      workspaceId: sharedRecord.workspaceId,
      command: {
        clientMutationId: 'workspace_title_admin_forbidden_1',
        type: 'workspace.title.set',
        payload: {
          title: 'Forbidden title'
        }
      },
      expectedRevision: sharedRecord.revision
    });

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, {
    ok: false,
    error: 'Workspace title management is only available to super admins.'
  });
  assert.deepEqual(workspaceRecordRepository.loadAuthoritativeCalls, []);
  assert.deepEqual(workspaceRecordRepository.loadSuperAdminTitleManagementCalls, [
    {
      viewerIsSuperAdmin: false,
      workspaceId: sharedRecord.workspaceId
    }
  ]);
  assert.deepEqual(workspaceRecordRepository.loadSuperAdminBoardRoleAssignmentCalls, []);
  assert.equal(workspaceRecordRepository.replaceRecordCalls.length, 0);
});

test('POST /api/workspace/commands keeps unrelated commands on the normal authoritative load path', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_normal_command_path', {
    memberRole: 'admin',
    includeInvite: false
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({ workspaceRecordRepository });

  const response = await request(app)
    .post('/api/workspace/commands')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send({
      workspaceId: sharedRecord.workspaceId,
      command: {
        clientMutationId: 'rename_member_board_normal_path_1',
        type: 'board.rename',
        payload: {
          boardId: 'member',
          title: 'Member board renamed again'
        }
      },
      expectedRevision: sharedRecord.revision
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.workspace.boards.member.title, 'Member board renamed again');
  assert.deepEqual(workspaceRecordRepository.loadAuthoritativeCalls, [
    {
      viewerSub: 'sub_member',
      viewerEmail: 'member@example.com',
      viewerName: 'Member',
      workspaceId: sharedRecord.workspaceId
    }
  ]);
  assert.deepEqual(workspaceRecordRepository.loadSuperAdminTitleManagementCalls, []);
  assert.deepEqual(workspaceRecordRepository.loadSuperAdminBoardRoleAssignmentCalls, []);
  assert.equal(workspaceRecordRepository.replaceRecordCalls.length, 1);
});

test('POST /api/workspace/commands loads board.self.role.set through the board-level seam and keeps workspace visibility board-derived', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_self_role_assign', {
    includeInvite: false
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'admin@example.com'
    },
    workspaceRecordRepository
  });

  const response = await request(app)
    .post('/api/workspace/commands')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_admin', email: 'admin@example.com', name: 'Admin' }))
    .send({
      workspaceId: sharedRecord.workspaceId,
      command: {
        clientMutationId: 'board_self_role_assign_1',
        type: 'board.self.role.set',
        payload: {
          boardId: 'main',
          role: 'viewer'
        }
      },
      expectedRevision: sharedRecord.revision
    });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.workspace.boardOrder, ['main']);
  assert.deepEqual(Object.keys(response.body.workspace.boards), ['main']);
  assert.equal(response.body.workspace.boards.member, undefined);
  assert.deepEqual(response.body.result, {
    clientMutationId: 'board_self_role_assign_1',
    type: 'board.self.role.set',
    noOp: false,
    boardId: 'main',
    targetActor: {
      type: 'human',
      id: 'sub_admin',
      email: 'admin@example.com',
      displayName: 'Admin'
    },
    role: 'viewer'
  });
  assert.deepEqual(workspaceRecordRepository.loadAuthoritativeCalls, []);
  assert.deepEqual(workspaceRecordRepository.loadSuperAdminTitleManagementCalls, []);
  assert.deepEqual(workspaceRecordRepository.loadSuperAdminBoardRoleAssignmentCalls, [
    {
      viewerIsSuperAdmin: true,
      workspaceId: sharedRecord.workspaceId
    }
  ]);
});

test('POST /api/workspace/commands rejects board.self.role.set for non-super-admin callers before membership checks', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_self_role_forbidden', {
    memberRole: 'viewer',
    includeInvite: false
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({ workspaceRecordRepository });

  const response = await request(app)
    .post('/api/workspace/commands')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send({
      workspaceId: sharedRecord.workspaceId,
      command: {
        clientMutationId: 'board_self_role_forbidden_1',
        type: 'board.self.role.set',
        payload: {
          boardId: 'main',
          role: 'viewer'
        }
      },
      expectedRevision: sharedRecord.revision
    });

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, {
    ok: false,
    error: 'Board self-role assignment is only available to super admins.'
  });
  assert.deepEqual(workspaceRecordRepository.loadAuthoritativeCalls, []);
  assert.deepEqual(workspaceRecordRepository.loadSuperAdminBoardRoleAssignmentCalls, [
    {
      viewerIsSuperAdmin: false,
      workspaceId: sharedRecord.workspaceId
    }
  ]);
  assert.deepEqual(workspaceRecordRepository.loadSuperAdminTitleManagementCalls, []);
});

test('POST /api/workspace/commands does not add a super-admin self-removal seam', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_self_remove_forbidden', {
    includeInvite: false
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'admin@example.com'
    },
    workspaceRecordRepository
  });

  const response = await request(app)
    .post('/api/workspace/commands')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_admin', email: 'admin@example.com', name: 'Admin' }))
    .send({
      workspaceId: sharedRecord.workspaceId,
      command: {
        clientMutationId: 'board_self_remove_1',
        type: 'board.member.remove',
        payload: {
          boardId: 'main',
          targetActor: {
            type: 'human',
            id: 'sub_admin'
          }
        }
      },
      expectedRevision: sharedRecord.revision
    });

  assert.equal(response.status, 404);
  assert.deepEqual(workspaceRecordRepository.loadSuperAdminBoardRoleAssignmentCalls, []);
  assert.deepEqual(workspaceRecordRepository.loadAuthoritativeCalls, [
    {
      viewerSub: 'sub_admin',
      viewerEmail: 'admin@example.com',
      viewerName: 'Admin',
      workspaceId: sharedRecord.workspaceId
    }
  ]);
});

test('POST /api/workspace/commands redacts board OpenAI secrets from mutation responses', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_ai_update', {
    memberRole: 'admin',
    includeInvite: false
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({ workspaceRecordRepository });

  const response = await request(app)
    .post('/api/workspace/commands')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send({
      workspaceId: 'workspace_shared_api_ai_update',
      command: {
        clientMutationId: 'board_ai_update_1',
        type: 'board.update',
        payload: {
          boardId: 'member',
          title: sharedRecord.workspace.boards.member.title,
          aiProvider: 'openai',
          openAiApiKey: 'sk-board-1234',
          clearOpenAiApiKey: false,
          languagePolicy: sharedRecord.workspace.boards.member.languagePolicy,
          stageDefinitions: sharedRecord.workspace.boards.member.stageOrder.map((stageId) => ({
            id: stageId,
            title: sharedRecord.workspace.boards.member.stages[stageId].title,
            allowedTransitionStageIds: [...sharedRecord.workspace.boards.member.stages[stageId].allowedTransitionStageIds],
            actionIds: [...sharedRecord.workspace.boards.member.stages[stageId].actionIds]
          })),
          templates: []
        }
      },
      expectedRevision: 1
    });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.workspace.boards.member.aiLocalization, {
    provider: 'openai',
    hasApiKey: true,
    apiKeyLast4: '1234'
  });
  assert.equal(response.body.workspace.boards.member.aiLocalizationSecrets, undefined);
  assert.equal(response.body.result.noOp, false);
});

test('POST /api/workspace/commands rejects deleting a card outside a delete-enabled stage', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_delete_rejected', {
    memberRole: 'editor',
    includeInvite: false
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({ workspaceRecordRepository });
  const memberBoard = sharedRecord.workspace.boards.member;
  const cardId = Object.keys(memberBoard.cards)[0];

  const response = await request(app)
    .post('/api/workspace/commands')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send({
      workspaceId: 'workspace_shared_api_delete_rejected',
      command: {
        clientMutationId: 'member_card_delete_rejected',
        type: 'card.delete',
        payload: {
          boardId: 'member',
          cardId
        }
      },
      expectedRevision: 1
    });

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, {
    ok: false,
    error: 'Cards can only be deleted in delete-enabled stages.'
  });
});

test('POST /api/workspace/commands approves card review without moving the card and persists an activity event', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_card_review_approve', {
    memberRole: 'editor',
    includeInvite: false
  });
  const memberBoard = sharedRecord.workspace.boards.member;
  const cardId = Object.keys(memberBoard.cards)[0];
  const contentUpdatedAt = memberBoard.cards[cardId].updatedAt;

  memberBoard.stages.todo.actions = ['card.create', 'card.review'];
  memberBoard.stages.todo.actionIds = ['card.create', 'card.review'];
  memberBoard.cards[cardId].workflowReview = {
    required: true,
    currentStageId: 'todo',
    status: 'pending',
    decidedAt: null,
    decidedBy: null,
    decidedByRole: null
  };

  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({ workspaceRecordRepository });

  const response = await request(app)
    .post('/api/workspace/commands')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send({
      workspaceId: 'workspace_shared_api_card_review_approve',
      command: {
        clientMutationId: 'approve_member_card_review',
        type: 'card.review.approve',
        payload: {
          boardId: 'member',
          cardId
        }
      },
      expectedRevision: 1
    });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.result, {
    clientMutationId: 'approve_member_card_review',
    type: 'card.review.approve',
    noOp: false,
    boardId: 'member',
    cardId,
    stageId: 'todo',
    status: 'approved'
  });
  assert.deepEqual(response.body.workspace.boards.member.stages.todo.cardIds, [cardId]);

  const persistedRecord = await workspaceRecordRepository.loadOrCreateAuthoritativeWorkspaceRecord({
    viewerSub: 'sub_member',
    viewerEmail: 'member@example.com',
    viewerName: 'Member',
    workspaceId: sharedRecord.workspaceId
  });
  const latestActivityEvent = persistedRecord.activityEvents.at(-1);
  const decidedAt = response.body.workspace.boards.member.cards[cardId].workflowReview.decidedAt;

  assert.deepEqual(response.body.workspace.boards.member.cards[cardId].workflowReview, {
    required: true,
    currentStageId: 'todo',
    status: 'approved',
    decidedAt,
    decidedBy: {
      type: 'human',
      id: 'sub_member',
      email: 'member@example.com',
      displayName: 'Member'
    },
    decidedByRole: 'editor'
  });
  assert.equal(decidedAt, latestActivityEvent.createdAt);

  assert.equal(latestActivityEvent.type, 'workspace.card.review.approved');
  assert.deepEqual(latestActivityEvent.details, {
    stageId: 'todo',
    previousStatus: 'pending',
    nextStatus: 'approved',
    decidedByRole: 'editor',
    contentUpdatedAt
  });
});

test('POST /api/workspace/commands rejects viewer review decisions', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_card_review_forbidden', {
    memberRole: 'viewer',
    includeInvite: false
  });
  const memberBoard = sharedRecord.workspace.boards.member;
  const cardId = Object.keys(memberBoard.cards)[0];

  memberBoard.stages.todo.actions = ['card.create', 'card.review'];
  memberBoard.stages.todo.actionIds = ['card.create', 'card.review'];
  memberBoard.cards[cardId].workflowReview = {
    required: true,
    currentStageId: 'todo',
    status: 'pending',
    decidedAt: null,
    decidedBy: null,
    decidedByRole: null
  };

  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({ workspaceRecordRepository });

  const response = await request(app)
    .post('/api/workspace/commands')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send({
      workspaceId: 'workspace_shared_api_card_review_forbidden',
      command: {
        clientMutationId: 'reject_member_card_review',
        type: 'card.review.reject',
        payload: {
          boardId: 'member',
          cardId
        }
      },
      expectedRevision: 1
    });

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, {
    ok: false,
    error: 'You do not have permission to review this card.'
  });
});

test('POST /api/workspace/localizations/generate writes localized content, clears requests, and redacts board OpenAI secrets', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_localize_success', {
    memberRole: 'editor',
    includeInvite: false
  });
  const { cardId } = configureBoardForLocalization(sharedRecord.workspace.boards.member, {
    targetLocale: 'ja',
    includeOpenRequest: true
  });
  const openAiLocalizer = createOpenAiLocalizerDouble({
    title: '会員ボードカード',
    detailsMarkdown: '共同編集者に表示されます。'
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({ workspaceRecordRepository, openAiLocalizer });

  const response = await request(app)
    .post('/api/workspace/localizations/generate')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send({
      workspaceId: 'workspace_shared_api_localize_success',
      clientMutationId: 'generate_member_ja_1',
      boardId: 'member',
      cardId,
      targetLocale: 'ja',
      expectedRevision: 1
    });

  assert.equal(response.status, 200);
  assert.equal(openAiLocalizer.calls.length, 1);
  assert.equal(openAiLocalizer.calls[0].apiKey, 'sk-member-board-9876');
  assert.equal(openAiLocalizer.calls[0].sourceLocale, 'en');
  assert.equal(openAiLocalizer.calls[0].targetLocale, 'ja');
  assert.deepEqual(response.body.workspace.boards.member.cards[cardId].contentByLocale.ja, {
    title: '会員ボードカード',
    detailsMarkdown: '共同編集者に表示されます。',
    provenance: {
      actor: {
        type: 'agent',
        id: 'openai-localizer'
      },
      timestamp: response.body.workspace.boards.member.cards[cardId].contentByLocale.ja.provenance.timestamp,
      includesHumanInput: false
    },
    review: createReview('ai')
  });
  assert.deepEqual(response.body.workspace.boards.member.cards[cardId].localeRequests, {});
  assert.equal(response.body.workspace.boards.member.aiLocalizationSecrets, undefined);
  assert.deepEqual(response.body.workspace.boards.member.aiLocalization, {
    provider: 'openai',
    hasApiKey: true,
    apiKeyLast4: '9876'
  });
  assert.deepEqual(response.body.result, {
    clientMutationId: 'generate_member_ja_1',
    type: 'card.locale.generate',
    noOp: false,
    boardId: 'member',
    cardId,
    locale: 'ja',
    sourceLocale: 'en'
  });
});

test('POST /api/workspace/localizations/generate returns 403 for unauthorized actors', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_localize_forbidden', {
    memberRole: 'viewer',
    includeInvite: false
  });
  const { cardId } = configureBoardForLocalization(sharedRecord.workspace.boards.member, {
    targetLocale: 'ja',
    includeOpenRequest: true
  });
  const openAiLocalizer = createOpenAiLocalizerDouble();
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({ workspaceRecordRepository, openAiLocalizer });

  const response = await request(app)
    .post('/api/workspace/localizations/generate')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send({
      workspaceId: 'workspace_shared_api_localize_forbidden',
      clientMutationId: 'generate_member_ja_forbidden',
      boardId: 'member',
      cardId,
      targetLocale: 'ja',
      expectedRevision: 1
    });

  assert.equal(response.status, 403);
  assert.equal(response.body.errorCode, 'WORKSPACE_COMMAND_FORBIDDEN');
  assert.equal(openAiLocalizer.calls.length, 0);
});

test('POST /api/workspace/localizations/generate returns 400 when the board has no OpenAI key', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_localize_missing_key', {
    memberRole: 'editor',
    includeInvite: false
  });
  const { cardId } = configureBoardForLocalization(sharedRecord.workspace.boards.member, {
    targetLocale: 'ja',
    seedApiKey: false
  });
  const openAiLocalizer = createOpenAiLocalizerDouble();
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({ workspaceRecordRepository, openAiLocalizer });

  const response = await request(app)
    .post('/api/workspace/localizations/generate')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send({
      workspaceId: 'workspace_shared_api_localize_missing_key',
      clientMutationId: 'generate_member_ja_missing_key',
      boardId: 'member',
      cardId,
      targetLocale: 'ja',
      expectedRevision: 1
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.errorCode, 'BOARD_OPENAI_KEY_MISSING');
  assert.equal(openAiLocalizer.calls.length, 0);
});

test('POST /api/workspace/localizations/generate returns 400 for unsupported locales', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_localize_unsupported', {
    memberRole: 'editor',
    includeInvite: false
  });
  const { cardId } = configureBoardForLocalization(sharedRecord.workspace.boards.member, {
    targetLocale: 'es-CL',
    supportedLocales: ['en', 'ja']
  });
  const openAiLocalizer = createOpenAiLocalizerDouble();
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({ workspaceRecordRepository, openAiLocalizer });

  const response = await request(app)
    .post('/api/workspace/localizations/generate')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send({
      workspaceId: 'workspace_shared_api_localize_unsupported',
      clientMutationId: 'generate_member_escl_unsupported',
      boardId: 'member',
      cardId,
      targetLocale: 'es-CL',
      expectedRevision: 1
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.errorCode, 'TARGET_LOCALE_UNSUPPORTED');
  assert.equal(openAiLocalizer.calls.length, 0);
});

test('POST /api/workspace/localizations/generate returns 400 when source locale content is missing', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_localize_source_missing', {
    memberRole: 'editor',
    includeInvite: false
  });
  const { cardId } = configureBoardForLocalization(sharedRecord.workspace.boards.member, {
    targetLocale: 'ja'
  });
  const openAiLocalizer = createOpenAiLocalizerDouble({
    error: new OpenAiLocalizerError('Source locale content is required before generating a localization.', {
      code: 'SOURCE_LOCALE_MISSING',
      status: 400
    })
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({ workspaceRecordRepository, openAiLocalizer });

  const response = await request(app)
    .post('/api/workspace/localizations/generate')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send({
      workspaceId: 'workspace_shared_api_localize_source_missing',
      clientMutationId: 'generate_member_ja_source_missing',
      boardId: 'member',
      cardId,
      targetLocale: 'ja',
      expectedRevision: 1
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.errorCode, 'SOURCE_LOCALE_MISSING');
  assert.equal(openAiLocalizer.calls.length, 1);
});

test('POST /api/workspace/localizations/generate returns 409 for revision conflicts', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_localize_conflict', {
    memberRole: 'editor',
    includeInvite: false
  });
  const { cardId } = configureBoardForLocalization(sharedRecord.workspace.boards.member, {
    targetLocale: 'ja'
  });
  const openAiLocalizer = createOpenAiLocalizerDouble();
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({ workspaceRecordRepository, openAiLocalizer });

  const response = await request(app)
    .post('/api/workspace/localizations/generate')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send({
      workspaceId: 'workspace_shared_api_localize_conflict',
      clientMutationId: 'generate_member_ja_conflict',
      boardId: 'member',
      cardId,
      targetLocale: 'ja',
      expectedRevision: 0
    });

  assert.equal(response.status, 409);
  assert.equal(response.body.errorCode, 'WORKSPACE_REVISION_CONFLICT');
  assert.equal(openAiLocalizer.calls.length, 0);
});

test('POST /api/workspace/localizations/generate returns 409 when human-authored localized content already exists', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_localize_human_conflict', {
    memberRole: 'editor',
    includeInvite: false
  });
  const { cardId } = configureBoardForLocalization(sharedRecord.workspace.boards.member, {
    targetLocale: 'ja',
    existingTargetVariant: {
      title: '既存タイトル',
      detailsMarkdown: '既存本文',
      provenance: {
        actor: { type: 'human', id: 'sub_member' },
        timestamp: '2026-04-04T10:35:00.000Z',
        includesHumanInput: true
      }
    }
  });
  const openAiLocalizer = createOpenAiLocalizerDouble();
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({ workspaceRecordRepository, openAiLocalizer });

  const response = await request(app)
    .post('/api/workspace/localizations/generate')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send({
      workspaceId: 'workspace_shared_api_localize_human_conflict',
      clientMutationId: 'generate_member_ja_human_conflict',
      boardId: 'member',
      cardId,
      targetLocale: 'ja',
      expectedRevision: 1
    });

  assert.equal(response.status, 409);
  assert.equal(response.body.errorCode, 'LOCALIZATION_HUMAN_AUTHORED_CONFLICT');
  assert.equal(openAiLocalizer.calls.length, 0);
});

test('POST /api/workspace/localizations/generate returns 502 when OpenAI generation fails upstream', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_localize_upstream', {
    memberRole: 'editor',
    includeInvite: false
  });
  const { cardId } = configureBoardForLocalization(sharedRecord.workspace.boards.member, {
    targetLocale: 'ja'
  });
  const openAiLocalizer = createOpenAiLocalizerDouble({
    error: new OpenAiLocalizerError('OpenAI could not generate the localization.', {
      code: 'OPENAI_UPSTREAM_ERROR',
      status: 502
    })
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({ workspaceRecordRepository, openAiLocalizer });

  const response = await request(app)
    .post('/api/workspace/localizations/generate')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send({
      workspaceId: 'workspace_shared_api_localize_upstream',
      clientMutationId: 'generate_member_ja_upstream',
      boardId: 'member',
      cardId,
      targetLocale: 'ja',
      expectedRevision: 1
    });

  assert.equal(response.status, 502);
  assert.equal(response.body.errorCode, 'OPENAI_UPSTREAM_ERROR');
});

test('POST /api/workspace/stage-prompts/run creates a new AI-authored card in the target stage and leaves the source card unchanged', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_stage_prompt_success', {
    memberRole: 'editor',
    includeInvite: false
  });
  const { cardId, sourceStageId, targetStageId } = configureBoardForStagePrompt(sharedRecord.workspace.boards.member);
  const openAiStagePromptRunner = createOpenAiStagePromptRunnerDouble({
    title: 'Generated implementation task',
    detailsMarkdown: 'Ship the implementation details.',
    priority: 'important'
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({ workspaceRecordRepository, openAiStagePromptRunner });
  const sourceCardBefore = structuredClone(sharedRecord.workspace.boards.member.cards[cardId]);

  const response = await request(app)
    .post('/api/workspace/stage-prompts/run')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send({
      workspaceId: 'workspace_shared_api_stage_prompt_success',
      clientMutationId: 'stage_prompt_member_1',
      boardId: 'member',
      cardId,
      expectedRevision: 1
    });

  assert.equal(response.status, 200);
  assert.equal(openAiStagePromptRunner.calls.length, 1);
  assert.equal(openAiStagePromptRunner.calls[0].apiKey, 'sk-member-board-9876');
  assert.equal(openAiStagePromptRunner.calls[0].sourceLocale, 'en');
  assert.equal(openAiStagePromptRunner.calls[0].stageId, sourceStageId);
  assert.deepEqual(openAiStagePromptRunner.calls[0].promptAction, {
    enabled: true,
    prompt: 'Turn this card into a new implementation task.',
    targetStageId
  });
  assert.deepEqual(response.body.workspace.boards.member.cards[cardId], sourceCardBefore);

  const createdCardId = response.body.result.createdCardId;
  const createdCard = response.body.workspace.boards.member.cards[createdCardId];

  assert.ok(createdCardId);
  assert.ok(createdCard);
  assert.deepEqual(createdCard.localeRequests, {});
  assert.equal(createdCard.priority, 'important');
  assert.deepEqual(createdCard.generation, {
    source: 'stage-prompt',
    sourceCardId: cardId,
    sourceStageId,
    actionId: 'card.prompt.run',
    targetStageId
  });
  assert.deepEqual(createdCard.contentByLocale.en, {
    title: 'Generated implementation task',
    detailsMarkdown: 'Ship the implementation details.',
    provenance: {
      actor: {
        type: 'agent',
        id: 'openai-stage-prompt-runner'
      },
      timestamp: createdCard.contentByLocale.en.provenance.timestamp,
      includesHumanInput: false
    },
    review: createReview('ai')
  });
  assert.equal(
    response.body.workspace.boards.member.stages[targetStageId].cardIds.includes(createdCardId),
    true
  );
  assert.deepEqual(response.body.result, {
    clientMutationId: 'stage_prompt_member_1',
    type: 'card.stage-prompt.run',
    noOp: false,
    boardId: 'member',
    sourceCardId: cardId,
    createdCardId,
    sourceStageId,
    targetStageId
  });
});

test('POST /api/workspace/stage-prompts/run rejects stages without the prompt-run action', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_stage_prompt_disabled', {
    memberRole: 'editor',
    includeInvite: false
  });
  const { cardId } = configureBoardForStagePrompt(sharedRecord.workspace.boards.member, {
    includePromptRunAction: false
  });
  const openAiStagePromptRunner = createOpenAiStagePromptRunnerDouble();
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({ workspaceRecordRepository, openAiStagePromptRunner });

  const response = await request(app)
    .post('/api/workspace/stage-prompts/run')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send({
      workspaceId: 'workspace_shared_api_stage_prompt_disabled',
      clientMutationId: 'stage_prompt_member_disabled',
      boardId: 'member',
      cardId,
      expectedRevision: 1
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.errorCode, 'STAGE_PROMPT_ACTION_DISABLED');
  assert.equal(openAiStagePromptRunner.calls.length, 0);
});

test('POST /api/workspace/stage-prompts/run rejects missing prompt action config', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_stage_prompt_missing_config', {
    memberRole: 'editor',
    includeInvite: false
  });
  const { cardId } = configureBoardForStagePrompt(sharedRecord.workspace.boards.member, {
    includePromptAction: false
  });
  const openAiStagePromptRunner = createOpenAiStagePromptRunnerDouble();
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord], {
    allowInvalidWorkspaceIds: ['workspace_shared_api_stage_prompt_missing_config']
  });
  const app = createTestApp({ workspaceRecordRepository, openAiStagePromptRunner });

  const response = await request(app)
    .post('/api/workspace/stage-prompts/run')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send({
      workspaceId: 'workspace_shared_api_stage_prompt_missing_config',
      clientMutationId: 'stage_prompt_member_missing_config',
      boardId: 'member',
      cardId,
      expectedRevision: 1
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.errorCode, 'STAGE_PROMPT_ACTION_CONFIG_MISSING');
  assert.equal(openAiStagePromptRunner.calls.length, 0);
});

test('POST /api/workspace/stage-prompts/run returns 400 when the board has no OpenAI key', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_stage_prompt_missing_key', {
    memberRole: 'editor',
    includeInvite: false
  });
  const { cardId } = configureBoardForStagePrompt(sharedRecord.workspace.boards.member, {
    seedApiKey: false
  });
  const openAiStagePromptRunner = createOpenAiStagePromptRunnerDouble();
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({ workspaceRecordRepository, openAiStagePromptRunner });

  const response = await request(app)
    .post('/api/workspace/stage-prompts/run')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send({
      workspaceId: 'workspace_shared_api_stage_prompt_missing_key',
      clientMutationId: 'stage_prompt_member_missing_key',
      boardId: 'member',
      cardId,
      expectedRevision: 1
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.errorCode, 'BOARD_OPENAI_KEY_MISSING');
  assert.equal(openAiStagePromptRunner.calls.length, 0);
});

test('POST /api/workspace/stage-prompts/run returns 400 when source locale content is missing', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_stage_prompt_source_missing', {
    memberRole: 'editor',
    includeInvite: false
  });
  const { cardId } = configureBoardForStagePrompt(sharedRecord.workspace.boards.member, {
    removeSourceContent: true
  });
  const openAiStagePromptRunner = createOpenAiStagePromptRunnerDouble();
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord], {
    allowInvalidWorkspaceIds: ['workspace_shared_api_stage_prompt_source_missing']
  });
  const app = createTestApp({ workspaceRecordRepository, openAiStagePromptRunner });

  const response = await request(app)
    .post('/api/workspace/stage-prompts/run')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send({
      workspaceId: 'workspace_shared_api_stage_prompt_source_missing',
      clientMutationId: 'stage_prompt_member_source_missing',
      boardId: 'member',
      cardId,
      expectedRevision: 1
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.errorCode, 'SOURCE_LOCALE_MISSING');
  assert.equal(openAiStagePromptRunner.calls.length, 0);
});

test('POST /api/workspace/stage-prompts/run returns 409 for revision conflicts', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_stage_prompt_conflict', {
    memberRole: 'editor',
    includeInvite: false
  });
  const { cardId } = configureBoardForStagePrompt(sharedRecord.workspace.boards.member);
  const openAiStagePromptRunner = createOpenAiStagePromptRunnerDouble();
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({ workspaceRecordRepository, openAiStagePromptRunner });

  const response = await request(app)
    .post('/api/workspace/stage-prompts/run')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send({
      workspaceId: 'workspace_shared_api_stage_prompt_conflict',
      clientMutationId: 'stage_prompt_member_conflict',
      boardId: 'member',
      cardId,
      expectedRevision: 0
    });

  assert.equal(response.status, 409);
  assert.equal(response.body.errorCode, 'WORKSPACE_REVISION_CONFLICT');
  assert.equal(openAiStagePromptRunner.calls.length, 0);
});

test('POST /api/workspace/stage-prompts/run returns 502 when the model output is invalid', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_stage_prompt_invalid_output', {
    memberRole: 'editor',
    includeInvite: false
  });
  const { cardId } = configureBoardForStagePrompt(sharedRecord.workspace.boards.member);
  const openAiStagePromptRunner = createOpenAiStagePromptRunnerDouble({
    error: new OpenAiStagePromptRunnerError('OpenAI returned an invalid card priority.', {
      code: 'STAGE_PROMPT_OUTPUT_INVALID',
      status: 502
    })
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({ workspaceRecordRepository, openAiStagePromptRunner });

  const response = await request(app)
    .post('/api/workspace/stage-prompts/run')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send({
      workspaceId: 'workspace_shared_api_stage_prompt_invalid_output',
      clientMutationId: 'stage_prompt_member_invalid_output',
      boardId: 'member',
      cardId,
      expectedRevision: 1
    });

  assert.equal(response.status, 502);
  assert.equal(response.body.errorCode, 'STAGE_PROMPT_OUTPUT_INVALID');
});

test('POST /api/workspace/stage-prompts/run replays the stored result for duplicate clientMutationId requests', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_api_stage_prompt_duplicate', {
    memberRole: 'editor',
    includeInvite: false
  });
  const { cardId } = configureBoardForStagePrompt(sharedRecord.workspace.boards.member);
  const openAiStagePromptRunner = createOpenAiStagePromptRunnerDouble({
    title: 'Generated duplicate-safe task',
    detailsMarkdown: 'Created once.',
    priority: 'normal'
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({ workspaceRecordRepository, openAiStagePromptRunner });
  const requestBody = {
    workspaceId: 'workspace_shared_api_stage_prompt_duplicate',
    clientMutationId: 'stage_prompt_member_duplicate',
    boardId: 'member',
    cardId,
    expectedRevision: 1
  };

  const firstResponse = await request(app)
    .post('/api/workspace/stage-prompts/run')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send(requestBody);

  const duplicateResponse = await request(app)
    .post('/api/workspace/stage-prompts/run')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }))
    .send(requestBody);

  assert.equal(firstResponse.status, 200);
  assert.equal(duplicateResponse.status, 200);
  assert.equal(openAiStagePromptRunner.calls.length, 1);
  assert.deepEqual(duplicateResponse.body.result, firstResponse.body.result);
  assert.equal(
    duplicateResponse.body.workspace.boards.member.stages.doing.cardIds.includes(firstResponse.body.result.createdCardId),
    true
  );
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

function createTestApp({
  env = {},
  googleTokenVerifier,
  workspaceRecordRepository,
  openAiLocalizer = null,
  openAiStagePromptRunner = null
} = {}) {
  return createApp({
    env: {
      NODE_ENV: 'test',
      GOOGLE_CLIENT_ID: 'test-google-client-id',
      KATEI_SESSION_SECRET: 'test-session-secret',
      KATEI_BOARD_SECRET_ENCRYPTION_KEY: 'test-board-secret-encryption-key',
      MONGODB_URI: 'mongodb://127.0.0.1:27017',
      MONGODB_DB_NAME: 'katei_test',
      ...env
    },
    googleTokenVerifier: googleTokenVerifier ?? (async () => ({ sub: 'sub_any' })),
    workspaceRecordRepository: workspaceRecordRepository ?? createWorkspaceRecordRepositoryDouble(),
    openAiLocalizer,
    openAiStagePromptRunner
  });
}

function createOpenAiLocalizerDouble({
  title = 'Localized title',
  detailsMarkdown = 'Localized details',
  error = null
} = {}) {
  return {
    calls: [],
    async generateLocalization(input) {
      this.calls.push(structuredClone(input));

      if (error) {
        throw error;
      }

      return {
        provider: 'openai',
        actor: {
          type: 'agent',
          id: 'openai-localizer'
        },
        sourceLocale: input.sourceLocale,
        targetLocale: input.targetLocale,
        title,
        detailsMarkdown,
        model: 'gpt-5.4-mini'
      };
    }
  };
}

function createOpenAiStagePromptRunnerDouble({
  title = 'Generated task',
  detailsMarkdown = 'Generated details',
  priority = 'important',
  error = null
} = {}) {
  return {
    calls: [],
    async runStagePrompt(input) {
      this.calls.push(structuredClone(input));

      if (error) {
        throw error;
      }

      return {
        provider: 'openai',
        actor: {
          type: 'agent',
          id: 'openai-stage-prompt-runner'
        },
        sourceLocale: input.sourceLocale,
        sourceStageId: input.stageId,
        targetStageId: input.promptAction.targetStageId,
        title,
        detailsMarkdown,
        priority,
        model: 'gpt-5.4-mini'
      };
    }
  };
}

function configureBoardForLocalization(board, {
  targetLocale = 'ja',
  supportedLocales = ['en', targetLocale],
  requiredLocales = ['en'],
  seedApiKey = true,
  includeOpenRequest = false,
  removeSourceContent = false,
  existingTargetVariant = null
} = {}) {
  board.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales,
    requiredLocales
  };

  if (seedApiKey) {
    seedBoardOpenAiKey(board, 'sk-member-board-9876');
  } else {
    board.aiLocalization = {
      provider: 'openai',
      hasApiKey: false,
      apiKeyLast4: null
    };
    delete board.aiLocalizationSecrets;
  }

  const [cardId] = Object.keys(board.cards);
  const card = board.cards[cardId];

  if (removeSourceContent) {
    delete card.contentByLocale.en;
  }

  if (includeOpenRequest) {
    card.localeRequests = {
      [targetLocale]: {
        locale: targetLocale,
        status: 'open',
        requestedBy: {
          type: 'human',
          id: 'sub_member'
        },
        requestedAt: '2026-04-04T10:35:00.000Z'
      }
    };
  } else {
    card.localeRequests = {};
  }

  if (existingTargetVariant) {
    card.contentByLocale[targetLocale] = structuredClone(existingTargetVariant);
  } else {
    delete card.contentByLocale[targetLocale];
  }

  return { cardId };
}

function configureBoardForStagePrompt(board, {
  sourceStageId = 'todo',
  targetStageId = 'doing',
  includePromptRunAction = true,
  includePromptAction = true,
  seedApiKey = true,
  removeSourceContent = false
} = {}) {
  board.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en'],
    requiredLocales: ['en']
  };

  if (seedApiKey) {
    seedBoardOpenAiKey(board, 'sk-member-board-9876');
  } else {
    board.aiLocalization = {
      provider: 'openai',
      hasApiKey: false,
      apiKeyLast4: null
    };
    delete board.aiLocalizationSecrets;
  }

  const [cardId] = Object.keys(board.cards);
  const card = board.cards[cardId];

  for (const stage of Object.values(board.stages)) {
    stage.cardIds = Array.isArray(stage.cardIds) ? stage.cardIds.filter((currentCardId) => currentCardId !== cardId) : [];
  }

  board.stages[sourceStageId].cardIds.push(cardId);
  board.stages[sourceStageId].actions = includePromptRunAction ? ['card.prompt.run'] : [];
  board.stages[sourceStageId].actionIds = includePromptRunAction ? ['card.prompt.run'] : [];

  if (includePromptAction) {
    board.stages[sourceStageId].promptAction = {
      enabled: true,
      prompt: 'Turn this card into a new implementation task.',
      targetStageId
    };
  } else {
    delete board.stages[sourceStageId].promptAction;
  }

  if (removeSourceContent) {
    delete card.contentByLocale.en;
  }

  return {
    cardId,
    sourceStageId,
    targetStageId
  };
}

function seedBoardOpenAiKey(board, apiKey) {
  board.aiLocalization = {
    provider: 'openai',
    hasApiKey: true,
    apiKeyLast4: apiKey.slice(-4)
  };
  board.aiLocalizationSecrets = {
    openAiApiKeyEncrypted: encryptBoardSecret(apiKey, {
      boardSecretEncryptionKey: 'test-board-secret-encryption-key'
    })
  };
}

function createSessionCookieHeader(viewer, { ttlSeconds = 300, now = '2099-01-01T00:00:00Z' } = {}) {
  const payload = createSessionPayload(viewer, ttlSeconds, new Date(now));
  const value = createSignedSessionCookieValue(payload, 'test-session-secret');
  return `${KATEI_SESSION_COOKIE_NAME}=${value}`;
}

function createWorkspaceRecordRepositoryDouble(initialRecords = [], { allowInvalidWorkspaceIds = [] } = {}) {
  const records = new Map(initialRecords.map((record) => [record.workspaceId, structuredClone(record)]));
  const invalidWorkspaceIdSet = new Set(
    Array.isArray(allowInvalidWorkspaceIds) ? allowInvalidWorkspaceIds : []
  );

  function findExistingHomeRecord(viewerSub) {
    const homeWorkspaceId = createHomeWorkspaceId(viewerSub);

    return records.get(homeWorkspaceId)
      ?? records.get(viewerSub)
      ?? [...records.values()].find((record) => record.viewerSub === viewerSub && record.isHomeWorkspace);
  }

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

  function resolveVisibleBoardId(workspace) {
    const activeBoardId =
      typeof workspace?.ui?.activeBoardId === 'string' && workspace.ui.activeBoardId.trim()
        ? workspace.ui.activeBoardId.trim()
        : null;

    if (activeBoardId && workspace?.boards?.[activeBoardId]) {
      return activeBoardId;
    }

    return Array.isArray(workspace?.boardOrder) && workspace.boardOrder.length > 0
      ? workspace.boardOrder[0]
      : null;
  }

  function createResolvedWorkspaceResult(record, { viewerSub, resolvedBoardId, resolution } = {}) {
    const normalizedBoardId = typeof resolvedBoardId === 'string' && resolvedBoardId.trim()
      ? resolvedBoardId.trim()
      : null;
    const normalizedRecord = structuredClone(record);

    if (!normalizedBoardId || !normalizedRecord?.workspace?.boards?.[normalizedBoardId]) {
      return null;
    }

    normalizedRecord.isHomeWorkspace = normalizedRecord.workspaceId === createHomeWorkspaceId(viewerSub);
    normalizedRecord.workspace.ui = {
      ...(normalizedRecord.workspace.ui ?? {}),
      activeBoardId: normalizedBoardId
    };

    return {
      record: normalizedRecord,
      resolvedWorkspaceId: normalizedRecord.workspaceId,
      resolvedBoardId: normalizedBoardId,
      resolution
    };
  }

  function createHomeRecord(viewerSub, viewerName = null, viewerEmail = null) {
    return createInitialWorkspaceRecord(viewerSub, {
      title: typeof viewerName === 'string' && viewerName.trim() ? `${viewerName.trim()} 1` : 'Workspace 1',
      now: '2026-04-04T10:00:00.000Z',
      creator: {
        email: viewerEmail,
        displayName: viewerName
      }
    });
  }

  function repairHomeRecord(existingRecord, viewerSub, viewerName = null, viewerEmail = null) {
    const homeWorkspaceId = createHomeWorkspaceId(viewerSub);
    const repairedRecord = createHomeRecord(viewerSub, viewerName, viewerEmail);
    repairedRecord.workspaceId = homeWorkspaceId;
    repairedRecord.workspace.workspaceId = homeWorkspaceId;
    repairedRecord.workspace.title = existingRecord?.workspace?.title ?? repairedRecord.workspace.title;
    repairedRecord.createdAt = existingRecord?.createdAt ?? repairedRecord.createdAt;
    repairedRecord.updatedAt = '2026-04-04T11:00:00.000Z';
    repairedRecord.revision = (Number.isInteger(existingRecord?.revision) ? existingRecord.revision : 0) + 1;
    repairedRecord.isHomeWorkspace = true;
    return repairedRecord;
  }

  async function resolvePreferredWorkspace({ viewerSub, viewerEmail = null, viewerName = null, requestedWorkspaceId = null } = {}) {
    const normalizedRequestedWorkspaceId =
      typeof requestedWorkspaceId === 'string' && requestedWorkspaceId.trim()
        ? requestedWorkspaceId.trim()
        : null;

    if (normalizedRequestedWorkspaceId) {
      try {
        const requestedRecord = projectRecord(
          await loadFullRecord({ viewerSub, viewerEmail, viewerName, workspaceId: normalizedRequestedWorkspaceId }),
          { viewerSub, viewerEmail }
        );
        const requestedBoardId = resolveVisibleBoardId(requestedRecord.workspace);

        if (requestedBoardId) {
          return createResolvedWorkspaceResult(requestedRecord, {
            viewerSub,
            resolvedBoardId: requestedBoardId,
            resolution: 'requested-workspace'
          });
        }
      } catch (error) {
        if (!(error instanceof WorkspaceAccessDeniedError)) {
          throw error;
        }
      }
    } else {
      const existingHomeRecord = findExistingHomeRecord(viewerSub);

      if (existingHomeRecord) {
        const projectedHomeRecord = projectRecord(existingHomeRecord, { viewerSub, viewerEmail });
        const homeBoardId = resolveVisibleBoardId(projectedHomeRecord.workspace);

        if (homeBoardId) {
          return createResolvedWorkspaceResult(projectedHomeRecord, {
            viewerSub,
            resolvedBoardId: homeBoardId,
            resolution: 'fallback-existing-home'
          });
        }
      }
    }

    const pendingInvite = listPendingWorkspaceInvites(records.values(), { viewerSub, viewerEmail })
      .sort(compareInviteSummaries)[0] ?? null;

    if (pendingInvite) {
      const inviteRecord = projectRecord(
        await loadFullRecord({ viewerSub, viewerEmail, viewerName, workspaceId: pendingInvite.workspaceId }),
        { viewerSub, viewerEmail }
      );

      if (inviteRecord.workspace.boards?.[pendingInvite.boardId]) {
        return createResolvedWorkspaceResult(inviteRecord, {
          viewerSub,
          resolvedBoardId: pendingInvite.boardId,
          resolution: 'fallback-pending-invite'
        });
      }
    }

    const accessibleBoardCandidates = [];

    for (const record of records.values()) {
      const projectedRecord = projectRecord(record, { viewerSub, viewerEmail });

      if (projectedRecord.workspaceId === createHomeWorkspaceId(viewerSub)) {
        continue;
      }

      for (const boardId of projectedRecord.workspace.boardOrder ?? []) {
        const board = projectedRecord.workspace.boards?.[boardId];
        const membership = board?.collaboration?.memberships?.find((entry) => entry?.actor?.id === viewerSub);

        if (!board?.title || !membership?.role) {
          continue;
        }

        accessibleBoardCandidates.push({
          record: projectedRecord,
          workspaceId: projectedRecord.workspaceId,
          boardId,
          workspaceCreatedAt: projectedRecord.createdAt ?? '',
          boardCreatedAt: board.createdAt ?? ''
        });
      }
    }

    accessibleBoardCandidates.sort(compareAccessibleBoardCandidates);

    if (accessibleBoardCandidates.length > 0) {
      const firstCandidate = accessibleBoardCandidates[0];

      return createResolvedWorkspaceResult(firstCandidate.record, {
        viewerSub,
        resolvedBoardId: firstCandidate.boardId,
        resolution: 'fallback-accessible-board'
      });
    }

    if (normalizedRequestedWorkspaceId) {
      const existingHomeRecord = findExistingHomeRecord(viewerSub);

      if (existingHomeRecord) {
        const projectedHomeRecord = projectRecord(existingHomeRecord, { viewerSub, viewerEmail });
        const homeBoardId = resolveVisibleBoardId(projectedHomeRecord.workspace);

        if (homeBoardId) {
          return createResolvedWorkspaceResult(projectedHomeRecord, {
            viewerSub,
            resolvedBoardId: homeBoardId,
            resolution: 'fallback-existing-home'
          });
        }
      }
    }

    const existingHomeRecord = findExistingHomeRecord(viewerSub);

    if (!existingHomeRecord) {
      const createdHomeRecord = await loadFullRecord({ viewerSub, viewerEmail, viewerName });
      const projectedHomeRecord = projectRecord(createdHomeRecord, { viewerSub, viewerEmail });

      return createResolvedWorkspaceResult(projectedHomeRecord, {
        viewerSub,
        resolvedBoardId: resolveVisibleBoardId(projectedHomeRecord.workspace),
        resolution: 'fallback-created-home'
      });
    }

    const repairedHomeRecord = repairHomeRecord(existingHomeRecord, viewerSub, viewerName, viewerEmail);
    records.set(repairedHomeRecord.workspaceId, structuredClone(repairedHomeRecord));
    const projectedRepairedHomeRecord = projectRecord(repairedHomeRecord, { viewerSub, viewerEmail });

    return createResolvedWorkspaceResult(projectedRepairedHomeRecord, {
      viewerSub,
      resolvedBoardId: resolveVisibleBoardId(projectedRepairedHomeRecord.workspace),
      resolution: 'fallback-repaired-home'
    });
  }

  async function loadFullRecord({ viewerSub, viewerEmail = null, viewerName = null, workspaceId = null } = {}) {
    if (workspaceId) {
      const requestedRecord = records.get(workspaceId);
      if (requestedRecord && invalidWorkspaceIdSet.has(workspaceId)) {
        return structuredClone(requestedRecord);
      }
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
    const existingHomeRecord = findExistingHomeRecord(viewerSub);

    if (existingHomeRecord) {
      return createWorkspaceRecord(existingHomeRecord);
    }

    if (!records.has(homeWorkspaceId)) {
      records.set(homeWorkspaceId, createHomeRecord(viewerSub, viewerName, viewerEmail));
    }

    return createWorkspaceRecord(records.get(homeWorkspaceId));
  }

  async function loadRecordForSuperAdminTitleManagement(workspaceId) {
    const normalizedWorkspaceId = typeof workspaceId === 'string' ? workspaceId.trim() : '';
    const record = normalizedWorkspaceId ? records.get(normalizedWorkspaceId) : null;

    if (!record) {
      throw new WorkspaceAccessDeniedError();
    }

    return createWorkspaceRecord(record);
  }

  return {
    resolveCalls: [],
    replaceCalls: [],
    replaceRecordCalls: [],
    loadAuthoritativeCalls: [],
    loadSuperAdminTitleManagementCalls: [],
    loadSuperAdminBoardRoleAssignmentCalls: [],
    loadSuperAdminBoardDeletionCalls: [],
    createWorkspaceForSuperAdminCalls: [],
    deleteWorkspaceForSuperAdminCalls: [],

    async loadOrCreateWorkspaceRecord({ viewerSub, viewerEmail = null, viewerName = null, workspaceId = null } = {}) {
      return projectRecord(
        await loadFullRecord({ viewerSub, viewerEmail, viewerName, workspaceId }),
        { viewerSub, viewerEmail }
      );
    },

    async resolvePreferredWorkspaceForViewer({
      viewerSub,
      viewerEmail = null,
      viewerName = null,
      requestedWorkspaceId = null
    } = {}) {
      this.resolveCalls.push({
        viewerSub,
        viewerEmail,
        viewerName,
        requestedWorkspaceId
      });

      return resolvePreferredWorkspace({
        viewerSub,
        viewerEmail,
        viewerName,
        requestedWorkspaceId
      });
    },

    async loadOrCreateAuthoritativeWorkspaceRecord({ viewerSub, viewerEmail = null, viewerName = null, workspaceId = null } = {}) {
      this.loadAuthoritativeCalls.push({
        viewerSub,
        viewerEmail,
        viewerName,
        workspaceId
      });
      return loadFullRecord({ viewerSub, viewerEmail, viewerName, workspaceId });
    },

    async createWorkspaceForSuperAdmin({
      viewerIsSuperAdmin = false,
      viewerSub,
      viewerEmail = null,
      viewerName = null,
      title = undefined
    } = {}) {
      this.createWorkspaceForSuperAdminCalls.push({
        viewerIsSuperAdmin,
        viewerSub,
        viewerEmail,
        viewerName,
        title
      });

      if (viewerIsSuperAdmin !== true) {
        throw new WorkspaceCreationPermissionError();
      }

      const workspaceId = `workspace_created_${this.createWorkspaceForSuperAdminCalls.length}`;
      const normalizedTitle = typeof title === 'string' && title.trim()
        ? title.trim()
        : `${typeof viewerName === 'string' && viewerName.trim() ? viewerName.trim() : 'Workspace'} 1`;
      const record = createInitialWorkspaceRecord(viewerSub, {
        workspaceId,
        title: normalizedTitle,
        now: '2026-04-04T10:00:00.000Z',
        creator: {
          email: viewerEmail,
          displayName: viewerName
        }
      });

      record.isHomeWorkspace = false;
      records.set(workspaceId, record);
      return createWorkspaceRecord(record);
    },

    async loadWorkspaceRecordForSuperAdminTitleManagement({ viewerIsSuperAdmin = false, workspaceId } = {}) {
      this.loadSuperAdminTitleManagementCalls.push({
        viewerIsSuperAdmin,
        workspaceId
      });

      if (viewerIsSuperAdmin !== true) {
        throw new WorkspaceTitleManagementPermissionError();
      }

      return loadRecordForSuperAdminTitleManagement(workspaceId);
    },

    async loadWorkspaceRecordForSuperAdminBoardRoleAssignment({ viewerIsSuperAdmin = false, workspaceId } = {}) {
      this.loadSuperAdminBoardRoleAssignmentCalls.push({
        viewerIsSuperAdmin,
        workspaceId
      });

      if (viewerIsSuperAdmin !== true) {
        throw new WorkspaceBoardRoleAssignmentPermissionError();
      }

      return loadRecordForSuperAdminTitleManagement(workspaceId);
    },

    async loadWorkspaceRecordForSuperAdminBoardDeletion({ viewerIsSuperAdmin = false, workspaceId } = {}) {
      this.loadSuperAdminBoardDeletionCalls.push({
        viewerIsSuperAdmin,
        workspaceId
      });

      if (viewerIsSuperAdmin !== true) {
        throw new WorkspaceBoardDeletionPermissionError();
      }

      return loadRecordForSuperAdminTitleManagement(workspaceId);
    },

    async deleteWorkspaceForSuperAdmin({ viewerIsSuperAdmin = false, workspaceId } = {}) {
      this.deleteWorkspaceForSuperAdminCalls.push({
        viewerIsSuperAdmin,
        workspaceId
      });

      if (viewerIsSuperAdmin !== true) {
        throw new WorkspaceDeletionPermissionError();
      }

      await loadRecordForSuperAdminTitleManagement(workspaceId);
      records.delete(workspaceId);
    },

    async listPendingWorkspaceInvitesForViewer({ viewerSub, viewerEmail = null } = {}) {
      return listPendingWorkspaceInvites(records.values(), { viewerSub, viewerEmail });
    },

    async listAccessibleWorkspacesForViewer({ viewerSub, viewerEmail = null, viewerName = null, excludeWorkspaceId = null } = {}) {
      await loadFullRecord({ viewerSub, viewerEmail, viewerName });
      return listAccessibleWorkspaces(records.values(), { viewerSub, viewerEmail, excludeWorkspaceId });
    },

    async replaceWorkspaceSnapshot({
      viewerSub,
      viewerEmail = null,
      viewerName = null,
      workspaceId = null,
      workspace,
      actor,
      expectedRevision
    }) {
      this.replaceCalls.push({
        viewerSub,
        viewerEmail,
        viewerName,
        workspaceId,
        workspace,
        actor,
        expectedRevision
      });

      const currentRecord = await loadFullRecord({ viewerSub, viewerEmail, viewerName, workspaceId });

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

    async importWorkspaceSnapshot({ viewerSub, viewerEmail = null, viewerName = null, workspaceId = null, workspace, actor }) {
      const currentRecord = await loadFullRecord({ viewerSub, viewerEmail, viewerName, workspaceId });

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
      this.replaceRecordCalls.push({
        record,
        expectedRevision
      });

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
    },

    getStoredRecord(workspaceId) {
      const record = records.get(workspaceId);
      return record ? createWorkspaceRecord(record) : null;
    }
  };
}

function createHomeWorkspaceRecordFixture({
  viewerSub = 'sub_member',
  workspaceTitle = null,
  boardTitle = 'Home board'
} = {}) {
  const initialRecord = createInitialWorkspaceRecord(viewerSub, {
    workspaceId: createHomeWorkspaceId(viewerSub),
    now: '2026-04-04T09:30:00.000Z'
  });
  const workspace = structuredClone(initialRecord.workspace);

  workspace.boards.main.title = boardTitle;
  workspace.title = workspaceTitle;

  return createUpdatedWorkspaceRecord(initialRecord, {
    workspace,
    actor: {
      type: 'human',
      id: viewerSub
    },
    now: '2026-04-04T09:45:00.000Z'
  });
}

function createSharedWorkspaceRecordFixture(
  workspaceId,
  { workspaceTitle = null, memberRole = 'viewer', includeInvite = true } = {}
) {
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
  workspace.title = workspaceTitle;

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

function compareInviteSummaries(left, right) {
  const invitedAtComparison = String(left?.invitedAt ?? '').localeCompare(String(right?.invitedAt ?? ''));

  if (invitedAtComparison !== 0) {
    return invitedAtComparison;
  }

  const workspaceComparison = String(left?.workspaceId ?? '').localeCompare(String(right?.workspaceId ?? ''));

  if (workspaceComparison !== 0) {
    return workspaceComparison;
  }

  const boardComparison = String(left?.boardId ?? '').localeCompare(String(right?.boardId ?? ''));

  if (boardComparison !== 0) {
    return boardComparison;
  }

  return String(left?.inviteId ?? '').localeCompare(String(right?.inviteId ?? ''));
}

function compareAccessibleBoardCandidates(left, right) {
  const workspaceCreatedAtComparison = String(left?.workspaceCreatedAt ?? '').localeCompare(String(right?.workspaceCreatedAt ?? ''));

  if (workspaceCreatedAtComparison !== 0) {
    return workspaceCreatedAtComparison;
  }

  const boardCreatedAtComparison = String(left?.boardCreatedAt ?? '').localeCompare(String(right?.boardCreatedAt ?? ''));

  if (boardCreatedAtComparison !== 0) {
    return boardCreatedAtComparison;
  }

  const workspaceComparison = String(left?.workspaceId ?? '').localeCompare(String(right?.workspaceId ?? ''));

  if (workspaceComparison !== 0) {
    return workspaceComparison;
  }

  return String(left?.boardId ?? '').localeCompare(String(right?.boardId ?? ''));
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
      workspaceTitle:
        typeof projectedWorkspace?.title === 'string' && projectedWorkspace.title.trim()
          ? projectedWorkspace.title.trim()
          : null,
      isHomeWorkspace: projectedRecord.workspaceId === createHomeWorkspaceId(viewerSub),
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
