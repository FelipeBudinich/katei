import { getMongoDb } from '../data/mongo_client.js';
import {
  WorkspaceAccessDeniedError,
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
  normalizeWorkspaceId,
  normalizeViewerSub,
  toWorkspaceRecordDocument,
  validateWorkspaceSnapshot
} from './workspace_record.js';
import { canViewerAccessWorkspace } from './workspace_access.js';

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

  async loadOrCreateWorkspaceRecord({ viewerSub, workspaceId = null, viewerEmail = null } = {}) {
    const collection = this.#getCollection();
    const normalizedViewerSub = normalizeViewerSub(viewerSub);
    const normalizedWorkspaceId = normalizeOptionalWorkspaceId(workspaceId);

    if (normalizedWorkspaceId) {
      return this.#loadAccessibleWorkspaceRecord({
        viewerSub: normalizedViewerSub,
        viewerEmail,
        workspaceId: normalizedWorkspaceId
      });
    }

    const existingRecord = await this.#loadHomeWorkspaceRecord(normalizedViewerSub);

    if (existingRecord) {
      return existingRecord;
    }

    const initialRecord = createInitialWorkspaceRecord(normalizedViewerSub, { now: this.now() });

    await collection.updateOne(
      { _id: initialRecord.workspaceId },
      { $setOnInsert: toWorkspaceRecordDocument(initialRecord) },
      { upsert: true }
    );

    return this.#loadRequiredWorkspaceRecord(initialRecord.workspaceId);
  }

  async replaceWorkspaceSnapshot({ viewerSub, workspaceId = null, viewerEmail = null, workspace, actor, expectedRevision } = {}) {
    const collection = this.#getCollection();
    validateWorkspaceSnapshot(workspace);

    const currentRecord = await this.loadOrCreateWorkspaceRecord({
      viewerSub,
      workspaceId,
      viewerEmail
    });

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
      { _id: nextRecord.workspaceId, revision: expectedRevision },
      toWorkspaceRecordDocument(nextRecord),
      { upsert: false }
    );
    const matchedCount = typeof result?.matchedCount === 'number' ? result.matchedCount : 1;

    if (matchedCount === 0) {
      throw new WorkspaceRevisionConflictError();
    }

    return nextRecord;
  }

  async importWorkspaceSnapshot({ viewerSub, workspaceId = null, viewerEmail = null, workspace, actor } = {}) {
    const collection = this.#getCollection();
    validateWorkspaceSnapshot(workspace);

    const currentRecord = await this.loadOrCreateWorkspaceRecord({
      viewerSub,
      workspaceId,
      viewerEmail
    });

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
      { _id: nextRecord.workspaceId, revision: currentRecord.revision },
      toWorkspaceRecordDocument(nextRecord),
      { upsert: false }
    );
    const matchedCount = typeof result?.matchedCount === 'number' ? result.matchedCount : 1;

    if (matchedCount === 0) {
      throw new WorkspaceImportConflictError();
    }

    return nextRecord;
  }

  async replaceWorkspaceRecord({ record, expectedRevision } = {}) {
    const collection = this.#getCollection();
    const normalizedRecord = toWorkspaceRecordDocument(record);
    const result = await collection.replaceOne(
      { _id: normalizedRecord._id, revision: expectedRevision },
      normalizedRecord,
      { upsert: false }
    );
    const matchedCount = typeof result?.matchedCount === 'number' ? result.matchedCount : 1;

    if (matchedCount === 0) {
      throw new WorkspaceRevisionConflictError();
    }

    return fromWorkspaceRecordDocument(normalizedRecord);
  }

  async #loadRequiredWorkspaceRecord(workspaceId) {
    const document = await this.#getCollection().findOne({ _id: normalizeWorkspaceId(workspaceId) });
    const record = fromWorkspaceRecordDocument(document);

    if (!record) {
      throw new Error(`Workspace record was not found for workspace ${workspaceId}.`);
    }

    return record;
  }

  async #loadHomeWorkspaceRecord(viewerSub) {
    const collection = this.#getCollection();
    const homeDocument =
      (await collection.findOne({ viewerSub, isHomeWorkspace: true })) ??
      (await collection.findOne({ _id: viewerSub }));

    return fromWorkspaceRecordDocument(homeDocument);
  }

  async #loadAccessibleWorkspaceRecord({ viewerSub, viewerEmail, workspaceId }) {
    let record;

    try {
      record = await this.#loadRequiredWorkspaceRecord(workspaceId);
    } catch (error) {
      if (error?.message === `Workspace record was not found for workspace ${workspaceId}.`) {
        throw new WorkspaceAccessDeniedError();
      }

      throw error;
    }

    if (
      !canViewerAccessWorkspace({
        viewerSub,
        viewerEmail,
        ownerSub: record.viewerSub,
        workspace: record.workspace
      })
    ) {
      throw new WorkspaceAccessDeniedError();
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

function normalizeOptionalWorkspaceId(workspaceId) {
  return typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId.trim() : null;
}
