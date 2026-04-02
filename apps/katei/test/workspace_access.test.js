import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCard,
  createEmptyWorkspace
} from '../public/js/domain/workspace.js';
import { encryptBoardSecret } from '../src/security/board_secret_crypto.js';
import {
  canViewerAccessWorkspace,
  canViewerReadBoard,
  canViewerReplaceWorkspaceSnapshot,
  filterWorkspaceForViewer,
  listViewerPendingBoardInvites
} from '../src/workspaces/workspace_access.js';

test('owner can access and keep every board in a shared workspace projection', () => {
  const workspace = createSharedWorkspaceFixture();

  const filteredWorkspace = filterWorkspaceForViewer({
    viewerSub: 'sub_owner',
    ownerSub: 'sub_owner',
    workspace
  });

  assert.equal(canViewerAccessWorkspace({
    viewerSub: 'sub_owner',
    ownerSub: 'sub_owner',
    workspace
  }), true);
  assert.equal(canViewerReplaceWorkspaceSnapshot({
    viewerSub: 'sub_owner',
    ownerSub: 'sub_owner',
    workspace
  }), true);
  assert.deepEqual(filteredWorkspace.boardOrder, ['main', 'member', 'invite']);
  assert.equal(filteredWorkspace.ui.activeBoardId, 'main');
  assert.equal(filteredWorkspace.ui.collapsedColumnsByBoard, undefined);
  assert.equal(firstCardTitle(filteredWorkspace.boards.main), 'Owner board card');
  assert.equal(firstCardTitle(filteredWorkspace.boards.invite), 'Invite board card');
});

test('member projections keep only readable boards and correct the active board when a hidden board was selected', () => {
  const workspace = createSharedWorkspaceFixture();

  const filteredWorkspace = filterWorkspaceForViewer({
    viewerSub: 'sub_member',
    viewerEmail: 'member@example.com',
    ownerSub: 'sub_owner',
    workspace
  });

  assert.equal(canViewerReadBoard({
    viewerSub: 'sub_member',
    board: workspace.boards.main
  }), false);
  assert.equal(canViewerReadBoard({
    viewerSub: 'sub_member',
    board: workspace.boards.member
  }), true);
  assert.equal(canViewerReplaceWorkspaceSnapshot({
    viewerSub: 'sub_member',
    viewerEmail: 'member@example.com',
    ownerSub: 'sub_owner',
    workspace
  }), false);
  assert.deepEqual(filteredWorkspace.boardOrder, ['member']);
  assert.deepEqual(Object.keys(filteredWorkspace.boards), ['member']);
  assert.equal(filteredWorkspace.ui.activeBoardId, 'member');
});

test('workspace projections expose only safe board AI metadata and redact encrypted secrets', () => {
  const workspace = createSharedWorkspaceFixture();

  seedBoardOpenAiKey(workspace.boards.main, 'sk-owner-1234');
  seedBoardOpenAiKey(workspace.boards.member, 'sk-member-9876');

  const ownerProjection = filterWorkspaceForViewer({
    viewerSub: 'sub_owner',
    ownerSub: 'sub_owner',
    workspace
  });
  const memberProjection = filterWorkspaceForViewer({
    viewerSub: 'sub_member',
    viewerEmail: 'member@example.com',
    ownerSub: 'sub_owner',
    workspace
  });

  assert.deepEqual(ownerProjection.boards.main.aiLocalization, {
    provider: 'openai',
    hasApiKey: true,
    apiKeyLast4: '1234'
  });
  assert.equal(ownerProjection.boards.main.aiLocalizationSecrets, undefined);
  assert.deepEqual(memberProjection.boards.member.aiLocalization, {
    provider: 'openai',
    hasApiKey: true,
    apiKeyLast4: '9876'
  });
  assert.equal(memberProjection.boards.member.aiLocalizationSecrets, undefined);
});

test('pending-invite viewers keep a visible redacted board shell for acceptance flows', () => {
  const workspace = createSharedWorkspaceFixture();

  const filteredWorkspace = filterWorkspaceForViewer({
    viewerSub: 'sub_invited',
    viewerEmail: 'invitee@example.com',
    ownerSub: 'sub_owner',
    workspace
  });

  assert.equal(canViewerAccessWorkspace({
    viewerSub: 'sub_invited',
    viewerEmail: 'invitee@example.com',
    ownerSub: 'sub_owner',
    workspace
  }), true);
  assert.equal(canViewerReadBoard({
    viewerSub: 'sub_invited',
    viewerEmail: 'invitee@example.com',
    board: workspace.boards.invite
  }), false);
  assert.deepEqual(
    listViewerPendingBoardInvites({
      viewerSub: 'sub_invited',
      viewerEmail: 'invitee@example.com',
      workspace
    }),
    [
      {
        boardId: 'invite',
        boardTitle: 'Invite board',
        invite: workspace.boards.invite.collaboration.invites[0]
      }
    ]
  );
  assert.deepEqual(filteredWorkspace.boardOrder, ['invite']);
  assert.equal(filteredWorkspace.ui.activeBoardId, 'invite');
  assert.equal(filteredWorkspace.boards.invite.title, 'Invite board');
  assert.deepEqual(filteredWorkspace.boards.invite.cards, {});
  assert.equal(filteredWorkspace.boards.invite.collaboration.invites[0].email, 'invitee@example.com');
  assert.equal(filteredWorkspace.boards.invite.stages.backlog.cardIds.length, 0);
});

test('unrelated viewers lose board visibility and workspace access', () => {
  const workspace = createSharedWorkspaceFixture();

  const filteredWorkspace = filterWorkspaceForViewer({
    viewerSub: 'sub_blocked',
    viewerEmail: 'blocked@example.com',
    ownerSub: 'sub_owner',
    workspace
  });

  assert.equal(canViewerAccessWorkspace({
    viewerSub: 'sub_blocked',
    viewerEmail: 'blocked@example.com',
    ownerSub: 'sub_owner',
    workspace
  }), false);
  assert.deepEqual(filteredWorkspace.boardOrder, []);
  assert.deepEqual(filteredWorkspace.boards, {});
  assert.equal(filteredWorkspace.ui.activeBoardId, null);
});

function firstCardTitle(board) {
  const firstCard = Object.values(board.cards)[0];
  return firstCard?.contentByLocale?.en?.title ?? null;
}

function createSharedWorkspaceFixture() {
  let workspace = createCard(
    createEmptyWorkspace({
      workspaceId: 'workspace_shared_visibility',
      creator: {
        type: 'human',
        id: 'sub_owner',
        email: 'owner@example.com'
      }
    }),
    'main',
    {
      title: 'Owner board card',
      detailsMarkdown: 'Only the owner should see this card.',
      priority: 'important'
    }
  );

  renameBoard(workspace.boards.main, 'main', 'Owner board');
  workspace.boards.main.collaboration.memberships = [
    {
      actor: { type: 'human', id: 'sub_owner', email: 'owner@example.com' },
      role: 'admin',
      joinedAt: workspace.boards.main.createdAt
    }
  ];

  workspace = addBoard(workspace, 'member', 'Member board', {
    memberships: [
      {
        actor: { type: 'human', id: 'sub_member', email: 'member@example.com' },
        role: 'editor',
        joinedAt: '2026-04-05T10:00:00.000Z'
      }
    ],
    card: {
      title: 'Member board card',
      detailsMarkdown: 'Visible to the member.',
      priority: 'urgent'
    }
  });
  workspace = addBoard(workspace, 'invite', 'Invite board', {
    invites: [
      {
        id: 'invite_1',
        email: 'invitee@example.com',
        role: 'viewer',
        status: 'pending',
        invitedBy: { type: 'human', id: 'sub_owner', email: 'owner@example.com' },
        invitedAt: '2026-04-05T11:00:00.000Z'
      }
    ],
    card: {
      title: 'Invite board card',
      detailsMarkdown: 'This content should be redacted for invite-only actors.',
      priority: 'normal'
    }
  });

  workspace.boardOrder = ['main', 'member', 'invite'];
  workspace.ui.activeBoardId = 'main';

  return workspace;
}

function addBoard(workspace, boardId, title, { memberships = [], invites = [], card = null } = {}) {
  const sourceBoard = createEmptyWorkspace({
    workspaceId: `${workspace.workspaceId}_${boardId}`,
    creator: {
      type: 'human',
      id: 'sub_owner',
      email: 'owner@example.com'
    }
  }).boards.main;
  const board = structuredClone(sourceBoard);

  renameBoard(board, boardId, title);
  board.collaboration.memberships = memberships.map((membership) => structuredClone(membership));
  board.collaboration.invites = invites.map((invite) => structuredClone(invite));
  workspace.boards[boardId] = board;

  if (card) {
    return createCard(workspace, boardId, card);
  }

  return workspace;
}

function renameBoard(board, boardId, title) {
  board.id = boardId;
  board.title = title;
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
