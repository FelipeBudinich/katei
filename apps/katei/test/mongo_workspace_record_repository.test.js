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
import { WORKSPACE_RECORD_COLLECTION_NAME } from '../src/workspaces/workspace_record.js';

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
  const repository = createMongoWorkspaceRecordRepository({
    collection,
    now: () => nowValues.shift() ?? '2026-04-01T11:15:00.000Z'
  });
  const workspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Ship launch checklist',
    detailsMarkdown: 'Owner: Mina',
    priority: 'urgent'
  });

  const record = await repository.replaceWorkspaceSnapshot({
    viewerSub: 'sub_123',
    workspace,
    actor: { sub: 'sub_123', name: 'Tester' }
  });

  assert.equal(record.viewerSub, 'sub_123');
  assert.equal(record.revision, 1);
  assert.equal(record.createdAt, '2026-04-01T10:00:00.000Z');
  assert.equal(record.updatedAt, '2026-04-01T11:15:00.000Z');
  assert.equal(record.lastChangedBy, 'sub_123');
  assert.equal(record.workspace.boards.main.cards[Object.keys(record.workspace.boards.main.cards)[0]].title, 'Ship launch checklist');

  const storedDocument = collection.getDocument('sub_123');
  assert.equal(storedDocument.revision, 1);
  assert.equal(storedDocument.lastChangedBy, 'sub_123');
  assert.equal(validateWorkspaceShape(storedDocument.workspace), true);
});

test('replaceWorkspaceSnapshot rejects invalid workspaces before saving', async () => {
  const collection = createWorkspaceRecordCollectionDouble();
  const repository = new MongoWorkspaceRecordRepository({ collection });
  const invalidWorkspace = {
    ...createEmptyWorkspace(),
    version: -1
  };

  await assert.rejects(
    repository.replaceWorkspaceSnapshot({
      viewerSub: 'sub_123',
      workspace: invalidWorkspace,
      actor: 'sub_123'
    }),
    {
      message: 'Cannot save an invalid workspace.'
    }
  );

  assert.equal(collection.size(), 0);
  assert.equal(collection.getDocument('sub_123'), null);
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

      if (options.upsert || documents.has(documentId)) {
        documents.set(documentId, structuredClone(replacement));
      }

      return { acknowledged: true };
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
