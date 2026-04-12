import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyWorkspace } from '../public/js/domain/workspace_read_model.js';
import { findColumnIdByCardId, getActiveBoard } from '../public/js/domain/workspace_selectors.js';
import { validateWorkspaceShape } from '../public/js/domain/workspace_validation.js';
import { createCard, updateCard } from '../public/js/domain/workspace_mutations.js';

test('createCard stores detailsMarkdown on new cards', () => {
  const workspace = createEmptyWorkspace();
  const nextWorkspace = createCard(workspace, 'main', {
    title: 'Write launch notes',
    detailsMarkdown: '## Launch\n\n- confirm copy',
    priority: 'urgent'
  });
  const board = nextWorkspace.boards.main;
  const [cardId] = board.stages.backlog.cardIds;

  assert.deepEqual(board.cards[cardId].contentByLocale.en.title, 'Write launch notes');
  assert.deepEqual(board.cards[cardId].contentByLocale.en.detailsMarkdown, '## Launch\n\n- confirm copy');
  assert.deepEqual(board.cards[cardId].localeRequests, {});
  assert.equal(board.cards[cardId].priority, 'urgent');
});

test('createCard starts workflowReview as pending when the stage supports card.review', () => {
  const workspace = createEmptyWorkspace();

  workspace.boards.main.stages.backlog.actions = ['card.create', 'card.review'];
  workspace.boards.main.stages.backlog.actionIds = ['card.create', 'card.review'];

  const nextWorkspace = createCard(workspace, 'main', {
    title: 'Workflow review card',
    detailsMarkdown: 'Needs approval',
    priority: 'important',
    requiresReview: true
  });
  const board = nextWorkspace.boards.main;
  const [cardId] = board.stages.backlog.cardIds;

  assert.deepEqual(board.cards[cardId].workflowReview, {
    required: true,
    currentStageId: 'backlog',
    status: 'pending',
    decidedAt: null,
    decidedBy: null,
    decidedByRole: null
  });
  assert.equal(validateWorkspaceShape(nextWorkspace), true);
});

test('createCard inserts into an explicitly requested create-enabled stage', () => {
  const workspace = createEmptyWorkspace();
  const nextWorkspace = createCard(workspace, 'main', {
    stageId: 'doing',
    title: 'Review analytics',
    detailsMarkdown: 'Check the new retention slice',
    priority: 'important'
  });
  const board = nextWorkspace.boards.main;
  const [cardId] = board.stages.doing.cardIds;

  assert.equal(board.stages.backlog.cardIds.length, 0);
  assert.equal(cardId in board.cards, true);
});

test('updateCard updates detailsMarkdown on existing cards', () => {
  const workspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Write launch notes',
    detailsMarkdown: 'Initial note',
    priority: 'important'
  });
  const board = workspace.boards.main;
  const [cardId] = board.stages.backlog.cardIds;
  const nextWorkspace = updateCard(workspace, 'main', cardId, {
    detailsMarkdown: 'Updated **markdown**'
  });

  assert.equal(
    nextWorkspace.boards.main.cards[cardId].contentByLocale.en.detailsMarkdown,
    'Updated **markdown**'
  );
  assert.equal(nextWorkspace.boards.main.cards[cardId].priority, 'important');
});

test('validateWorkspaceShape accepts cards that use detailsMarkdown', () => {
  const workspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Ship rollout',
    detailsMarkdown: 'Plain details',
    priority: 'normal'
  });

  assert.equal(validateWorkspaceShape(workspace), true);
});

test('validateWorkspaceShape accepts titled workspaces', () => {
  const workspace = createEmptyWorkspace({
    title: '  Shared planning  '
  });

  assert.equal(workspace.title, 'Shared planning');
  assert.equal(validateWorkspaceShape(workspace), true);
});

test('validateWorkspaceShape accepts untitled workspaces', () => {
  const workspace = createEmptyWorkspace();

  assert.equal(Object.hasOwn(workspace, 'title'), false);
  assert.equal(validateWorkspaceShape(workspace), true);
});

test('createEmptyWorkspace normalizes blank workspace titles to an unset field', () => {
  const workspace = createEmptyWorkspace({
    title: '   '
  });

  assert.equal(Object.hasOwn(workspace, 'title'), false);
  assert.equal(validateWorkspaceShape(workspace), true);
});

test('validateWorkspaceShape rejects a blank workspace title when it is present', () => {
  const workspace = createEmptyWorkspace();
  workspace.title = '   ';

  assert.equal(validateWorkspaceShape(workspace), false);
});

test('validateWorkspaceShape rejects legacy cards that only use description', () => {
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

  assert.equal(validateWorkspaceShape(workspace), false);
});

test('validateWorkspaceShape rejects boards with invalid language policy definitions', () => {
  const workspace = createEmptyWorkspace();

  workspace.boards.main.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'fr',
    supportedLocales: ['en'],
    requiredLocales: ['en']
  };

  assert.equal(validateWorkspaceShape(workspace), false);
});

test('validateWorkspaceShape accepts valid board collaboration metadata', () => {
  const workspace = createEmptyWorkspace();

  workspace.boards.main.collaboration = {
    memberships: [
      {
        actor: { type: 'human', id: 'viewer_admin' },
        role: 'admin'
      }
    ],
    invites: [
      {
        id: 'invite_1',
        email: 'editor@example.com',
        role: 'editor',
        status: 'pending'
      }
    ]
  };

  assert.equal(validateWorkspaceShape(workspace), true);
});

test('validateWorkspaceShape rejects invalid board collaboration metadata', () => {
  const workspace = createEmptyWorkspace();

  workspace.boards.main.collaboration.memberships = [
    {
      actor: { type: 'human', id: 'viewer_admin' },
      role: 'owner'
    }
  ];

  assert.equal(validateWorkspaceShape(workspace), false);
});

test('createEmptyWorkspace seeds canonical board collaboration defaults', () => {
  const workspace = createEmptyWorkspace();

  assert.deepEqual(workspace.boards.main.collaboration, {
    memberships: [
      {
        actor: { type: 'system', id: 'workspace-bootstrap' },
        role: 'admin',
        joinedAt: workspace.boards.main.createdAt
      }
    ],
    invites: []
  });
});

test('validateWorkspaceShape rejects duplicate collaboration members or invites', () => {
  const workspaceWithDuplicateMembers = createEmptyWorkspace();
  workspaceWithDuplicateMembers.boards.main.collaboration.memberships = [
    {
      actor: { type: 'human', id: 'viewer_admin' },
      role: 'admin'
    },
    {
      actor: { type: 'human', id: 'viewer_admin' },
      role: 'editor'
    }
  ];

  assert.equal(validateWorkspaceShape(workspaceWithDuplicateMembers), false);

  const workspaceWithDuplicateInvites = createEmptyWorkspace();
  workspaceWithDuplicateInvites.boards.main.collaboration.invites = [
    {
      id: 'invite_1',
      email: 'editor@example.com',
      role: 'editor',
      status: 'pending'
    },
    {
      id: 'invite_1',
      email: 'viewer@example.com',
      role: 'viewer',
      status: 'pending'
    }
  ];

  assert.equal(validateWorkspaceShape(workspaceWithDuplicateInvites), false);
});

test('validateWorkspaceShape accepts cards with empty localeRequests', () => {
  const workspace = createEmptyWorkspace();
  const board = workspace.boards.main;

  board.cards.card_1 = {
    id: 'card_1',
    priority: 'important',
    createdAt: '2026-03-31T09:00:00.000Z',
    updatedAt: '2026-03-31T09:00:00.000Z',
    localeRequests: {},
    contentByLocale: {
      en: {
        title: 'English title',
        detailsMarkdown: '',
        provenance: {
          actor: { type: 'human', id: 'viewer_123' },
          timestamp: '2026-03-31T09:00:00.000Z',
          includesHumanInput: true
        }
      }
    }
  };
  board.stages.backlog.cardIds.push('card_1');

  assert.equal(validateWorkspaceShape(workspace), true);
});

test('validateWorkspaceShape accepts existing cards without workflowReview', () => {
  const workspace = createEmptyWorkspace();
  const board = workspace.boards.main;

  board.cards.card_existing = {
    id: 'card_existing',
    priority: 'important',
    createdAt: '2026-03-31T09:00:00.000Z',
    updatedAt: '2026-03-31T09:00:00.000Z',
    localeRequests: {},
    contentByLocale: {
      en: {
        title: 'Existing card',
        detailsMarkdown: '',
        provenance: {
          actor: { type: 'human', id: 'viewer_123' },
          timestamp: '2026-03-31T09:00:00.000Z',
          includesHumanInput: true
        }
      }
    }
  };
  board.stages.backlog.cardIds.push('card_existing');

  assert.equal(validateWorkspaceShape(workspace), true);
});

test('getActiveBoard returns the active board from the read model', () => {
  const workspace = createEmptyWorkspace();

  assert.equal(getActiveBoard(workspace).id, 'main');
});

test('findColumnIdByCardId returns the containing column id', () => {
  const workspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Trace card location',
    priority: 'normal'
  });
  const board = workspace.boards.main;
  const [cardId] = board.stages.backlog.cardIds;

  assert.equal(findColumnIdByCardId(board, cardId), 'backlog');
  assert.equal(findColumnIdByCardId(board, 'missing_card'), null);
});
