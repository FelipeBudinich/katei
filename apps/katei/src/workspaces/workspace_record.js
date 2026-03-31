import { randomUUID } from 'node:crypto';
import {
  cloneWorkspace,
  createEmptyWorkspace
} from '../../public/js/domain/workspace_read_model.js';
import { validateWorkspaceShape } from '../../public/js/domain/workspace_validation.js';

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

export function createUpdatedWorkspaceRecord(
  record,
  {
    workspace,
    actor,
    now = new Date().toISOString(),
    activityType = 'workspace.saved',
    createActivityEventId = createWorkspaceActivityEventId
  } = {}
) {
  const currentRecord = createWorkspaceRecord(record);
  const nextRevision = currentRecord.revision + 1;

  return createWorkspaceRecord({
    viewerSub: currentRecord.viewerSub,
    workspace,
    revision: nextRevision,
    createdAt: currentRecord.createdAt,
    updatedAt: now,
    lastChangedBy: normalizeActorSub(actor),
    activityEvents: [
      ...currentRecord.activityEvents,
      createWorkspaceActivityEvent({
        id: createActivityEventId(),
        type: activityType,
        actor,
        createdAt: now,
        revision: nextRevision
      })
    ]
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

export function createWorkspaceActivityEvent({
  id = createWorkspaceActivityEventId(),
  type,
  actor = null,
  createdAt = new Date().toISOString(),
  revision
} = {}) {
  return {
    id: normalizeRequiredString(id, 'Workspace activity event id is required.'),
    type: normalizeRequiredString(type, 'Workspace activity event type is required.'),
    actor: normalizeActivityActor(actor),
    createdAt: normalizeIsoTimestamp(createdAt, 'activityEvent.createdAt'),
    revision: normalizeRevision(revision)
  };
}

export function createWorkspaceActivityEventId() {
  return `activity_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
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

  return activityEvents.map((activityEvent) => createWorkspaceActivityEvent(activityEvent));
}

function normalizeActivityActor(actor) {
  if (actor == null) {
    return null;
  }

  if (typeof actor === 'string') {
    const normalizedId = normalizeOptionalString(actor);

    return normalizedId ? { id: normalizedId } : null;
  }

  if (typeof actor === 'object') {
    const normalizedId = normalizeOptionalString(actor.id ?? actor.sub);

    if (!normalizedId) {
      return null;
    }

    const normalizedType = normalizeOptionalString(actor.type);

    return normalizedType
      ? {
          type: normalizedType,
          id: normalizedId
        }
      : {
          id: normalizedId
        };
  }

  return null;
}

function normalizeRequiredString(value, errorMessage) {
  const normalizedValue = normalizeOptionalString(value);

  if (!normalizedValue) {
    throw new Error(errorMessage);
  }

  return normalizedValue;
}

function normalizeOptionalString(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}
