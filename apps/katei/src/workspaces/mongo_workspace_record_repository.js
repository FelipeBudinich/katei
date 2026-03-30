import { getMongoDb } from '../data/mongo_client.js';
import { WorkspaceRecordRepository } from './workspace_record_repository.js';
import {
  WORKSPACE_RECORD_COLLECTION_NAME,
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
  constructor({ collection, db, config, getDb = getMongoDb, now = createNowIsoString } = {}) {
    super();
    this.collection = getWorkspaceRecordCollection({ collection, db, config, getDb });
    this.now = now;
  }

  async loadOrCreateWorkspaceRecord(viewerSub) {
    const normalizedViewerSub = normalizeViewerSub(viewerSub);
    const existingDocument = await this.collection.findOne({ _id: normalizedViewerSub });
    const existingRecord = fromWorkspaceRecordDocument(existingDocument);

    if (existingRecord) {
      return existingRecord;
    }

    const initialRecord = createInitialWorkspaceRecord(normalizedViewerSub, { now: this.now() });

    await this.collection.updateOne(
      { _id: normalizedViewerSub },
      { $setOnInsert: toWorkspaceRecordDocument(initialRecord) },
      { upsert: true }
    );

    return this.#loadRequiredWorkspaceRecord(normalizedViewerSub);
  }

  async replaceWorkspaceSnapshot({ viewerSub, workspace, actor } = {}) {
    validateWorkspaceSnapshot(workspace);

    const currentRecord = await this.loadOrCreateWorkspaceRecord(viewerSub);
    const nextRecord = createUpdatedWorkspaceRecord(currentRecord, {
      workspace,
      actor,
      now: this.now()
    });

    await this.collection.replaceOne(
      { _id: nextRecord.viewerSub },
      toWorkspaceRecordDocument(nextRecord),
      { upsert: true }
    );

    return nextRecord;
  }

  async importWorkspaceSnapshot({ viewerSub, workspace, actor } = {}) {
    return this.replaceWorkspaceSnapshot({ viewerSub, workspace, actor });
  }

  async #loadRequiredWorkspaceRecord(viewerSub) {
    const document = await this.collection.findOne({ _id: viewerSub });
    const record = fromWorkspaceRecordDocument(document);

    if (!record) {
      throw new Error(`Workspace record was not found for viewer ${viewerSub}.`);
    }

    return record;
  }
}

function createNowIsoString() {
  return new Date().toISOString();
}
