import {
  cloneWorkspace,
  createEmptyWorkspace,
  validateWorkspaceShape
} from '../../public/js/domain/workspace.js';

export const WORKSPACE_RECORD_COLLECTION_NAME = 'workspace_records';

export function createInitialWorkspaceRecord(viewerSub, { now = new Date().toISOString() } = {}) {
  return createWorkspaceRecord({
    viewerSub,
    workspace: createEmptyWorkspace(),
    revision: 0,
    createdAt: now,
    updatedAt: now,
    lastChangedBy: null,
    activityEvents: []
  });
}

export function createWorkspaceRecord({
  viewerSub,
  workspace = createEmptyWorkspace(),
  revision = 0,
  createdAt = new Date().toISOString(),
  updatedAt = createdAt,
  lastChangedBy = null,
  activityEvents = []
} = {}) {
  return {
    viewerSub: normalizeViewerSub(viewerSub),
    workspace: cloneWorkspace(validateWorkspaceSnapshot(workspace)),
    revision: normalizeRevision(revision),
    createdAt: normalizeIsoTimestamp(createdAt, 'createdAt'),
    updatedAt: normalizeIsoTimestamp(updatedAt, 'updatedAt'),
    lastChangedBy: normalizeActorSub(lastChangedBy),
    activityEvents: normalizeActivityEvents(activityEvents)
  };
}

export function createUpdatedWorkspaceRecord(record, { workspace, actor, now = new Date().toISOString() } = {}) {
  const currentRecord = createWorkspaceRecord(record);

  return createWorkspaceRecord({
    viewerSub: currentRecord.viewerSub,
    workspace,
    revision: currentRecord.revision + 1,
    createdAt: currentRecord.createdAt,
    updatedAt: now,
    lastChangedBy: normalizeActorSub(actor),
    activityEvents: currentRecord.activityEvents
  });
}

export function toWorkspaceRecordDocument(record) {
  const normalizedRecord = createWorkspaceRecord(record);

  return {
    _id: normalizedRecord.viewerSub,
    ...normalizedRecord
  };
}

export function fromWorkspaceRecordDocument(document) {
  if (!document || typeof document !== 'object') {
    return null;
  }

  return createWorkspaceRecord({
    viewerSub: document.viewerSub ?? document._id,
    workspace: document.workspace,
    revision: document.revision,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    lastChangedBy: document.lastChangedBy,
    activityEvents: document.activityEvents
  });
}

export function validateWorkspaceSnapshot(workspace) {
  if (!validateWorkspaceShape(workspace)) {
    throw new Error('Cannot save an invalid workspace.');
  }

  return workspace;
}

export function normalizeViewerSub(viewerSub) {
  const normalizedViewerSub = normalizeOptionalString(viewerSub);

  if (!normalizedViewerSub) {
    throw new Error('A verified viewer sub is required for workspace persistence.');
  }

  return normalizedViewerSub;
}

export function normalizeActorSub(actor) {
  if (actor == null) {
    return null;
  }

  if (typeof actor === 'string') {
    return normalizeOptionalString(actor) || null;
  }

  if (typeof actor === 'object') {
    return normalizeOptionalString(actor.id ?? actor.sub) || null;
  }

  return null;
}

function normalizeRevision(revision) {
  const normalizedRevision =
    typeof revision === 'number' && Number.isInteger(revision)
      ? revision
      : Number.parseInt(String(revision ?? ''), 10);

  if (!Number.isInteger(normalizedRevision) || normalizedRevision < 0) {
    throw new Error('Workspace record revision must be a non-negative integer.');
  }

  return normalizedRevision;
}

function normalizeIsoTimestamp(value, fieldName) {
  const normalizedValue = normalizeOptionalString(value);

  if (!normalizedValue) {
    throw new Error(`Workspace record ${fieldName} is required.`);
  }

  const timestamp = new Date(normalizedValue);

  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Workspace record ${fieldName} must be an ISO timestamp.`);
  }

  return timestamp.toISOString();
}

function normalizeActivityEvents(activityEvents) {
  if (!Array.isArray(activityEvents)) {
    throw new Error('Workspace record activityEvents must be an array.');
  }

  return structuredClone(activityEvents);
}

function normalizeOptionalString(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}
