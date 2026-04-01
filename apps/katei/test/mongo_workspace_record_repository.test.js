import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCard,
  createEmptyWorkspace,
  validateWorkspaceShape
} from '../public/js/domain/workspace.js';
import {
  MongoWorkspaceRecordRepository,
  createMongoWorkspaceRecordRepository,
  getWorkspaceRecordCollection
} from '../src/workspaces/mongo_workspace_record_repository.js';
import {
  WORKSPACE_RECORD_COLLECTION_NAME,
  createHomeWorkspaceId,
  createInitialWorkspaceRecord,
  createUpdatedWorkspaceRecord,
  toWorkspaceRecordDocument
} from '../src/workspaces/workspace_record.js';
import {
  WorkspaceAccessDeniedError,
  WorkspaceImportConflictError,
  WorkspaceRevisionConflictError
} from '../src/workspaces/workspace_record_repository.js';

test('loadOrCreateWorkspaceRecord creates an empty record on first access', async () => {
  const collection = createWorkspaceRecordCollectionDouble();
  const repository = new MongoWorkspaceRecordRepository({
    collection,
    now: () => '2026-04-01T10:00:00.000Z'
  });

  const record = await repository.loadOrCreateWorkspaceRecord({ viewerSub: ' sub_123 ' });

  assert.equal(record.viewerSub, 'sub_123');
  assert.equal(record.workspaceId, createHomeWorkspaceId('sub_123'));
  assert.equal(record.isHomeWorkspace, true);
  assert.equal(record.revision, 0);
  assert.equal(record.createdAt, '2026-04-01T10:00:00.000Z');
  assert.equal(record.updatedAt, '2026-04-01T10:00:00.000Z');
  assert.equal(record.lastChangedBy, null);
  assert.deepEqual(record.activityEvents, []);
  assert.equal(validateWorkspaceShape(record.workspace), true);
  assert.equal(record.workspace.workspaceId, createHomeWorkspaceId('sub_123'));
  assert.equal(collection.size(), 1);

  const storedDocument = collection.getDocument(createHomeWorkspaceId('sub_123'));
  assert.equal(storedDocument._id, createHomeWorkspaceId('sub_123'));
  assert.equal(storedDocument.viewerSub, 'sub_123');
  assert.equal(storedDocument.workspaceId, createHomeWorkspaceId('sub_123'));
  assert.equal(storedDocument.isHomeWorkspace, true);
});

test('loadOrCreateWorkspaceRecord normalizes existing legacy-shaped workspace documents', async () => {
  const collection = createWorkspaceRecordCollectionDouble([
    {
      _id: 'sub_123',
      viewerSub: 'sub_123',
      workspace: createLegacyWorkspaceSnapshot({
        version: 5,
        title: 'Legacy persisted task',
        detailsMarkdown: 'Loaded from Mongo',
        priority: 'important'
      }),
      revision: 2,
      createdAt: '2026-04-01T10:00:00.000Z',
      updatedAt: '2026-04-01T11:15:00.000Z',
      lastChangedBy: 'sub_123',
      activityEvents: [],
      commandReceipts: []
    }
  ]);
  const repository = new MongoWorkspaceRecordRepository({ collection });

  const record = await repository.loadOrCreateWorkspaceRecord({ viewerSub: 'sub_123' });

  assert.equal(validateWorkspaceShape(record.workspace), true);
  assert.equal(record.workspaceId, createHomeWorkspaceId('sub_123'));
  assert.equal(record.isHomeWorkspace, true);
  assert.equal(record.documentId, 'sub_123');
  assert.equal(record.workspace.boards.main.columnOrder, undefined);
  assert.equal(record.workspace.boards.main.columns, undefined);
  assert.equal(record.workspace.boards.main.cards.card_legacy_1.title, undefined);
  assert.equal(record.workspace.boards.main.cards.card_legacy_1.contentByLocale.en.title, 'Legacy persisted task');
  assert.deepEqual(record.workspace.ownership, {
    owner: {
      type: 'human',
      id: 'sub_123'
    }
  });
  assert.deepEqual(record.workspace.access, {
    kind: 'private'
  });
  assert.deepEqual(record.workspace.boards.main.collaboration.memberships, [
    {
      actor: {
        type: 'human',
        id: 'sub_123'
      },
      role: 'admin',
      joinedAt: '2026-04-01T09:00:00.000Z'
    }
  ]);
  assert.deepEqual(record.workspace.boards.main.cards.card_legacy_1.localeRequests, {});
});

test('loadOrCreateWorkspaceRecord resolves canonical home workspace ids back to legacy Mongo documents', async () => {
  const collection = createWorkspaceRecordCollectionDouble([
    {
      _id: 'sub_123',
      viewerSub: 'sub_123',
      isHomeWorkspace: true,
      workspace: createLegacyWorkspaceSnapshot({
        workspaceId: 'sub_123'
      }),
      revision: 0,
      createdAt: '2026-04-01T10:00:00.000Z',
      updatedAt: '2026-04-01T10:00:00.000Z',
      lastChangedBy: null,
      activityEvents: [],
      commandReceipts: []
    }
  ]);
  const repository = new MongoWorkspaceRecordRepository({ collection });

  const record = await repository.loadOrCreateWorkspaceRecord({
    viewerSub: 'sub_123',
    workspaceId: createHomeWorkspaceId('sub_123')
  });

  assert.equal(record.workspaceId, createHomeWorkspaceId('sub_123'));
  assert.equal(record.documentId, 'sub_123');
  assert.equal(record.workspace.workspaceId, createHomeWorkspaceId('sub_123'));
});

test('loadOrCreateWorkspaceRecord resolves accessible shared workspaces by workspaceId', async () => {
  const sharedWorkspace = createEmptyWorkspace({ workspaceId: 'workspace_shared_1' });
  sharedWorkspace.boards.main.collaboration.memberships = [
    {
      actor: { type: 'human', id: 'sub_collab' },
      role: 'editor'
    }
  ];
  const sharedRecord = createUpdatedWorkspaceRecord(
    createInitialWorkspaceRecord('sub_owner', {
      workspaceId: 'workspace_shared_1',
      now: '2026-04-01T10:00:00.000Z'
    }),
    {
      workspace: sharedWorkspace,
      actor: { type: 'human', id: 'sub_owner' },
      now: '2026-04-01T11:15:00.000Z'
    }
  );
  sharedRecord.isHomeWorkspace = false;
  const collection = createWorkspaceRecordCollectionDouble([toWorkspaceRecordDocument(sharedRecord)]);
  const repository = new MongoWorkspaceRecordRepository({ collection });

  const record = await repository.loadOrCreateWorkspaceRecord({
    viewerSub: 'sub_collab',
    workspaceId: 'workspace_shared_1'
  });

  assert.equal(record.workspaceId, 'workspace_shared_1');
  assert.equal(record.viewerSub, 'sub_owner');
  assert.equal(record.isHomeWorkspace, false);
  assert.equal(record.workspace.boards.main.collaboration.memberships[0].actor.id, 'sub_collab');
});

test('loadOrCreateWorkspaceRecord rejects inaccessible shared workspaces by workspaceId', async () => {
  const sharedWorkspace = createEmptyWorkspace({ workspaceId: 'workspace_shared_2' });
  const sharedRecord = createInitialWorkspaceRecord('sub_owner', {
    workspaceId: 'workspace_shared_2',
    now: '2026-04-01T10:00:00.000Z'
  });
  sharedRecord.isHomeWorkspace = false;
  sharedRecord.workspace = sharedWorkspace;
  const collection = createWorkspaceRecordCollectionDouble([toWorkspaceRecordDocument(sharedRecord)]);
  const repository = new MongoWorkspaceRecordRepository({ collection });

  await assert.rejects(
    repository.loadOrCreateWorkspaceRecord({
      viewerSub: 'sub_blocked',
      workspaceId: 'workspace_shared_2'
    }),
    WorkspaceAccessDeniedError
  );
});

test('loadOrCreateWorkspaceRecord filters shared workspace reads down to the actor-visible boards', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_filtered');
  const collection = createWorkspaceRecordCollectionDouble([toWorkspaceRecordDocument(sharedRecord)]);
  const repository = new MongoWorkspaceRecordRepository({ collection });

  const record = await repository.loadOrCreateWorkspaceRecord({
    viewerSub: 'sub_member',
    viewerEmail: 'member@example.com',
    workspaceId: 'workspace_shared_filtered'
  });

  assert.equal(record.workspaceId, 'workspace_shared_filtered');
  assert.deepEqual(record.workspace.boardOrder, ['member']);
  assert.deepEqual(Object.keys(record.workspace.boards), ['member']);
  assert.equal(record.workspace.ui.activeBoardId, 'member');
  assert.equal(firstCardTitle(record.workspace.boards.member), 'Member board card');
  const storedDocument = collection.getDocument('workspace_shared_filtered');
  assert.deepEqual(storedDocument.workspace.boardOrder, ['main', 'member', 'invite']);
});

test('loadOrCreateWorkspaceRecord keeps pending-invite boards visible as redacted shells', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_invite_projection');
  const collection = createWorkspaceRecordCollectionDouble([toWorkspaceRecordDocument(sharedRecord)]);
  const repository = new MongoWorkspaceRecordRepository({ collection });

  const record = await repository.loadOrCreateWorkspaceRecord({
    viewerSub: 'sub_invited',
    viewerEmail: 'invitee@example.com',
    workspaceId: 'workspace_shared_invite_projection'
  });

  assert.deepEqual(record.workspace.boardOrder, ['invite']);
  assert.equal(record.workspace.ui.activeBoardId, 'invite');
  assert.deepEqual(record.workspace.boards.invite.cards, {});
  assert.equal(record.workspace.boards.invite.collaboration.invites[0].email, 'invitee@example.com');
  assert.equal(record.workspace.boards.invite.stages.backlog.cardIds.length, 0);
  assert.equal(
    firstCardTitle(collection.getDocument('workspace_shared_invite_projection').workspace.boards.invite),
    'Invite board card'
  );
});

test('loadOrCreateAuthoritativeWorkspaceRecord preserves the full stored shared workspace for mutation paths', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_authoritative');
  const collection = createWorkspaceRecordCollectionDouble([toWorkspaceRecordDocument(sharedRecord)]);
  const repository = new MongoWorkspaceRecordRepository({ collection });

  const record = await repository.loadOrCreateAuthoritativeWorkspaceRecord({
    viewerSub: 'sub_member',
    viewerEmail: 'member@example.com',
    workspaceId: 'workspace_shared_authoritative'
  });

  assert.deepEqual(record.workspace.boardOrder, ['main', 'member', 'invite']);
  assert.equal(record.workspace.ui.activeBoardId, 'main');
  assert.equal(firstCardTitle(record.workspace.boards.main), 'Owner board card');
  assert.equal(firstCardTitle(record.workspace.boards.invite), 'Invite board card');
});

test('listPendingWorkspaceInvitesForViewer finds a pending invite in another workspace', async () => {
  const collection = createWorkspaceRecordCollectionDouble([
    toWorkspaceRecordDocument(createSharedWorkspaceRecordFixture('workspace_other_invite')),
    toWorkspaceRecordDocument(createInviteWorkspaceRecordFixture('workspace_invited_casa'))
  ]);
  const repository = new MongoWorkspaceRecordRepository({ collection });

  const pendingWorkspaceInvites = await repository.listPendingWorkspaceInvitesForViewer({
    viewerSub: 'sub_invited',
    viewerEmail: 'invitee@example.com'
  });

  assert.deepEqual(pendingWorkspaceInvites, [
    {
      workspaceId: 'workspace_other_invite',
      boardId: 'invite',
      boardTitle: 'Invite board',
      inviteId: 'invite_1',
      role: 'viewer',
      invitedAt: '2026-04-01T10:15:00.000Z',
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
      invitedAt: '2026-04-01T10:20:00.000Z',
      invitedBy: {
        id: 'sub_owner_casa',
        email: 'owner-casa@example.com',
        displayName: 'Casa owner'
      }
    }
  ]);
});

test('listPendingWorkspaceInvitesForViewer matches invite emails case-insensitively', async () => {
  const collection = createWorkspaceRecordCollectionDouble([
    toWorkspaceRecordDocument(
      createInviteWorkspaceRecordFixture('workspace_case_email', {
        viewerEmail: 'INVITEE@EXAMPLE.COM'
      })
    )
  ]);
  const repository = new MongoWorkspaceRecordRepository({ collection });

  const pendingWorkspaceInvites = await repository.listPendingWorkspaceInvitesForViewer({
    viewerSub: 'sub_someone_else',
    viewerEmail: 'invitee@example.com'
  });

  assert.equal(pendingWorkspaceInvites.length, 1);
  assert.equal(pendingWorkspaceInvites[0].workspaceId, 'workspace_case_email');
});

test('listPendingWorkspaceInvitesForViewer ignores non-pending invites', async () => {
  const collection = createWorkspaceRecordCollectionDouble([
    toWorkspaceRecordDocument(
      createInviteWorkspaceRecordFixture('workspace_not_pending', {
        inviteStatus: 'accepted'
      })
    )
  ]);
  const repository = new MongoWorkspaceRecordRepository({ collection });

  const pendingWorkspaceInvites = await repository.listPendingWorkspaceInvitesForViewer({
    viewerSub: 'sub_invited',
    viewerEmail: 'invitee@example.com'
  });

  assert.deepEqual(pendingWorkspaceInvites, []);
});

test('listPendingWorkspaceInvitesForViewer ignores malformed or non-matching invites', async () => {
  const malformedRecord = createInviteWorkspaceRecordFixture('workspace_malformed_invites');

  malformedRecord.workspace.boards.casa.collaboration.invites.push(
    { id: 'invite_missing_role', email: 'invitee@example.com', status: 'pending' },
    { id: 'invite_other_viewer', email: 'other@example.com', role: 'viewer', status: 'pending', invitedBy: { type: 'human', id: 'sub_owner' }, invitedAt: '2026-04-01T10:21:00.000Z' },
    { id: 'invite_actor_other', actor: { type: 'human', id: 'sub_other' }, role: 'viewer', status: 'pending', invitedBy: { type: 'human', id: 'sub_owner' }, invitedAt: '2026-04-01T10:22:00.000Z' },
    { id: 'invite_duplicate', actor: { type: 'human', id: 'sub_invited' }, email: 'invitee@example.com', role: 'viewer', status: 'pending', invitedBy: { type: 'human', id: 'sub_owner' }, invitedAt: '2026-04-01T10:23:00.000Z' }
  );
  malformedRecord.workspace.boards.casa.collaboration.invites.push(
    structuredClone(malformedRecord.workspace.boards.casa.collaboration.invites.at(-1))
  );
  const collection = createWorkspaceRecordCollectionDouble([toWorkspaceRecordDocument(malformedRecord)]);
  const repository = new MongoWorkspaceRecordRepository({ collection });

  const pendingWorkspaceInvites = await repository.listPendingWorkspaceInvitesForViewer({
    viewerSub: 'sub_invited',
    viewerEmail: 'invitee@example.com'
  });

  assert.deepEqual(
    pendingWorkspaceInvites.map((invite) => invite.inviteId),
    ['invite_casa_1', 'invite_duplicate']
  );
});

test('replaceWorkspaceSnapshot stores a validated full-workspace snapshot with metadata', async () => {
  const collection = createWorkspaceRecordCollectionDouble();
  const nowValues = ['2026-04-01T10:00:00.000Z', '2026-04-01T11:15:00.000Z'];
  const eventIds = ['activity_saved_1'];
  const repository = createMongoWorkspaceRecordRepository({
    collection,
    now: () => nowValues.shift() ?? '2026-04-01T11:15:00.000Z',
    createActivityEventId: () => eventIds.shift() ?? 'activity_saved_fallback'
  });
  const workspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Ship launch checklist',
    detailsMarkdown: 'Owner: Mina',
    priority: 'urgent'
  });

  const record = await repository.replaceWorkspaceSnapshot({
    viewerSub: 'sub_123',
    workspace,
    expectedRevision: 0,
    actor: { type: 'human', id: 'sub_123' }
  });

  assert.equal(record.viewerSub, 'sub_123');
  assert.equal(record.workspaceId, createHomeWorkspaceId('sub_123'));
  assert.equal(record.isHomeWorkspace, true);
  assert.equal(record.revision, 1);
  assert.equal(record.createdAt, '2026-04-01T10:00:00.000Z');
  assert.equal(record.updatedAt, '2026-04-01T11:15:00.000Z');
  assert.equal(record.lastChangedBy, 'sub_123');
  assert.deepEqual(record.activityEvents, [
    {
      id: 'activity_saved_1',
      type: 'workspace.saved',
      actor: {
        type: 'human',
        id: 'sub_123'
      },
      createdAt: '2026-04-01T11:15:00.000Z',
      revision: 1,
      entity: null,
      details: null
    }
  ]);
  assert.equal(
    record.workspace.boards.main.cards[Object.keys(record.workspace.boards.main.cards)[0]].contentByLocale.en.title,
    'Ship launch checklist'
  );
  assert.equal(record.workspace.workspaceId, createHomeWorkspaceId('sub_123'));

  const storedDocument = collection.getDocument(createHomeWorkspaceId('sub_123'));
  assert.equal(storedDocument.revision, 1);
  assert.equal(storedDocument.lastChangedBy, 'sub_123');
  assert.equal(storedDocument.activityEvents[0].type, 'workspace.saved');
  assert.equal(validateWorkspaceShape(storedDocument.workspace), true);
});

test('replaceWorkspaceSnapshot migrates legacy home Mongo documents to the canonical shared-workspace id on save', async () => {
  const legacyDocument = {
    _id: 'sub_123',
    viewerSub: 'sub_123',
    isHomeWorkspace: true,
    workspace: createLegacyWorkspaceSnapshot({
      workspaceId: 'sub_123'
    }),
    revision: 0,
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T10:00:00.000Z',
    lastChangedBy: null,
    activityEvents: [],
    commandReceipts: []
  };
  const collection = createWorkspaceRecordCollectionDouble([legacyDocument]);
  const repository = new MongoWorkspaceRecordRepository({
    collection,
    now: () => '2026-04-01T11:15:00.000Z',
    createActivityEventId: () => 'activity_saved_legacy'
  });
  const workspace = createCard(
    createEmptyWorkspace({
      workspaceId: createHomeWorkspaceId('sub_123'),
      creator: {
        type: 'human',
        id: 'sub_123'
      }
    }),
    'main',
    {
      title: 'Migrated save',
      detailsMarkdown: 'Canonical save path',
      priority: 'important'
    }
  );

  const record = await repository.replaceWorkspaceSnapshot({
    viewerSub: 'sub_123',
    workspaceId: createHomeWorkspaceId('sub_123'),
    workspace,
    expectedRevision: 0,
    actor: { type: 'human', id: 'sub_123' }
  });

  assert.equal(record.workspaceId, createHomeWorkspaceId('sub_123'));
  assert.equal(record.documentId, createHomeWorkspaceId('sub_123'));
  assert.equal(collection.getDocument('sub_123'), null);
  const storedDocument = collection.getDocument(createHomeWorkspaceId('sub_123'));
  assert.equal(storedDocument._id, createHomeWorkspaceId('sub_123'));
  assert.deepEqual(storedDocument.workspace.ownership, {
    owner: {
      type: 'human',
      id: 'sub_123'
    }
  });
  assert.deepEqual(storedDocument.workspace.access, {
    kind: 'private'
  });
  assert.equal(storedDocument.workspace.boards.main.collaboration.memberships.length, 1);
  assert.equal(storedDocument.workspace.boards.main.collaboration.memberships[0].actor.id, 'sub_123');
  assert.equal(storedDocument.workspace.boards.main.collaboration.memberships[0].role, 'admin');
  assert.deepEqual(storedDocument.workspace.boards.main.cards[Object.keys(storedDocument.workspace.boards.main.cards)[0]].localeRequests, {});
});

test('replaceWorkspaceSnapshot rejects stale expectedRevision values', async () => {
  const existingWorkspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Server task',
    detailsMarkdown: 'Already saved on the server',
    priority: 'urgent'
  });
  const existingRecord = createUpdatedWorkspaceRecord(
    createInitialWorkspaceRecord('sub_123', {
      now: '2026-04-01T10:00:00.000Z'
    }),
    {
      workspace: existingWorkspace,
      actor: { type: 'human', id: 'sub_123' },
      now: '2026-04-01T11:15:00.000Z',
      createActivityEventId: () => 'activity_saved_existing'
    }
  );
  const collection = createWorkspaceRecordCollectionDouble([toWorkspaceRecordDocument(existingRecord)]);
  const repository = new MongoWorkspaceRecordRepository({ collection });

  await assert.rejects(
    repository.replaceWorkspaceSnapshot({
      viewerSub: 'sub_123',
      workspace: createEmptyWorkspace(),
      expectedRevision: 0,
      actor: { type: 'human', id: 'sub_123' }
    }),
    WorkspaceRevisionConflictError
  );
});

test('replaceWorkspaceSnapshot rejects invalid workspaces before saving', async () => {
  const collection = createWorkspaceRecordCollectionDouble();
  const repository = new MongoWorkspaceRecordRepository({ collection });
  const invalidWorkspace = { version: -1 };

  await assert.rejects(
    repository.replaceWorkspaceSnapshot({
      viewerSub: 'sub_123',
      workspace: invalidWorkspace,
      expectedRevision: 0,
      actor: 'sub_123'
    }),
    {
      message: 'Cannot save an invalid workspace.'
    }
  );

  assert.equal(collection.size(), 0);
  assert.equal(collection.getDocument(createHomeWorkspaceId('sub_123')), null);
});

test('importWorkspaceSnapshot stores a validated full-workspace snapshot only when the server record is pristine', async () => {
  const collection = createWorkspaceRecordCollectionDouble();
  const nowValues = ['2026-04-01T10:00:00.000Z', '2026-04-01T11:15:00.000Z'];
  const eventIds = ['activity_imported_1'];
  const repository = createMongoWorkspaceRecordRepository({
    collection,
    now: () => nowValues.shift() ?? '2026-04-01T11:15:00.000Z',
    createActivityEventId: () => eventIds.shift() ?? 'activity_imported_fallback'
  });
  const workspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Imported board',
    detailsMarkdown: 'Migrated from local v4 storage',
    priority: 'important'
  });

  const record = await repository.importWorkspaceSnapshot({
    viewerSub: 'sub_123',
    workspace,
    actor: { type: 'human', id: 'sub_123' }
  });

  assert.equal(record.workspaceId, createHomeWorkspaceId('sub_123'));
  assert.equal(record.isHomeWorkspace, true);
  assert.equal(record.revision, 1);
  assert.equal(record.updatedAt, '2026-04-01T11:15:00.000Z');
  assert.equal(record.lastChangedBy, 'sub_123');
  assert.deepEqual(record.activityEvents, [
    {
      id: 'activity_imported_1',
      type: 'workspace.imported',
      actor: {
        type: 'human',
        id: 'sub_123'
      },
      createdAt: '2026-04-01T11:15:00.000Z',
      revision: 1,
      entity: null,
      details: null
    }
  ]);
  assert.equal(validateWorkspaceShape(record.workspace), true);
});

test('importWorkspaceSnapshot rejects imports once the server record is no longer pristine', async () => {
  const workspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Existing server card',
    detailsMarkdown: 'Already saved on the server',
    priority: 'urgent'
  });
  const initialRecord = createUpdatedWorkspaceRecord(
    createInitialWorkspaceRecord('sub_123', {
      now: '2026-04-01T10:00:00.000Z'
    }),
    {
      workspace,
      actor: { type: 'human', id: 'sub_123' },
      now: '2026-04-01T11:15:00.000Z',
      createActivityEventId: () => 'activity_saved_existing'
    }
  );
  const collection = createWorkspaceRecordCollectionDouble([toWorkspaceRecordDocument(initialRecord)]);
  const repository = new MongoWorkspaceRecordRepository({ collection });

  await assert.rejects(
    repository.importWorkspaceSnapshot({
      viewerSub: 'sub_123',
      workspace: createEmptyWorkspace(),
      actor: { id: 'sub_123' }
    }),
    WorkspaceImportConflictError
  );

  assert.equal(collection.getDocument(createHomeWorkspaceId('sub_123')).revision, 1);
});

test('repeated load/save cycles do not double-seed owner memberships for migrated legacy home documents', async () => {
  const collection = createWorkspaceRecordCollectionDouble([
    {
      _id: 'sub_123',
      viewerSub: 'sub_123',
      isHomeWorkspace: true,
      workspace: createLegacyWorkspaceSnapshot({
        workspaceId: 'sub_123'
      }),
      revision: 0,
      createdAt: '2026-04-01T10:00:00.000Z',
      updatedAt: '2026-04-01T10:00:00.000Z',
      lastChangedBy: null,
      activityEvents: [],
      commandReceipts: []
    }
  ]);
  const repository = createMongoWorkspaceRecordRepository({
    collection,
    now: () => '2026-04-01T11:15:00.000Z',
    createActivityEventId: () => 'activity_saved_repeat'
  });

  const firstLoad = await repository.loadOrCreateWorkspaceRecord({ viewerSub: 'sub_123' });
  const firstSave = await repository.replaceWorkspaceSnapshot({
    viewerSub: 'sub_123',
    workspaceId: createHomeWorkspaceId('sub_123'),
    workspace: firstLoad.workspace,
    expectedRevision: 0,
    actor: { type: 'human', id: 'sub_123' }
  });
  const secondLoad = await repository.loadOrCreateWorkspaceRecord({
    viewerSub: 'sub_123',
    workspaceId: createHomeWorkspaceId('sub_123')
  });

  assert.equal(firstSave.workspace.boards.main.collaboration.memberships.length, 1);
  assert.deepEqual(secondLoad.workspace.boards.main.collaboration.memberships, [
    {
      actor: {
        type: 'human',
        id: 'sub_123'
      },
      role: 'admin',
      joinedAt: '2026-04-01T09:00:00.000Z'
    }
  ]);
});

test('getWorkspaceRecordCollection can resolve the dedicated collection from an injected db handle', () => {
  const collection = {};
  const db = {
    collection(name) {
      assert.equal(name, WORKSPACE_RECORD_COLLECTION_NAME);
      return collection;
    }
  };

  assert.equal(getWorkspaceRecordCollection({ db }), collection);
});

function createWorkspaceRecordCollectionDouble(initialDocuments = []) {
  const documents = new Map(
    initialDocuments.map((document) => [document._id, structuredClone(document)])
  );

  return {
    find() {
      return {
        async toArray() {
          return [...documents.values()].map((document) => structuredClone(document));
        }
      };
    },

    async updateOne(filter, update, options = {}) {
      const documentId = filter._id;

      if (!documents.has(documentId) && options.upsert && update.$setOnInsert) {
        documents.set(documentId, structuredClone(update.$setOnInsert));
      }

      return { acknowledged: true };
    },

    async findOne(filter) {
      for (const document of documents.values()) {
        if (matchesDocumentFilter(document, filter)) {
          return structuredClone(document);
        }
      }

      return null;
    },

    async replaceOne(filter, replacement, options = {}) {
      const documentId = filter._id;
      const currentDocument = documents.get(documentId) ?? null;
      const revisionMatches =
        !Object.hasOwn(filter, 'revision') || currentDocument?.revision === filter.revision;

      if ((currentDocument && revisionMatches) || (options.upsert && !currentDocument)) {
        documents.set(documentId, structuredClone(replacement));
      }

      return {
        acknowledged: true,
        matchedCount: currentDocument && revisionMatches ? 1 : 0,
        modifiedCount: currentDocument && revisionMatches ? 1 : 0,
        upsertedCount: !currentDocument && options.upsert ? 1 : 0
      };
    },

    async deleteOne(filter) {
      const didDelete = documents.delete(filter._id);

      return {
        acknowledged: true,
        deletedCount: didDelete ? 1 : 0
      };
    },

    getDocument(documentId) {
      const document = documents.get(documentId);
      return document ? structuredClone(document) : null;
    },

    size() {
      return documents.size;
    }
  };
}

function matchesDocumentFilter(document, filter = {}) {
  return Object.entries(filter).every(([key, value]) => document?.[key] === value);
}

function createLegacyWorkspaceSnapshot({
  version = 4,
  workspaceId = 'main',
  title = 'Legacy task',
  detailsMarkdown = '',
  priority = 'important'
} = {}) {
  const workspace = createEmptyWorkspace();
  const board = workspace.boards.main;
  const boardCreatedAt = '2026-04-01T09:00:00.000Z';
  const boardUpdatedAt = '2026-04-01T09:00:00.000Z';

  return {
    version,
    workspaceId,
    ui: structuredClone(workspace.ui),
    boardOrder: [...workspace.boardOrder],
    boards: {
      [board.id]: {
        id: board.id,
        title: board.title,
        createdAt: boardCreatedAt,
        updatedAt: boardUpdatedAt,
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
            createdAt: '2026-04-01T09:00:00.000Z',
            updatedAt: '2026-04-01T09:30:00.000Z'
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

function createSharedWorkspaceRecordFixture(workspaceId) {
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
        role: 'editor',
        joinedAt: '2026-04-01T10:05:00.000Z'
      }
    ],
    card: {
      title: 'Member board card',
      detailsMarkdown: 'Visible to the collaborator.',
      priority: 'urgent'
    }
  });
  workspace = addSharedBoard(workspace, 'invite', 'Invite board', {
    invites: [
      {
        id: 'invite_1',
        email: 'invitee@example.com',
        role: 'viewer',
        status: 'pending',
        invitedBy: { type: 'human', id: 'sub_owner', email: 'owner@example.com' },
        invitedAt: '2026-04-01T10:15:00.000Z'
      }
    ],
    card: {
      title: 'Invite board card',
      detailsMarkdown: 'Should be redacted until the invite is accepted.',
      priority: 'normal'
    }
  });

  workspace.boardOrder = ['main', 'member', 'invite'];
  workspace.ui.activeBoardId = 'main';

  const record = createUpdatedWorkspaceRecord(
    createInitialWorkspaceRecord('sub_owner', {
      workspaceId,
      now: '2026-04-01T10:00:00.000Z'
    }),
    {
      workspace,
      actor: { type: 'human', id: 'sub_owner' },
      now: '2026-04-01T11:15:00.000Z'
    }
  );
  record.isHomeWorkspace = false;
  return record;
}

function createInviteWorkspaceRecordFixture(
  workspaceId,
  {
    viewerSub = 'sub_invited',
    viewerEmail = 'invitee@example.com',
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

  workspace.boards.main.title = 'Owner home';
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
        actor: {
          type: 'human',
          id: viewerSub
        },
        email: viewerEmail,
        role: 'editor',
        status: inviteStatus,
        invitedBy: ownerActor,
        invitedAt: '2026-04-01T10:20:00.000Z'
      }
    ]
  });
  workspace.boardOrder = ['main', 'casa'];
  workspace.ui.activeBoardId = 'main';

  const record = createUpdatedWorkspaceRecord(
    createInitialWorkspaceRecord('sub_owner_casa', {
      workspaceId,
      now: '2026-04-01T10:00:00.000Z'
    }),
    {
      workspace,
      actor: { type: 'human', id: 'sub_owner_casa' },
      now: '2026-04-01T10:30:00.000Z'
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
