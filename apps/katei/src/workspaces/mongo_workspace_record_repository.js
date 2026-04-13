import { getMongoDb } from '../data/mongo_client.js';
import {
  canonicalizeBoardRole,
  normalizeBoardActor,
  normalizeBoardCollaboration,
  normalizeBoardInvite
} from '../../public/js/domain/board_collaboration.js';
import {
  WorkspaceAccessDeniedError,
  WorkspaceBoardDeletionPermissionError,
  WorkspaceBoardRoleAssignmentPermissionError,
  WorkspaceCreationPermissionError,
  WorkspaceDeletionPermissionError,
  WorkspaceImportConflictError,
  WorkspaceRecordRepository,
  WorkspaceRevisionConflictError,
  WorkspaceTitleManagementPermissionError
} from './workspace_record_repository.js';
import {
  WORKSPACE_RECORD_COLLECTION_NAME,
  createHomeWorkspaceId,
  createWorkspaceId,
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
import { resolveWorkspaceCreationTitle } from './default_workspace_title.js';

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
    createActivityEventId = createWorkspaceActivityEventId,
    createWorkspaceId: createOpaqueWorkspaceId = createWorkspaceId
  } = {}) {
    super();
    this.collection = collection ?? null;
    this.db = db ?? null;
    this.config = config;
    this.getDb = getDb;
    this.now = now;
    this.createActivityEventId = createActivityEventId;
    this.createWorkspaceId = createOpaqueWorkspaceId;
  }

  async loadOrCreateWorkspaceRecord({ viewerSub, workspaceId = null, viewerEmail = null, viewerName = null, debugLog = null } = {}) {
    return this.#loadOrCreateWorkspaceRecord({
      viewerSub,
      workspaceId,
      viewerEmail,
      viewerName,
      debugLog,
      projectForViewer: true
    });
  }

  async loadOrCreateAuthoritativeWorkspaceRecord({
    viewerSub,
    workspaceId = null,
    viewerEmail = null,
    viewerName = null,
    debugLog = null
  } = {}) {
    return this.#loadOrCreateWorkspaceRecord({
      viewerSub,
      workspaceId,
      viewerEmail,
      viewerName,
      debugLog,
      projectForViewer: false
    });
  }

  async resolvePreferredWorkspaceForViewer({
    viewerSub,
    viewerEmail = null,
    viewerName = null,
    requestedWorkspaceId = null,
    debugLog = null
  } = {}) {
    const normalizedViewerSub = normalizeViewerSub(viewerSub);
    const normalizedViewerEmail = normalizeOptionalEmail(viewerEmail);
    const normalizedRequestedWorkspaceId = normalizeOptionalWorkspaceId(requestedWorkspaceId);

    if (normalizedRequestedWorkspaceId) {
      const requestedWorkspaceResolution = await this.#resolveRequestedWorkspaceForViewer({
        viewerSub: normalizedViewerSub,
        viewerEmail: normalizedViewerEmail,
        workspaceId: normalizedRequestedWorkspaceId,
        debugLog
      });

      if (requestedWorkspaceResolution) {
        return requestedWorkspaceResolution;
      }
    } else {
      const existingHomeResolution = await this.#resolveExistingHomeWorkspaceForViewer({
        viewerSub: normalizedViewerSub,
        viewerEmail: normalizedViewerEmail,
        debugLog
      });

      if (existingHomeResolution) {
        return existingHomeResolution;
      }
    }

    const pendingInviteResolution = await this.#resolvePendingInviteWorkspaceForViewer({
      viewerSub: normalizedViewerSub,
      viewerEmail: normalizedViewerEmail,
      debugLog
    });

    if (pendingInviteResolution) {
      return pendingInviteResolution;
    }

    const accessibleBoardResolution = await this.#resolveAccessibleBoardWorkspaceForViewer({
      viewerSub: normalizedViewerSub,
      viewerEmail: normalizedViewerEmail,
      debugLog
    });

    if (accessibleBoardResolution) {
      return accessibleBoardResolution;
    }

    if (normalizedRequestedWorkspaceId) {
      const existingHomeResolution = await this.#resolveExistingHomeWorkspaceForViewer({
        viewerSub: normalizedViewerSub,
        viewerEmail: normalizedViewerEmail,
        debugLog
      });

      if (existingHomeResolution) {
        return existingHomeResolution;
      }
    }

    const rawHomeDocument = await this.#loadHomeWorkspaceRawDocument(normalizedViewerSub);

    if (!rawHomeDocument) {
      return this.#createPreferredHomeWorkspaceForViewer({
        viewerSub: normalizedViewerSub,
        viewerEmail: normalizedViewerEmail,
        viewerName,
        debugLog
      });
    }

    return this.#repairPreferredHomeWorkspaceForViewer({
      viewerSub: normalizedViewerSub,
      viewerEmail: normalizedViewerEmail,
      viewerName,
      rawHomeDocument,
      debugLog
    });
  }

  async createWorkspaceForSuperAdmin({
    viewerIsSuperAdmin = false,
    viewerSub,
    viewerEmail = null,
    viewerName = null,
    title = undefined
  } = {}) {
    assertSuperAdminWorkspaceCreationAccess(viewerIsSuperAdmin);

    const collection = this.#getCollection();
    const normalizedViewerSub = normalizeViewerSub(viewerSub);
    const initialRecord = await this.#buildInitialWorkspaceRecord({
      viewerSub: normalizedViewerSub,
      viewerEmail,
      viewerName,
      workspaceId: this.createWorkspaceId(),
      title
    });

    await collection.updateOne(
      { _id: initialRecord.workspaceId },
      { $setOnInsert: toWorkspaceRecordDocument(initialRecord) },
      { upsert: true }
    );

    return this.#loadRequiredWorkspaceRecord(initialRecord.workspaceId);
  }

  async loadWorkspaceRecordForSuperAdminTitleManagement({ viewerIsSuperAdmin = false, workspaceId } = {}) {
    assertSuperAdminTitleManagementAccess(viewerIsSuperAdmin);

    return this.#loadWorkspaceRecordForSuperAdminTargetedAccess(workspaceId);
  }

  async loadWorkspaceRecordForSuperAdminBoardRoleAssignment({ viewerIsSuperAdmin = false, workspaceId } = {}) {
    assertSuperAdminBoardRoleAssignmentAccess(viewerIsSuperAdmin);

    return this.#loadWorkspaceRecordForSuperAdminTargetedAccess(workspaceId);
  }

  async loadWorkspaceRecordForSuperAdminBoardDeletion({ viewerIsSuperAdmin = false, workspaceId } = {}) {
    assertSuperAdminBoardDeletionAccess(viewerIsSuperAdmin);

    return this.#loadWorkspaceRecordForSuperAdminTargetedAccess(workspaceId);
  }

  async deleteWorkspaceForSuperAdmin({ viewerIsSuperAdmin = false, workspaceId } = {}) {
    assertSuperAdminWorkspaceDeletionAccess(viewerIsSuperAdmin);

    const record = await this.#loadWorkspaceRecordForSuperAdminTargetedAccess(workspaceId);
    const documentId = normalizeOptionalString(record?.documentId) || normalizeOptionalString(record?.workspaceId);
    const result = await this.#getCollection().deleteOne({ _id: documentId });

    if (typeof result?.deletedCount === 'number' && result.deletedCount < 1) {
      throw new WorkspaceAccessDeniedError();
    }
  }

  async saveWorkspaceTitleForSuperAdmin({
    viewerIsSuperAdmin = false,
    workspaceId,
    title = undefined,
    actor = null,
    expectedRevision
  } = {}) {
    assertSuperAdminTitleManagementAccess(viewerIsSuperAdmin);

    const currentRecord = await this.#loadWorkspaceRecordForSuperAdminTargetedAccess(workspaceId);

    if (currentRecord.revision !== expectedRevision) {
      throw new WorkspaceRevisionConflictError();
    }

    const nextWorkspace = structuredClone(currentRecord.workspace);
    const normalizedTitle = normalizeOptionalString(title);

    if (normalizedTitle) {
      nextWorkspace.title = normalizedTitle;
    } else {
      delete nextWorkspace.title;
    }

    const nextRecord = createUpdatedWorkspaceRecord(currentRecord, {
      workspace: nextWorkspace,
      actor,
      now: this.now(),
      activityType: 'workspace.title.updated',
      createActivityEventId: this.createActivityEventId
    });

    return this.#persistWorkspaceRecord({
      currentDocumentId: currentRecord.documentId ?? currentRecord.workspaceId,
      nextRecord,
      expectedRevision,
      conflictErrorClass: WorkspaceRevisionConflictError
    });
  }

  async listPendingWorkspaceInvitesForViewer({ viewerSub, viewerEmail = null, debugLog = null } = {}) {
    const normalizedViewerSub = normalizeViewerSub(viewerSub);
    const normalizedViewerEmail = normalizeOptionalEmail(viewerEmail);

    return this.#collectPendingWorkspaceInviteSummaries(
      await this.#listWorkspaceDocuments(),
      {
        viewerSub: normalizedViewerSub,
        viewerEmail: normalizedViewerEmail,
        debugLog
      }
    );
  }

  async listAccessibleWorkspacesForViewer({
    viewerSub,
    viewerEmail = null,
    viewerName = null,
    excludeWorkspaceId = null,
    debugLog = null
  } = {}) {
    const normalizedViewerSub = normalizeViewerSub(viewerSub);
    const normalizedViewerEmail = normalizeOptionalEmail(viewerEmail);
    const normalizedExcludeWorkspaceId = normalizeOptionalWorkspaceId(excludeWorkspaceId);

    await this.#ensureHomeWorkspaceDocumentExists({
      viewerSub: normalizedViewerSub,
      viewerEmail: normalizedViewerEmail,
      viewerName
    });

    const documents = await this.#listWorkspaceDocuments();
    const summaries = [];
    const seenWorkspaceIds = new Set();

    for (const document of documents) {
      const record = this.#tryCreateWorkspaceRecordFromDocument(document);

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

  async replaceWorkspaceSnapshot({
    viewerSub,
    workspaceId = null,
    viewerEmail = null,
    viewerName = null,
    workspace,
    actor,
    expectedRevision
  } = {}) {
    validateWorkspaceSnapshot(workspace);

    const currentRecord = await this.loadOrCreateAuthoritativeWorkspaceRecord({
      viewerSub,
      workspaceId,
      viewerEmail,
      viewerName
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

  async importWorkspaceSnapshot({
    viewerSub,
    workspaceId = null,
    viewerEmail = null,
    viewerName = null,
    workspace,
    actor
  } = {}) {
    validateWorkspaceSnapshot(workspace);

    const currentRecord = await this.loadOrCreateAuthoritativeWorkspaceRecord({
      viewerSub,
      workspaceId,
      viewerEmail,
      viewerName
    });

    if (currentRecord.revision !== 0) {
      throw new WorkspaceImportConflictError();
    }

    const nextRecord = createUpdatedWorkspaceRecord(currentRecord, {
      workspace: preserveCreationTimeTitle(currentRecord.workspace, workspace),
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
    viewerName = null,
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
      if (projectForViewer) {
        return projectRecordForViewer(existingRecord, {
          viewerSub: normalizedViewerSub,
          viewerEmail,
          debugLog
        });
      }

      return existingRecord;
    }

    const initialRecord = await this.#buildInitialWorkspaceRecord({
      viewerSub: normalizedViewerSub,
      viewerEmail,
      viewerName,
      workspaceId: null,
      title: undefined
    });

    await collection.updateOne(
      { _id: initialRecord.workspaceId },
      { $setOnInsert: toWorkspaceRecordDocument(initialRecord) },
      { upsert: true }
    );

    const record = await this.#loadRequiredWorkspaceRecord(initialRecord.workspaceId);

    if (projectForViewer) {
      return projectRecordForViewer(record, {
        viewerSub: normalizedViewerSub,
        viewerEmail,
        debugLog
      });
    }

    return record;
  }

  async #resolveRequestedWorkspaceForViewer({ viewerSub, viewerEmail, workspaceId, debugLog = null } = {}) {
    const record = await this.#loadProjectedAccessibleWorkspaceRecord({
      viewerSub,
      viewerEmail,
      workspaceId,
      debugLog
    });

    if (!record) {
      return null;
    }

    const resolvedBoardId = resolveVisibleWorkspaceBoardId(record.workspace);

    if (!resolvedBoardId) {
      return null;
    }

    return createPreferredWorkspaceResolution({
      record,
      viewerSub,
      resolvedBoardId,
      resolution: 'requested-workspace'
    });
  }

  async #resolveExistingHomeWorkspaceForViewer({ viewerSub, viewerEmail, debugLog = null } = {}) {
    const rawHomeDocument = await this.#loadHomeWorkspaceRawDocument(viewerSub);

    if (!rawHomeDocument) {
      return null;
    }

    const record = this.#tryCreateWorkspaceRecordFromDocument(rawHomeDocument);

    if (!record) {
      return null;
    }

    const projectedRecord = projectRecordForViewer(record, {
      viewerSub,
      viewerEmail,
      debugLog
    });
    const resolvedBoardId = resolveVisibleWorkspaceBoardId(projectedRecord.workspace);

    if (!resolvedBoardId) {
      return null;
    }

    return createPreferredWorkspaceResolution({
      record: projectedRecord,
      viewerSub,
      resolvedBoardId,
      resolution: 'fallback-existing-home'
    });
  }

  async #resolvePendingInviteWorkspaceForViewer({ viewerSub, viewerEmail, debugLog = null } = {}) {
    const pendingInvites = this.#collectPendingWorkspaceInviteSummaries(
      await this.#listWorkspaceDocuments(),
      {
        viewerSub,
        viewerEmail,
        debugLog
      }
    ).sort(comparePendingWorkspaceInviteSummaries);

    for (const pendingInvite of pendingInvites) {
      const record = await this.#loadProjectedAccessibleWorkspaceRecord({
        viewerSub,
        viewerEmail,
        workspaceId: pendingInvite.workspaceId,
        debugLog
      });

      if (!record?.workspace?.boards?.[pendingInvite.boardId]) {
        continue;
      }

      return createPreferredWorkspaceResolution({
        record,
        viewerSub,
        resolvedBoardId: pendingInvite.boardId,
        resolution: 'fallback-pending-invite'
      });
    }

    return null;
  }

  async #resolveAccessibleBoardWorkspaceForViewer({ viewerSub, viewerEmail, debugLog = null } = {}) {
    const viewerHomeWorkspaceId = createHomeWorkspaceId(viewerSub);
    const candidates = [];

    for (const document of await this.#listWorkspaceDocuments()) {
      const record = this.#tryCreateWorkspaceRecordFromDocument(document);

      if (!record || record.workspaceId === viewerHomeWorkspaceId) {
        continue;
      }

      const projectedRecord = projectRecordForViewer(record, {
        viewerSub,
        viewerEmail,
        debugLog
      });

      for (const boardId of collectWorkspaceBoardIds(projectedRecord.workspace)) {
        const board = projectedRecord.workspace?.boards?.[boardId];

        if (!canViewerReadBoard({ viewerSub, viewerEmail, board })) {
          continue;
        }

        candidates.push({
          record: projectedRecord,
          workspaceId: projectedRecord.workspaceId,
          boardId,
          workspaceCreatedAt: normalizeOptionalIsoString(record.createdAt) ?? '',
          boardCreatedAt: normalizeOptionalIsoString(board?.createdAt) ?? ''
        });
      }
    }

    candidates.sort(compareAccessibleBoardCandidates);

    const firstCandidate = candidates[0] ?? null;

    if (!firstCandidate) {
      return null;
    }

    return createPreferredWorkspaceResolution({
      record: firstCandidate.record,
      viewerSub,
      resolvedBoardId: firstCandidate.boardId,
      resolution: 'fallback-accessible-board'
    });
  }

  async #createPreferredHomeWorkspaceForViewer({ viewerSub, viewerEmail = null, viewerName = null, debugLog = null } = {}) {
    const collection = this.#getCollection();
    const initialRecord = await this.#buildInitialWorkspaceRecord({
      viewerSub,
      viewerEmail,
      viewerName,
      workspaceId: null,
      title: undefined
    });

    await collection.updateOne(
      { _id: initialRecord.workspaceId },
      { $setOnInsert: toWorkspaceRecordDocument(initialRecord) },
      { upsert: true }
    );

    const record = await this.#loadRequiredWorkspaceRecord(initialRecord.workspaceId);
    const projectedRecord = projectRecordForViewer(record, {
      viewerSub,
      viewerEmail,
      debugLog
    });
    const resolvedBoardId = resolveVisibleWorkspaceBoardId(projectedRecord.workspace);

    if (!resolvedBoardId) {
      throw new WorkspaceAccessDeniedError();
    }

    return createPreferredWorkspaceResolution({
      record: projectedRecord,
      viewerSub,
      resolvedBoardId,
      resolution: 'fallback-created-home'
    });
  }

  async #repairPreferredHomeWorkspaceForViewer({
    viewerSub,
    viewerEmail = null,
    viewerName = null,
    rawHomeDocument,
    debugLog = null
  } = {}) {
    const repairedRecord = await this.#repairHomeWorkspaceRecord({
      viewerSub,
      viewerEmail,
      viewerName,
      rawHomeDocument
    });
    const projectedRecord = projectRecordForViewer(repairedRecord, {
      viewerSub,
      viewerEmail,
      debugLog
    });
    const resolvedBoardId = resolveVisibleWorkspaceBoardId(projectedRecord.workspace);

    if (!resolvedBoardId) {
      throw new WorkspaceAccessDeniedError();
    }

    return createPreferredWorkspaceResolution({
      record: projectedRecord,
      viewerSub,
      resolvedBoardId,
      resolution: 'fallback-repaired-home'
    });
  }

  async #repairHomeWorkspaceRecord({ viewerSub, viewerEmail = null, viewerName = null, rawHomeDocument } = {}) {
    const workspaceId =
      normalizeOptionalWorkspaceId(rawHomeDocument?.workspaceId)
      ?? normalizeOptionalWorkspaceId(rawHomeDocument?._id)
      ?? createHomeWorkspaceId(viewerSub);
    const documentId = normalizeOptionalWorkspaceId(rawHomeDocument?._id) ?? workspaceId;
    const currentRevision = normalizeRevisionNumber(rawHomeDocument?.revision);
    const createdAt =
      normalizeOptionalIsoString(rawHomeDocument?.createdAt)
      ?? normalizeOptionalIsoString(rawHomeDocument?.updatedAt)
      ?? this.now();
    const updatedAt =
      normalizeOptionalIsoString(rawHomeDocument?.updatedAt)
      ?? createdAt;
    const repairedWorkspace = (
      await this.#buildInitialWorkspaceRecord({
        viewerSub,
        viewerEmail,
        viewerName,
        workspaceId,
        title: normalizeOptionalString(rawHomeDocument?.workspace?.title) || undefined
      })
    ).workspace;
    const baseRecord = createWorkspaceRecord({
      workspaceId,
      viewerSub,
      isHomeWorkspace: true,
      documentId,
      workspace: repairedWorkspace,
      revision: currentRevision,
      createdAt,
      updatedAt,
      lastChangedBy: rawHomeDocument?.lastChangedBy ?? null,
      activityEvents: Array.isArray(rawHomeDocument?.activityEvents) ? rawHomeDocument.activityEvents : [],
      commandReceipts: Array.isArray(rawHomeDocument?.commandReceipts) ? rawHomeDocument.commandReceipts : []
    });
    const nextRecord = createUpdatedWorkspaceRecord(baseRecord, {
      workspace: repairedWorkspace,
      actor: null,
      now: this.now(),
      activityType: 'workspace.repaired',
      createActivityEventId: this.createActivityEventId
    });

    return this.#persistWorkspaceRecord({
      currentDocumentId: documentId,
      nextRecord,
      expectedRevision: baseRecord.revision,
      conflictErrorClass: WorkspaceRevisionConflictError
    });
  }

  async #ensureHomeWorkspaceDocumentExists({ viewerSub, viewerEmail = null, viewerName = null } = {}) {
    const existingDocument = await this.#loadHomeWorkspaceRawDocument(viewerSub);

    if (existingDocument) {
      return existingDocument;
    }

    const collection = this.#getCollection();
    const initialRecord = await this.#buildInitialWorkspaceRecord({
      viewerSub,
      viewerEmail,
      viewerName,
      workspaceId: null,
      title: undefined
    });

    await collection.updateOne(
      { _id: initialRecord.workspaceId },
      { $setOnInsert: toWorkspaceRecordDocument(initialRecord) },
      { upsert: true }
    );

    return collection.findOne({ _id: initialRecord.workspaceId });
  }

  async #listWorkspaceDocuments() {
    return this.#getCollection().find({}).toArray();
  }

  async #loadProjectedAccessibleWorkspaceRecord({ viewerSub, viewerEmail, workspaceId, debugLog = null } = {}) {
    const record = this.#tryCreateWorkspaceRecordFromDocument(
      await this.#loadWorkspaceDocument(workspaceId)
    );

    if (!record) {
      return null;
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
      return null;
    }

    const projectedRecord = projectRecordForViewer(record, { viewerSub, viewerEmail, debugLog });
    return resolveVisibleWorkspaceBoardId(projectedRecord.workspace) ? projectedRecord : null;
  }

  async #loadWorkspaceDocument(workspaceId) {
    const collection = this.#getCollection();
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    let document = await collection.findOne({ _id: normalizedWorkspaceId });

    if (!document) {
      const legacyHomeWorkspaceId = parseHomeWorkspaceViewerSub(normalizedWorkspaceId);

      if (legacyHomeWorkspaceId) {
        document = await collection.findOne({ _id: legacyHomeWorkspaceId });
      }
    }

    return document;
  }

  async #loadRequiredWorkspaceRecord(workspaceId) {
    const document = await this.#loadWorkspaceDocument(workspaceId);

    const record = fromWorkspaceRecordDocument(document);

    if (!record) {
      throw new Error(`Workspace record was not found for workspace ${workspaceId}.`);
    }

    return record;
  }

  async #loadWorkspaceRecordForSuperAdminTargetedAccess(workspaceId) {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);

    try {
      return await this.#loadRequiredWorkspaceRecord(normalizedWorkspaceId);
    } catch (error) {
      if (isWorkspaceRecordNotFoundError(error, normalizedWorkspaceId)) {
        throw new WorkspaceAccessDeniedError();
      }

      throw error;
    }
  }

  async #loadHomeWorkspaceRecord(viewerSub) {
    return fromWorkspaceRecordDocument(await this.#loadHomeWorkspaceRawDocument(viewerSub));
  }

  async #loadHomeWorkspaceRawDocument(viewerSub) {
    const collection = this.#getCollection();

    return (
      (await collection.findOne({ viewerSub, isHomeWorkspace: true }))
      ?? (await collection.findOne({ _id: createHomeWorkspaceId(viewerSub) }))
      ?? (await collection.findOne({ _id: viewerSub }))
    );
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

    if (projectForViewer) {
      return projectRecordForViewer(record, { viewerSub, viewerEmail, debugLog });
    }

    return record;
  }

  #collectPendingWorkspaceInviteSummaries(documents, { viewerSub, viewerEmail = null, debugLog = null } = {}) {
    const summaries = [];
    const seenInviteKeys = new Set();

    for (const document of documents) {
      const workspaceId =
        normalizeOptionalWorkspaceId(document?.workspaceId)
        ?? normalizeOptionalWorkspaceId(document?._id);

      if (!workspaceId || !document?.workspace?.boards || typeof document.workspace.boards !== 'object') {
        continue;
      }

      for (const [boardId, board] of Object.entries(document.workspace.boards)) {
        const inviteSummaries = createPendingWorkspaceInviteSummaries(board, {
          workspaceId,
          boardId,
          viewerSub,
          viewerEmail,
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

  #tryCreateWorkspaceRecordFromDocument(document) {
    try {
      return fromWorkspaceRecordDocument(document);
    } catch (error) {
      return null;
    }
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

  async #buildInitialWorkspaceRecord({
    viewerSub,
    viewerEmail = null,
    viewerName = null,
    workspaceId = null,
    title = undefined
  } = {}) {
    const normalizedViewerSub = normalizeViewerSub(viewerSub);
    const ownedWorkspaceTitles = await this.#listOwnedWorkspaceTitles(normalizedViewerSub);
    const nextTitle = resolveWorkspaceCreationTitle({
      requestedTitle: title,
      displayName: normalizeOptionalString(viewerName) || null,
      email: normalizeOptionalEmail(viewerEmail),
      existingWorkspaceTitles: ownedWorkspaceTitles
    });

    return createInitialWorkspaceRecord(normalizedViewerSub, {
      workspaceId: workspaceId ?? createHomeWorkspaceId(normalizedViewerSub),
      title: nextTitle,
      creator: {
        email: normalizeOptionalEmail(viewerEmail),
        displayName: normalizeOptionalString(viewerName) || null
      },
      now: this.now()
    });
  }

  async #listOwnedWorkspaceTitles(viewerSub) {
    const collection = this.#getCollection();
    const documents = await collection.find({ viewerSub }).toArray();

    return documents
      .map((document) => this.#tryCreateWorkspaceRecordFromDocument(document))
      .filter(Boolean)
      .map((record) => resolveWorkspaceTitle(record.workspace))
      .filter(Boolean);
  }
}

function createNowIsoString() {
  return new Date().toISOString();
}

function assertSuperAdminTitleManagementAccess(viewerIsSuperAdmin) {
  if (viewerIsSuperAdmin !== true) {
    throw new WorkspaceTitleManagementPermissionError();
  }
}

function assertSuperAdminBoardRoleAssignmentAccess(viewerIsSuperAdmin) {
  if (viewerIsSuperAdmin !== true) {
    throw new WorkspaceBoardRoleAssignmentPermissionError();
  }
}

function assertSuperAdminBoardDeletionAccess(viewerIsSuperAdmin) {
  if (viewerIsSuperAdmin !== true) {
    throw new WorkspaceBoardDeletionPermissionError();
  }
}

function assertSuperAdminWorkspaceDeletionAccess(viewerIsSuperAdmin) {
  if (viewerIsSuperAdmin !== true) {
    throw new WorkspaceDeletionPermissionError();
  }
}

function assertSuperAdminWorkspaceCreationAccess(viewerIsSuperAdmin) {
  if (viewerIsSuperAdmin !== true) {
    throw new WorkspaceCreationPermissionError();
  }
}

function isWorkspaceRecordNotFoundError(error, workspaceId) {
  return error?.message === `Workspace record was not found for workspace ${workspaceId}.`;
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
    workspaceTitle: resolveWorkspaceTitle(record?.workspace),
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

function comparePendingWorkspaceInviteSummaries(left, right) {
  const invitedAtComparison = compareAscendingStrings(
    normalizeOptionalIsoString(left?.invitedAt) ?? '',
    normalizeOptionalIsoString(right?.invitedAt) ?? ''
  );

  if (invitedAtComparison !== 0) {
    return invitedAtComparison;
  }

  const workspaceComparison = compareAscendingStrings(
    normalizeOptionalString(left?.workspaceId),
    normalizeOptionalString(right?.workspaceId)
  );

  if (workspaceComparison !== 0) {
    return workspaceComparison;
  }

  const boardComparison = compareAscendingStrings(
    normalizeOptionalString(left?.boardId),
    normalizeOptionalString(right?.boardId)
  );

  if (boardComparison !== 0) {
    return boardComparison;
  }

  return compareAscendingStrings(
    normalizeOptionalString(left?.inviteId),
    normalizeOptionalString(right?.inviteId)
  );
}

function compareAccessibleBoardCandidates(left, right) {
  const workspaceCreatedAtComparison = compareAscendingStrings(left?.workspaceCreatedAt ?? '', right?.workspaceCreatedAt ?? '');

  if (workspaceCreatedAtComparison !== 0) {
    return workspaceCreatedAtComparison;
  }

  const boardCreatedAtComparison = compareAscendingStrings(left?.boardCreatedAt ?? '', right?.boardCreatedAt ?? '');

  if (boardCreatedAtComparison !== 0) {
    return boardCreatedAtComparison;
  }

  const workspaceComparison = compareAscendingStrings(left?.workspaceId ?? '', right?.workspaceId ?? '');

  if (workspaceComparison !== 0) {
    return workspaceComparison;
  }

  return compareAscendingStrings(left?.boardId ?? '', right?.boardId ?? '');
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

function resolveVisibleWorkspaceBoardId(workspace) {
  const activeBoardId = normalizeOptionalWorkspaceId(workspace?.ui?.activeBoardId);

  if (activeBoardId && workspace?.boards?.[activeBoardId]) {
    return activeBoardId;
  }

  return collectWorkspaceBoardIds(workspace)[0] ?? null;
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

function resolveWorkspaceTitle(workspace) {
  return normalizeOptionalString(workspace?.title) || null;
}

function preserveCreationTimeTitle(currentWorkspace, importedWorkspace) {
  const importedWorkspaceTitle = resolveWorkspaceTitle(importedWorkspace);

  if (importedWorkspaceTitle) {
    return importedWorkspace;
  }

  const currentWorkspaceTitle = resolveWorkspaceTitle(currentWorkspace);

  if (!currentWorkspaceTitle) {
    return importedWorkspace;
  }

  return {
    ...structuredClone(importedWorkspace),
    title: currentWorkspaceTitle
  };
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

function normalizeRevisionNumber(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function createPreferredWorkspaceResolution({ record, viewerSub, resolvedBoardId, resolution } = {}) {
  const normalizedWorkspaceId =
    normalizeOptionalWorkspaceId(record?.workspaceId)
    ?? normalizeOptionalWorkspaceId(record?.workspace?.workspaceId);
  const normalizedResolvedBoardId = normalizeOptionalWorkspaceId(resolvedBoardId);

  if (!normalizedWorkspaceId || !normalizedResolvedBoardId || !record?.workspace?.boards?.[normalizedResolvedBoardId]) {
    return null;
  }

  const nextRecord = structuredClone(record);

  nextRecord.isHomeWorkspace = normalizedWorkspaceId === createHomeWorkspaceId(viewerSub);
  nextRecord.workspace = structuredClone(record.workspace);
  nextRecord.workspace.ui = {
    ...(nextRecord.workspace.ui ?? {}),
    activeBoardId: normalizedResolvedBoardId
  };

  return {
    record: nextRecord,
    resolvedWorkspaceId: normalizedWorkspaceId,
    resolvedBoardId: normalizedResolvedBoardId,
    resolution
  };
}

function compareAscendingStrings(left, right) {
  return String(left ?? '').localeCompare(String(right ?? ''));
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
