import { getMongoDb } from '../data/mongo_client.js';
import { normalizeBoardActor, normalizeBoardInvite } from '../../public/js/domain/board_collaboration.js';
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
  createWorkspaceRecord,
  createInitialWorkspaceRecord,
  createUpdatedWorkspaceRecord,
  fromWorkspaceRecordDocument,
  normalizeWorkspaceId,
  normalizeViewerSub,
  parseHomeWorkspaceViewerSub,
  toWorkspaceRecordDocument,
  validateWorkspaceSnapshot
} from './workspace_record.js';
import { canViewerAccessWorkspace, filterWorkspaceForViewer } from './workspace_access.js';

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

export function projectRecordForViewer(record, { viewerSub, viewerEmail = null } = {}) {
  const normalizedRecord = createWorkspaceRecord(record);

  return {
    ...normalizedRecord,
    workspace: filterWorkspaceForViewer({
      viewerSub,
      viewerEmail,
      ownerSub: normalizedRecord.viewerSub,
      workspace: normalizedRecord.workspace
    })
  };
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
    return this.#loadOrCreateWorkspaceRecord({
      viewerSub,
      workspaceId,
      viewerEmail,
      projectForViewer: true
    });
  }

  async loadOrCreateAuthoritativeWorkspaceRecord({ viewerSub, workspaceId = null, viewerEmail = null } = {}) {
    return this.#loadOrCreateWorkspaceRecord({
      viewerSub,
      workspaceId,
      viewerEmail,
      projectForViewer: false
    });
  }

  async listPendingWorkspaceInvitesForViewer({ viewerSub, viewerEmail = null } = {}) {
    const collection = this.#getCollection();
    const normalizedViewerSub = normalizeViewerSub(viewerSub);
    const normalizedViewerEmail = normalizeOptionalEmail(viewerEmail);
    const documents = await collection.find({}).toArray();
    const summaries = [];
    const seenInviteKeys = new Set();

    for (const document of documents) {
      const record = fromWorkspaceRecordDocument(document);

      if (!record?.workspace?.boards || typeof record.workspace.boards !== 'object') {
        continue;
      }

      for (const [boardId, board] of Object.entries(record.workspace.boards)) {
        const inviteSummaries = createPendingWorkspaceInviteSummaries(board, {
          workspaceId: record.workspaceId,
          boardId,
          viewerSub: normalizedViewerSub,
          viewerEmail: normalizedViewerEmail
        });

        for (const inviteSummary of inviteSummaries) {
          const inviteKey = `${inviteSummary.workspaceId}:${inviteSummary.boardId}:${inviteSummary.inviteId}`;

          if (seenInviteKeys.has(inviteKey)) {
            continue;
          }

          seenInviteKeys.add(inviteKey);
          summaries.push(inviteSummary);
        }
      }
    }

    return summaries;
  }

  async replaceWorkspaceSnapshot({ viewerSub, workspaceId = null, viewerEmail = null, workspace, actor, expectedRevision } = {}) {
    validateWorkspaceSnapshot(workspace);

    const currentRecord = await this.loadOrCreateAuthoritativeWorkspaceRecord({
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

    const currentRecord = await this.loadOrCreateAuthoritativeWorkspaceRecord({
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

  async #loadOrCreateWorkspaceRecord({ viewerSub, workspaceId = null, viewerEmail = null, projectForViewer = true } = {}) {
    const collection = this.#getCollection();
    const normalizedViewerSub = normalizeViewerSub(viewerSub);
    const normalizedWorkspaceId = normalizeOptionalWorkspaceId(workspaceId);

    if (normalizedWorkspaceId) {
      return this.#loadAccessibleWorkspaceRecord({
        viewerSub: normalizedViewerSub,
        viewerEmail,
        workspaceId: normalizedWorkspaceId,
        projectForViewer
      });
    }

    const existingRecord = await this.#loadHomeWorkspaceRecord(normalizedViewerSub);

    if (existingRecord) {
      return projectRecordForViewer(existingRecord, { viewerSub: normalizedViewerSub, viewerEmail });
    }

    const initialRecord = createInitialWorkspaceRecord(normalizedViewerSub, { now: this.now() });

    await collection.updateOne(
      { _id: initialRecord.workspaceId },
      { $setOnInsert: toWorkspaceRecordDocument(initialRecord) },
      { upsert: true }
    );

    const record = await this.#loadRequiredWorkspaceRecord(initialRecord.workspaceId);
    return projectRecordForViewer(record, { viewerSub: normalizedViewerSub, viewerEmail });
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

  async #loadAccessibleWorkspaceRecord({ viewerSub, viewerEmail, workspaceId, projectForViewer = true }) {
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

    if (projectForViewer || record.viewerSub === viewerSub) {
      return projectRecordForViewer(record, { viewerSub, viewerEmail });
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

function createPendingWorkspaceInviteSummaries(
  board,
  { workspaceId, boardId, viewerSub, viewerEmail = null } = {}
) {
  if (!board || typeof board !== 'object') {
    return [];
  }

  const normalizedBoardId = normalizeOptionalWorkspaceId(boardId);
  const normalizedBoardTitle = normalizeOptionalString(board.title);
  const invites = Array.isArray(board?.collaboration?.invites) ? board.collaboration.invites : [];

  if (!normalizedBoardId || !normalizedBoardTitle || invites.length === 0) {
    return [];
  }

  return invites
    .map((invite) =>
      createPendingWorkspaceInviteSummary(invite, {
        workspaceId,
        boardId: normalizedBoardId,
        boardTitle: normalizedBoardTitle,
        viewerSub,
        viewerEmail
      })
    )
    .filter(Boolean);
}

function createPendingWorkspaceInviteSummary(
  invite,
  { workspaceId, boardId, boardTitle, viewerSub, viewerEmail = null } = {}
) {
  const normalizedInvite = normalizeBoardInvite(invite);

  if (
    !normalizedInvite ||
    normalizedInvite.status !== 'pending' ||
    !inviteMatchesViewer(normalizedInvite, { viewerSub, viewerEmail })
  ) {
    return null;
  }

  const invitedBy = normalizeBoardActor(normalizedInvite.invitedBy);
  const invitedAt = normalizeOptionalIsoString(normalizedInvite.invitedAt);

  if (!invitedBy || !invitedAt) {
    return null;
  }

  return {
    workspaceId,
    boardId,
    boardTitle,
    inviteId: normalizedInvite.id,
    role: normalizedInvite.role,
    invitedAt,
    invitedBy: {
      id: invitedBy.id,
      email: invitedBy.email ?? null,
      displayName: invitedBy.displayName ?? null
    }
  };
}

function inviteMatchesViewer(invite, { viewerSub, viewerEmail = null } = {}) {
  const inviteActorId = normalizeOptionalString(invite?.actor?.id);
  const inviteEmail = normalizeOptionalEmail(invite?.email);

  return Boolean(
    (inviteActorId && inviteActorId === viewerSub) ||
      (inviteEmail && viewerEmail && inviteEmail === viewerEmail)
  );
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalEmail(value) {
  const normalizedValue = normalizeOptionalString(value).toLowerCase();
  return normalizedValue || null;
}

function normalizeOptionalIsoString(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const parsedValue = new Date(value);
  return Number.isNaN(parsedValue.getTime()) ? null : parsedValue.toISOString();
}

function didPersistWorkspaceDocument(result) {
  return Boolean(
    (typeof result?.matchedCount === 'number' && result.matchedCount > 0)
    || (typeof result?.modifiedCount === 'number' && result.modifiedCount > 0)
    || (typeof result?.upsertedCount === 'number' && result.upsertedCount > 0)
  );
}
