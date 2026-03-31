import { getMongoDb } from '../data/mongo_client.js';
import {
  WorkspaceAccessDeniedError,
  WorkspaceImportConflictError,
  WorkspaceRecordRepository,
  WorkspaceRevisionConflictError
} from './workspace_record_repository.js';
import {
  WORKSPACE_RECORD_COLLECTION_NAME,
  createHomeWorkspaceId,
  createWorkspaceActivityEventId,
  createInitialWorkspaceRecord,
  createUpdatedWorkspaceRecord,
  fromWorkspaceRecordDocument,
  normalizeWorkspaceId,
  normalizeViewerSub,
  parseHomeWorkspaceViewerSub,
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

    return this.#persistWorkspaceRecord({
      currentDocumentId: currentRecord.documentId ?? currentRecord.workspaceId,
      nextRecord,
      expectedRevision,
      conflictErrorClass: WorkspaceRevisionConflictError
    });
  }

  async importWorkspaceSnapshot({ viewerSub, workspaceId = null, viewerEmail = null, workspace, actor } = {}) {
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

    return this.#persistWorkspaceRecord({
      currentDocumentId: currentRecord.documentId ?? currentRecord.workspaceId,
      nextRecord,
      expectedRevision: currentRecord.revision,
      conflictErrorClass: WorkspaceImportConflictError
    });
  }

  async replaceWorkspaceRecord({ record, expectedRevision } = {}) {
    const normalizedRecord = fromWorkspaceRecordDocument(toWorkspaceRecordDocument(record));

    return this.#persistWorkspaceRecord({
      currentDocumentId: record?.documentId ?? normalizedRecord.documentId ?? normalizedRecord.workspaceId,
      nextRecord: normalizedRecord,
      expectedRevision,
      conflictErrorClass: WorkspaceRevisionConflictError
    });
  }

  async #loadRequiredWorkspaceRecord(workspaceId) {
    const collection = this.#getCollection();
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    let document = await collection.findOne({ _id: normalizedWorkspaceId });

    if (!document) {
      const legacyHomeWorkspaceId = parseHomeWorkspaceViewerSub(normalizedWorkspaceId);

      if (legacyHomeWorkspaceId) {
        document = await collection.findOne({ _id: legacyHomeWorkspaceId });
      }
    }

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
      (await collection.findOne({ _id: createHomeWorkspaceId(viewerSub) })) ??
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

  async #persistWorkspaceRecord({ currentDocumentId, nextRecord, expectedRevision, conflictErrorClass }) {
    const collection = this.#getCollection();
    const nextDocument = toWorkspaceRecordDocument(nextRecord);
    const normalizedCurrentDocumentId = normalizeWorkspaceId(currentDocumentId ?? nextRecord.workspaceId);

    if (normalizedCurrentDocumentId === nextDocument._id) {
      const result = await collection.replaceOne(
        { _id: nextDocument._id, revision: expectedRevision },
        nextDocument,
        { upsert: false }
      );
      const matchedCount = typeof result?.matchedCount === 'number' ? result.matchedCount : 1;

      if (matchedCount === 0) {
        throw new conflictErrorClass();
      }

      return fromWorkspaceRecordDocument(nextDocument);
    }

    const legacyDocument = await collection.findOne({
      _id: normalizedCurrentDocumentId,
      revision: expectedRevision
    });

    if (!legacyDocument) {
      throw new conflictErrorClass();
    }

    const result = await collection.replaceOne(
      { _id: nextDocument._id, revision: expectedRevision },
      nextDocument,
      { upsert: true }
    );

    if (!didPersistWorkspaceDocument(result)) {
      throw new conflictErrorClass();
    }

    await collection.deleteOne({ _id: normalizedCurrentDocumentId });

    return fromWorkspaceRecordDocument(nextDocument);
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

function didPersistWorkspaceDocument(result) {
  return Boolean(
    (typeof result?.matchedCount === 'number' && result.matchedCount > 0)
    || (typeof result?.modifiedCount === 'number' && result.modifiedCount > 0)
    || (typeof result?.upsertedCount === 'number' && result.upsertedCount > 0)
  );
}
