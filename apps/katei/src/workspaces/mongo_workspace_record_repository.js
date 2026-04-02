import { getMongoDb } from '../data/mongo_client.js';
import {
  canonicalizeBoardRole,
  normalizeBoardActor,
  normalizeBoardCollaboration,
  normalizeBoardInvite
} from '../../public/js/domain/board_collaboration.js';
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
import { canViewerAccessWorkspace, canViewerReadBoard, filterWorkspaceForViewer } from './workspace_access.js';

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

export function projectRecordForViewer(record, { viewerSub, viewerEmail = null, debugLog = null } = {}) {
  const normalizedRecord = createWorkspaceRecord(record);

  return {
    ...normalizedRecord,
    workspace: filterWorkspaceForViewer({
      viewerSub,
      viewerEmail,
      ownerSub: normalizedRecord.viewerSub,
      workspace: normalizedRecord.workspace,
      debugLog
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

  async loadOrCreateWorkspaceRecord({ viewerSub, workspaceId = null, viewerEmail = null, debugLog = null } = {}) {
    return this.#loadOrCreateWorkspaceRecord({
      viewerSub,
      workspaceId,
      viewerEmail,
      debugLog,
      projectForViewer: true
    });
  }

  async loadOrCreateAuthoritativeWorkspaceRecord({ viewerSub, workspaceId = null, viewerEmail = null, debugLog = null } = {}) {
    return this.#loadOrCreateWorkspaceRecord({
      viewerSub,
      workspaceId,
      viewerEmail,
      debugLog,
      projectForViewer: false
    });
  }

  async listPendingWorkspaceInvitesForViewer({ viewerSub, viewerEmail = null, debugLog = null } = {}) {
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
          viewerEmail: normalizedViewerEmail,
          debugLog
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

  async listAccessibleWorkspacesForViewer({
    viewerSub,
    viewerEmail = null,
    excludeWorkspaceId = null,
    debugLog = null
  } = {}) {
    const collection = this.#getCollection();
    const normalizedViewerSub = normalizeViewerSub(viewerSub);
    const normalizedViewerEmail = normalizeOptionalEmail(viewerEmail);
    const normalizedExcludeWorkspaceId = normalizeOptionalWorkspaceId(excludeWorkspaceId);

    await this.#loadOrCreateWorkspaceRecord({
      viewerSub: normalizedViewerSub,
      viewerEmail: normalizedViewerEmail,
      debugLog,
      projectForViewer: true
    });

    const documents = await collection.find({}).toArray();
    const summaries = [];
    const seenWorkspaceIds = new Set();

    for (const document of documents) {
      const record = fromWorkspaceRecordDocument(document);

      if (!record) {
        continue;
      }

      const projectedRecord = projectRecordForViewer(record, {
        viewerSub: normalizedViewerSub,
        viewerEmail: normalizedViewerEmail,
        debugLog
      });
      const summary = createAccessibleWorkspaceSummary(projectedRecord, {
        viewerSub: normalizedViewerSub,
        viewerEmail: normalizedViewerEmail
      });

      if (!summary || summary.workspaceId === normalizedExcludeWorkspaceId || seenWorkspaceIds.has(summary.workspaceId)) {
        continue;
      }

      seenWorkspaceIds.add(summary.workspaceId);
      summaries.push(summary);
    }

    return summaries.sort(compareAccessibleWorkspaceSummaries);
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

  async #loadOrCreateWorkspaceRecord({
    viewerSub,
    workspaceId = null,
    viewerEmail = null,
    debugLog = null,
    projectForViewer = true
  } = {}) {
    const collection = this.#getCollection();
    const normalizedViewerSub = normalizeViewerSub(viewerSub);
    const normalizedWorkspaceId = normalizeOptionalWorkspaceId(workspaceId);

    if (normalizedWorkspaceId) {
      return this.#loadAccessibleWorkspaceRecord({
        viewerSub: normalizedViewerSub,
        viewerEmail,
        workspaceId: normalizedWorkspaceId,
        debugLog,
        projectForViewer
      });
    }

    const existingRecord = await this.#loadHomeWorkspaceRecord(normalizedViewerSub);

    if (existingRecord) {
      return projectRecordForViewer(existingRecord, {
        viewerSub: normalizedViewerSub,
        viewerEmail,
        debugLog
      });
    }

    const initialRecord = createInitialWorkspaceRecord(normalizedViewerSub, { now: this.now() });

    await collection.updateOne(
      { _id: initialRecord.workspaceId },
      { $setOnInsert: toWorkspaceRecordDocument(initialRecord) },
      { upsert: true }
    );

    const record = await this.#loadRequiredWorkspaceRecord(initialRecord.workspaceId);
    return projectRecordForViewer(record, {
      viewerSub: normalizedViewerSub,
      viewerEmail,
      debugLog
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

  async #loadAccessibleWorkspaceRecord({ viewerSub, viewerEmail, workspaceId, debugLog = null, projectForViewer = true }) {
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
        workspace: record.workspace,
        debugLog
      })
    ) {
      throw new WorkspaceAccessDeniedError();
    }

    if (projectForViewer || record.viewerSub === viewerSub) {
      return projectRecordForViewer(record, { viewerSub, viewerEmail, debugLog });
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
  { workspaceId, boardId, viewerSub, viewerEmail = null, debugLog = null } = {}
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
        viewerEmail,
        debugLog
      })
    )
    .filter(Boolean);
}

function createPendingWorkspaceInviteSummary(
  invite,
  { workspaceId, boardId, boardTitle, viewerSub, viewerEmail = null, debugLog = null } = {}
) {
  const normalizedInvite = normalizeBoardInvite(invite);
  const reject = (reason, extraFields = {}) => {
    logInviteDebug(debugLog, 'invite.lookup.scan', {
      viewerSub,
      viewerEmail,
      workspaceId,
      boardId,
      boardTitle,
      inviteId: normalizedInvite?.id ?? normalizeOptionalString(invite?.id),
      inviteEmail: normalizedInvite?.email ?? normalizeOptionalEmail(invite?.email),
      inviteActorId: normalizeOptionalString(normalizedInvite?.actor?.id ?? invite?.actor?.id),
      inviteStatus: normalizedInvite?.status ?? normalizeOptionalString(invite?.status),
      matched: false,
      rejectReason: reason,
      ...extraFields
    });

    return null;
  };

  if (!normalizedInvite) {
    return reject('invalid_invite');
  }

  if (normalizedInvite.status !== 'pending') {
    return reject('not_pending');
  }

  if (!inviteMatchesViewer(normalizedInvite, { viewerSub, viewerEmail })) {
    return reject('viewer_mismatch');
  }

  const invitedBy = normalizeBoardActor(normalizedInvite.invitedBy);
  const invitedAt = normalizeOptionalIsoString(normalizedInvite.invitedAt);

  if (!invitedBy || !invitedAt) {
    return reject('malformed_summary', {
      hasInvitedBy: Boolean(invitedBy),
      hasInvitedAt: Boolean(invitedAt)
    });
  }

  logInviteDebug(debugLog, 'invite.lookup.scan', {
    viewerSub,
    viewerEmail,
    workspaceId,
    boardId,
    boardTitle,
    inviteId: normalizedInvite.id,
    inviteEmail: normalizedInvite.email ?? null,
    inviteActorId: normalizedInvite.actor?.id ?? null,
    inviteStatus: normalizedInvite.status,
    matched: true,
    rejectReason: null
  });

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

function createAccessibleWorkspaceSummary(record, { viewerSub, viewerEmail = null } = {}) {
  const workspaceId = normalizeOptionalWorkspaceId(record?.workspaceId ?? record?.workspace?.workspaceId);
  const normalizedViewerSub = normalizeViewerSub(viewerSub);
  const boards = collectWorkspaceBoardIds(record?.workspace)
    .map((boardId) =>
      createAccessibleWorkspaceBoardSummary(record?.workspace?.boards?.[boardId], {
        boardId,
        viewerSub: normalizedViewerSub,
        viewerEmail
      })
    )
    .filter(Boolean);

  if (!workspaceId || boards.length === 0) {
    return null;
  }

  return {
    workspaceId,
    isHomeWorkspace: Boolean(normalizedViewerSub && workspaceId === createHomeWorkspaceId(normalizedViewerSub)),
    boards
  };
}

function createAccessibleWorkspaceBoardSummary(board, { boardId, viewerSub, viewerEmail = null } = {}) {
  const normalizedBoardId = normalizeOptionalWorkspaceId(boardId ?? board?.id);
  const boardTitle = normalizeOptionalString(board?.title);

  if (!normalizedBoardId || !boardTitle || !canViewerReadBoard({ viewerSub, viewerEmail, board })) {
    return null;
  }

  const collaboration = normalizeBoardCollaboration(board);
  const membership = collaboration.memberships.find((entry) => {
    const actorType = normalizeOptionalString(entry?.actor?.type).toLowerCase();
    const actorId = normalizeOptionalString(entry?.actor?.id);
    return actorType === 'human' && actorId === viewerSub;
  });
  const role = canonicalizeBoardRole(membership?.role);

  if (!role) {
    return null;
  }

  return {
    boardId: normalizedBoardId,
    boardTitle,
    role
  };
}

function compareAccessibleWorkspaceSummaries(left, right) {
  if (left?.isHomeWorkspace === true && right?.isHomeWorkspace !== true) {
    return -1;
  }

  if (left?.isHomeWorkspace !== true && right?.isHomeWorkspace === true) {
    return 1;
  }

  return normalizeOptionalString(left?.workspaceId).localeCompare(normalizeOptionalString(right?.workspaceId));
}

function collectWorkspaceBoardIds(workspace) {
  const boardIds = [];
  const seenBoardIds = new Set();

  for (const boardId of Array.isArray(workspace?.boardOrder) ? workspace.boardOrder : []) {
    if (typeof boardId !== 'string' || seenBoardIds.has(boardId) || !workspace?.boards?.[boardId]) {
      continue;
    }

    seenBoardIds.add(boardId);
    boardIds.push(boardId);
  }

  for (const boardId of Object.keys(workspace?.boards ?? {})) {
    if (seenBoardIds.has(boardId) || !workspace.boards[boardId]) {
      continue;
    }

    seenBoardIds.add(boardId);
    boardIds.push(boardId);
  }

  return boardIds;
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

function logInviteDebug(debugLog, event, fields) {
  if (typeof debugLog === 'function') {
    debugLog(event, fields);
  }
}
