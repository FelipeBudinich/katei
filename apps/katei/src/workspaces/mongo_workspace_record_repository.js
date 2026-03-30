import { getMongoDb } from '../data/mongo_client.js';
import {
  WorkspaceImportConflictError,
  WorkspaceRecordRepository,
  WorkspaceRevisionConflictError
} from './workspace_record_repository.js';
import {
  WORKSPACE_RECORD_COLLECTION_NAME,
  createWorkspaceActivityEventId,
  createInitialWorkspaceRecord,
  createUpdatedWorkspaceRecord,
  fromWorkspaceRecordDocument,
  normalizeViewerSub,
  toWorkspaceRecordDocument,
  validateWorkspaceSnapshot
} from './workspace_record.js';

export function createMongoWorkspaceRecordRepository(options = {}) {
  return new MongoWorkspaceRecordRepository(options);
}

export function getWorkspaceRecordCollection({ collection, db, config, getDb = getMongoDb } = {}) {
  if (collection) {
    return collection;
  }

  const resolvedDb = db ?? (config ? getDb(config) : null);

  if (!resolvedDb || typeof resolvedDb.collection !== 'function') {
    throw new Error('A MongoDB collection or db handle is required for workspace persistence.');
  }

  return resolvedDb.collection(WORKSPACE_RECORD_COLLECTION_NAME);
}

export class MongoWorkspaceRecordRepository extends WorkspaceRecordRepository {
  constructor({
    collection,
    db,
    config,
    getDb = getMongoDb,
    now = createNowIsoString,
    createActivityEventId = createWorkspaceActivityEventId
  } = {}) {
    super();
    this.collection = collection ?? null;
    this.db = db ?? null;
    this.config = config;
    this.getDb = getDb;
    this.now = now;
    this.createActivityEventId = createActivityEventId;
  }

  async loadOrCreateWorkspaceRecord(viewerSub) {
    const collection = this.#getCollection();
    const normalizedViewerSub = normalizeViewerSub(viewerSub);
    const existingDocument = await collection.findOne({ _id: normalizedViewerSub });
    const existingRecord = fromWorkspaceRecordDocument(existingDocument);

    if (existingRecord) {
      return existingRecord;
    }

    const initialRecord = createInitialWorkspaceRecord(normalizedViewerSub, { now: this.now() });

    await collection.updateOne(
      { _id: normalizedViewerSub },
      { $setOnInsert: toWorkspaceRecordDocument(initialRecord) },
      { upsert: true }
    );

    return this.#loadRequiredWorkspaceRecord(normalizedViewerSub);
  }

  async replaceWorkspaceSnapshot({ viewerSub, workspace, actor, expectedRevision } = {}) {
    const collection = this.#getCollection();
    validateWorkspaceSnapshot(workspace);

    const currentRecord = await this.loadOrCreateWorkspaceRecord(viewerSub);

    if (currentRecord.revision !== expectedRevision) {
      throw new WorkspaceRevisionConflictError();
    }

    const nextRecord = createUpdatedWorkspaceRecord(currentRecord, {
      workspace,
      actor,
      now: this.now(),
      activityType: 'workspace.saved',
      createActivityEventId: this.createActivityEventId
    });
    const result = await collection.replaceOne(
      { _id: nextRecord.viewerSub, revision: expectedRevision },
      toWorkspaceRecordDocument(nextRecord),
      { upsert: false }
    );
    const matchedCount = typeof result?.matchedCount === 'number' ? result.matchedCount : 1;

    if (matchedCount === 0) {
      throw new WorkspaceRevisionConflictError();
    }

    return nextRecord;
  }

  async importWorkspaceSnapshot({ viewerSub, workspace, actor } = {}) {
    const collection = this.#getCollection();
    validateWorkspaceSnapshot(workspace);

    const currentRecord = await this.loadOrCreateWorkspaceRecord(viewerSub);

    if (currentRecord.revision !== 0) {
      throw new WorkspaceImportConflictError();
    }

    const nextRecord = createUpdatedWorkspaceRecord(currentRecord, {
      workspace,
      actor,
      now: this.now(),
      activityType: 'workspace.imported',
      createActivityEventId: this.createActivityEventId
    });
    const result = await collection.replaceOne(
      { _id: nextRecord.viewerSub, revision: currentRecord.revision },
      toWorkspaceRecordDocument(nextRecord),
      { upsert: false }
    );
    const matchedCount = typeof result?.matchedCount === 'number' ? result.matchedCount : 1;

    if (matchedCount === 0) {
      throw new WorkspaceImportConflictError();
    }

    return nextRecord;
  }

  async #loadRequiredWorkspaceRecord(viewerSub) {
    const document = await this.#getCollection().findOne({ _id: viewerSub });
    const record = fromWorkspaceRecordDocument(document);

    if (!record) {
      throw new Error(`Workspace record was not found for viewer ${viewerSub}.`);
    }

    return record;
  }

  #getCollection() {
    if (!this.collection) {
      this.collection = getWorkspaceRecordCollection({
        db: this.db,
        config: this.config,
        getDb: this.getDb
      });
    }

    return this.collection;
  }
}

function createNowIsoString() {
  return new Date().toISOString();
}
