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
  createInitialWorkspaceRecord,
  createUpdatedWorkspaceRecord,
  toWorkspaceRecordDocument
} from '../src/workspaces/workspace_record.js';
import {
  WorkspaceImportConflictError,
  WorkspaceRevisionConflictError
} from '../src/workspaces/workspace_record_repository.js';

test('loadOrCreateWorkspaceRecord creates an empty record on first access', async () => {
  const collection = createWorkspaceRecordCollectionDouble();
  const repository = new MongoWorkspaceRecordRepository({
    collection,
    now: () => '2026-04-01T10:00:00.000Z'
  });

  const record = await repository.loadOrCreateWorkspaceRecord(' sub_123 ');

  assert.equal(record.viewerSub, 'sub_123');
  assert.equal(record.revision, 0);
  assert.equal(record.createdAt, '2026-04-01T10:00:00.000Z');
  assert.equal(record.updatedAt, '2026-04-01T10:00:00.000Z');
  assert.equal(record.lastChangedBy, null);
  assert.deepEqual(record.activityEvents, []);
  assert.equal(validateWorkspaceShape(record.workspace), true);
  assert.equal(collection.size(), 1);

  const storedDocument = collection.getDocument('sub_123');
  assert.equal(storedDocument._id, 'sub_123');
  assert.equal(storedDocument.viewerSub, 'sub_123');
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

  const storedDocument = collection.getDocument('sub_123');
  assert.equal(storedDocument.revision, 1);
  assert.equal(storedDocument.lastChangedBy, 'sub_123');
  assert.equal(storedDocument.activityEvents[0].type, 'workspace.saved');
  assert.equal(validateWorkspaceShape(storedDocument.workspace), true);
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
  const invalidWorkspace = {
    ...createEmptyWorkspace(),
    workspaceId: 'broken'
  };

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
  assert.equal(collection.getDocument('sub_123'), null);
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

  assert.equal(collection.getDocument('sub_123').revision, 1);
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
    async updateOne(filter, update, options = {}) {
      const documentId = filter._id;

      if (!documents.has(documentId) && options.upsert && update.$setOnInsert) {
        documents.set(documentId, structuredClone(update.$setOnInsert));
      }

      return { acknowledged: true };
    },

    async findOne(filter) {
      const document = documents.get(filter._id);
      return document ? structuredClone(document) : null;
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
        modifiedCount: (currentDocument && revisionMatches) || (options.upsert && !currentDocument) ? 1 : 0
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
