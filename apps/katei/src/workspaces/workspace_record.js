import { randomUUID } from 'node:crypto';
import { stripLegacyColumnAliasesFromWorkspace } from '../../public/js/domain/board_workflow.js';
import { stripLegacyCardContentAliasesFromWorkspace } from '../../public/js/domain/card_localization.js';
import {
  cloneWorkspace,
  createEmptyWorkspace
} from '../../public/js/domain/workspace_read_model.js';
import { migrateWorkspaceSnapshot } from '../../public/js/domain/workspace_migrations.js';
import { validateWorkspaceShape } from '../../public/js/domain/workspace_validation.js';

export const WORKSPACE_RECORD_COLLECTION_NAME = 'workspace_records';
export const DEFAULT_MAX_ACTIVITY_EVENTS = 100;
export const DEFAULT_MAX_COMMAND_RECEIPTS = 100;
export const HOME_WORKSPACE_ID_PREFIX = 'workspace_home_';

export function createInitialWorkspaceRecord(
  viewerSub,
  {
    workspaceId = createHomeWorkspaceId(viewerSub),
    title = undefined,
    creator = null,
    now = new Date().toISOString()
  } = {}
) {
  const normalizedViewerSub = normalizeViewerSub(viewerSub);
  const normalizedIsHomeWorkspace = normalizeHomeWorkspaceFlag({
    workspaceId,
    viewerSub: normalizedViewerSub
  });
  const normalizedWorkspaceId = normalizeRecordWorkspaceId({
    workspaceId,
    viewerSub: normalizedViewerSub,
    isHomeWorkspace: normalizedIsHomeWorkspace
  });

  return createWorkspaceRecord({
    workspaceId: normalizedWorkspaceId,
    viewerSub: normalizedViewerSub,
    workspace: createEmptyWorkspace({
      workspaceId: normalizedWorkspaceId,
      title,
      creator: normalizeInitialWorkspaceCreator({
        viewerSub: normalizedViewerSub,
        creator
      })
    }),
    isHomeWorkspace: normalizedIsHomeWorkspace,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    lastChangedBy: null,
    activityEvents: [],
    commandReceipts: []
  });
}

export function createWorkspaceRecord({
  workspaceId,
  viewerSub,
  workspace = createEmptyWorkspace({
    workspaceId:
      workspaceId ??
      (typeof viewerSub === 'string' && viewerSub.trim() ? createHomeWorkspaceId(viewerSub) : undefined),
    creator:
      typeof viewerSub === 'string' && viewerSub.trim()
        ? {
            type: 'human',
            id: viewerSub.trim()
          }
        : undefined
  }),
  isHomeWorkspace = false,
  documentId = null,
  revision = 0,
  createdAt = new Date().toISOString(),
  updatedAt = createdAt,
  lastChangedBy = null,
  activityEvents = [],
  commandReceipts = []
} = {}) {
  const normalizedViewerSub = normalizeViewerSub(viewerSub);
  const normalizedIsHomeWorkspace = normalizeHomeWorkspaceFlag({
    workspaceId: workspaceId ?? workspace?.workspaceId,
    viewerSub: normalizedViewerSub,
    isHomeWorkspace,
    documentId
  });
  const normalizedWorkspaceId = normalizeRecordWorkspaceId({
    workspaceId: workspaceId ?? workspace?.workspaceId,
    viewerSub: normalizedViewerSub,
    isHomeWorkspace: normalizedIsHomeWorkspace,
    documentId
  });
  const normalizedDocumentId = normalizeOptionalString(documentId) || normalizedWorkspaceId;

  return {
    workspaceId: normalizedWorkspaceId,
    viewerSub: normalizedViewerSub,
    isHomeWorkspace: normalizedIsHomeWorkspace,
    documentId: normalizedDocumentId,
    workspace: cloneWorkspace(
      validateWorkspaceSnapshot(workspace, {
        workspaceId: normalizedWorkspaceId,
        ownerSub: normalizedViewerSub,
        allowEmptyWorkspace: true
      })
    ),
    revision: normalizeRevision(revision),
    createdAt: normalizeIsoTimestamp(createdAt, 'createdAt'),
    updatedAt: normalizeIsoTimestamp(updatedAt, 'updatedAt'),
    lastChangedBy: normalizeActorSub(lastChangedBy),
    activityEvents: normalizeActivityEvents(activityEvents),
    commandReceipts: normalizeCommandReceipts(commandReceipts)
  };
}

export function createUpdatedWorkspaceRecord(
  record,
  {
    workspace,
    actor,
    now = new Date().toISOString(),
    activityType = 'workspace.saved',
    activityEntity = null,
    activityDetails = null,
    createActivityEventId = createWorkspaceActivityEventId
  } = {}
) {
  const currentRecord = createWorkspaceRecord(record);
  const nextRevision = currentRecord.revision + 1;

  return createWorkspaceRecord({
    workspaceId: currentRecord.workspaceId,
    viewerSub: currentRecord.viewerSub,
    isHomeWorkspace: currentRecord.isHomeWorkspace,
    documentId: currentRecord.documentId,
    workspace,
    revision: nextRevision,
    createdAt: currentRecord.createdAt,
    updatedAt: now,
    lastChangedBy: normalizeActorSub(actor),
    activityEvents: appendActivityEvent(
      currentRecord,
      createActivityEvent({
        id: createActivityEventId(),
        type: activityType,
        actor,
        createdAt: now,
        revision: nextRevision,
        entity: activityEntity,
        details: activityDetails
      })
    ),
    commandReceipts: currentRecord.commandReceipts
  });
}

export function createCommandAppliedWorkspaceRecord(
  record,
  {
    workspace,
    actor,
    now = new Date().toISOString(),
    activityEvent = null,
    commandReceipt = null
  } = {}
) {
  const currentRecord = createWorkspaceRecord(record);
  const nextRevision = currentRecord.revision + 1;

  return createWorkspaceRecord({
    workspaceId: currentRecord.workspaceId,
    viewerSub: currentRecord.viewerSub,
    isHomeWorkspace: currentRecord.isHomeWorkspace,
    documentId: currentRecord.documentId,
    workspace,
    revision: nextRevision,
    createdAt: currentRecord.createdAt,
    updatedAt: now,
    lastChangedBy: normalizeActorSub(actor),
    activityEvents: activityEvent ? appendActivityEvent(currentRecord, activityEvent) : currentRecord.activityEvents,
    commandReceipts: commandReceipt ? appendCommandReceipt(currentRecord, commandReceipt) : currentRecord.commandReceipts
  });
}

export function toWorkspaceRecordDocument(record) {
  const normalizedRecord = createWorkspaceRecord(record);
  const { documentId: _documentId, ...persistedRecord } = normalizedRecord;

  return {
    _id: persistedRecord.workspaceId,
    ...persistedRecord
  };
}

export function fromWorkspaceRecordDocument(document) {
  if (!document || typeof document !== 'object') {
    return null;
  }

  const legacyViewerSub =
    document.viewerSub
    ?? document.ownerSub
    ?? resolveWorkspaceOwnerSub(document.workspace)
    ?? document._id;
  const inferredIsHomeWorkspace = normalizeHomeWorkspaceFlag({
    workspaceId: document.workspaceId,
    viewerSub: legacyViewerSub,
    isHomeWorkspace: document.isHomeWorkspace,
    documentId: document._id
  });
  const normalizedWorkspaceId = normalizeRecordWorkspaceId({
    workspaceId: document.workspaceId,
    viewerSub: legacyViewerSub,
    isHomeWorkspace: inferredIsHomeWorkspace,
    documentId: document._id
  });

  return createWorkspaceRecord({
    workspaceId: normalizedWorkspaceId,
    viewerSub: legacyViewerSub,
    workspace: document.workspace,
    isHomeWorkspace: inferredIsHomeWorkspace,
    documentId: document._id,
    revision: document.revision,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    lastChangedBy: document.lastChangedBy,
    activityEvents: document.activityEvents,
    commandReceipts: document.commandReceipts
  });
}

export function validateWorkspaceSnapshot(
  workspace,
  { workspaceId = null, ownerSub = null, ownerActor = null, allowEmptyWorkspace = false } = {}
) {
  const normalizedOwnerSub = normalizeOptionalString(ownerSub) || null;
  const migratedWorkspace = migrateWorkspaceSnapshot(workspace, {
    workspaceId,
    ownerSub: normalizedOwnerSub,
    ownerActor: ownerActor ?? createHumanActor(normalizedOwnerSub)
  });
  const normalizedWorkspace = stripLegacyCardContentAliasesFromWorkspace(
    stripLegacyColumnAliasesFromWorkspace(migratedWorkspace)
  );
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId ?? normalizedWorkspace?.workspaceId);

  normalizedWorkspace.workspaceId = normalizedWorkspaceId;

  if (!validateWorkspaceShape(normalizedWorkspace) && !(allowEmptyWorkspace && isPersistableEmptyWorkspace(normalizedWorkspace))) {
    throw new Error('Cannot save an invalid workspace.');
  }

  return normalizedWorkspace;
}

function isPersistableEmptyWorkspace(workspace) {
  return Boolean(
    workspace
      && typeof workspace === 'object'
      && workspace.version != null
      && normalizeOptionalString(workspace.workspaceId)
      && (workspace.title == null || normalizeOptionalString(workspace.title))
      && Array.isArray(workspace.boardOrder)
      && workspace.boardOrder.length === 0
      && workspace.boards
      && typeof workspace.boards === 'object'
      && !Array.isArray(workspace.boards)
      && Object.keys(workspace.boards).length === 0
      && workspace.ui
      && typeof workspace.ui === 'object'
      && !Array.isArray(workspace.ui)
      && (workspace.ui.activeBoardId == null || !normalizeOptionalString(workspace.ui.activeBoardId))
  );
}

export function createWorkspaceActivityEvent({
  id = createWorkspaceActivityEventId(),
  type,
  actor = null,
  createdAt = new Date().toISOString(),
  revision,
  entity = null,
  details = null
} = {}) {
  return {
    id: normalizeRequiredString(id, 'Workspace activity event id is required.'),
    type: normalizeRequiredString(type, 'Workspace activity event type is required.'),
    actor: normalizeActivityActor(actor),
    createdAt: normalizeIsoTimestamp(createdAt, 'activityEvent.createdAt'),
    revision: normalizeRevision(revision),
    entity: normalizeActivityEntity(entity),
    details: normalizeActivityDetails(details)
  };
}

export const createActivityEvent = createWorkspaceActivityEvent;

export function createWorkspaceActivityEventId() {
  return `activity_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

export function createWorkspaceId() {
  return `workspace_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

export function appendActivityEvent(record, event, maxEvents = DEFAULT_MAX_ACTIVITY_EVENTS) {
  const currentRecord = createWorkspaceRecord(record);
  const normalizedEvent = createActivityEvent(event);
  const normalizedMaxEvents = normalizeBoundedRecentSetSize(maxEvents, 'maxEvents');

  return [...currentRecord.activityEvents, normalizedEvent].slice(-normalizedMaxEvents);
}

export function createCommandReceipt({
  clientMutationId,
  commandType,
  actorId = null,
  revision,
  appliedAt,
  result
} = {}) {
  return {
    clientMutationId: normalizeRequiredString(
      clientMutationId,
      'Workspace command receipt clientMutationId is required.'
    ),
    commandType: normalizeRequiredString(commandType, 'Workspace command receipt commandType is required.'),
    actorId: normalizeOptionalString(actorId) || null,
    revision: normalizeRevision(revision),
    appliedAt: normalizeIsoTimestamp(appliedAt, 'commandReceipt.appliedAt'),
    result: normalizeCommandReceiptResult(result)
  };
}

export function findCommandReceipt(record, clientMutationId) {
  const currentRecord = createWorkspaceRecord(record);
  const normalizedClientMutationId = normalizeRequiredString(
    clientMutationId,
    'Workspace command receipt clientMutationId is required.'
  );

  return (
    currentRecord.commandReceipts.find((receipt) => receipt.clientMutationId === normalizedClientMutationId) ?? null
  );
}

export function appendCommandReceipt(record, receipt, maxReceipts = DEFAULT_MAX_COMMAND_RECEIPTS) {
  const currentRecord = createWorkspaceRecord(record);
  const normalizedReceipt = createCommandReceipt(receipt);
  const normalizedMaxReceipts = normalizeBoundedRecentSetSize(maxReceipts, 'maxReceipts');
  const receiptsWithoutDuplicate = currentRecord.commandReceipts.filter(
    (currentReceipt) => currentReceipt.clientMutationId !== normalizedReceipt.clientMutationId
  );

  return [...receiptsWithoutDuplicate, normalizedReceipt].slice(-normalizedMaxReceipts);
}

export function normalizeViewerSub(viewerSub) {
  const normalizedViewerSub = normalizeOptionalString(viewerSub);

  if (!normalizedViewerSub) {
    throw new Error('A verified viewer sub is required for workspace persistence.');
  }

  return normalizedViewerSub;
}

export function createHomeWorkspaceId(viewerSub) {
  return `${HOME_WORKSPACE_ID_PREFIX}${normalizeViewerSub(viewerSub)}`;
}

export function parseHomeWorkspaceViewerSub(workspaceId) {
  const normalizedWorkspaceId = normalizeOptionalString(workspaceId);

  if (!normalizedWorkspaceId.startsWith(HOME_WORKSPACE_ID_PREFIX)) {
    return null;
  }

  return normalizedWorkspaceId.slice(HOME_WORKSPACE_ID_PREFIX.length) || null;
}

export function normalizeWorkspaceId(workspaceId) {
  const normalizedWorkspaceId = normalizeOptionalString(workspaceId);

  if (!normalizedWorkspaceId) {
    throw new Error('A workspaceId is required for workspace persistence.');
  }

  return normalizedWorkspaceId;
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

function normalizeHomeWorkspaceFlag({ workspaceId, viewerSub, isHomeWorkspace, documentId = null }) {
  if (typeof isHomeWorkspace === 'boolean') {
    return isHomeWorkspace;
  }

  const normalizedViewerSub = normalizeOptionalString(viewerSub);

  if (!normalizedViewerSub) {
    return false;
  }

  const normalizedWorkspaceId = normalizeOptionalString(workspaceId);
  const normalizedDocumentId = normalizeOptionalString(documentId);
  const canonicalHomeWorkspaceId = createHomeWorkspaceId(normalizedViewerSub);

  return (
    normalizedWorkspaceId === canonicalHomeWorkspaceId
    || normalizedWorkspaceId === normalizedViewerSub
    || normalizedDocumentId === canonicalHomeWorkspaceId
    || normalizedDocumentId === normalizedViewerSub
  );
}

function normalizeRecordWorkspaceId({ workspaceId, viewerSub, isHomeWorkspace, documentId = null }) {
  const normalizedViewerSub = normalizeOptionalString(viewerSub);
  const normalizedWorkspaceId = normalizeOptionalString(workspaceId);
  const normalizedDocumentId = normalizeOptionalString(documentId);

  if (normalizedViewerSub && isHomeWorkspace) {
    return createHomeWorkspaceId(normalizedViewerSub);
  }

  return normalizeWorkspaceId(
    normalizedWorkspaceId
    || normalizedDocumentId
    || (normalizedViewerSub ? createHomeWorkspaceId(normalizedViewerSub) : '')
  );
}

function resolveWorkspaceOwnerSub(workspace) {
  if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)) {
    return null;
  }

  const owner =
    workspace.ownership?.owner
    ?? workspace.ownership?.actor
    ?? workspace.owner
    ?? workspace.ownerActor
    ?? null;

  if (owner && typeof owner === 'object' && !Array.isArray(owner)) {
    const ownerType = normalizeOptionalString(owner.type).toLowerCase();
    const ownerId = normalizeOptionalString(owner.id ?? owner.sub);

    if (ownerType === 'human' && ownerId) {
      return ownerId;
    }
  }

  return normalizeOptionalString(workspace.ownership?.ownerSub ?? workspace.ownerSub) || null;
}

function createHumanActor(actorId) {
  const normalizedActorId = normalizeOptionalString(actorId);

  return normalizedActorId
    ? {
        type: 'human',
        id: normalizedActorId
      }
    : null;
}

function normalizeInitialWorkspaceCreator({ viewerSub, creator = null } = {}) {
  const normalizedViewerSub = normalizeOptionalString(viewerSub);

  if (!normalizedViewerSub) {
    return createHumanActor(null);
  }

  const normalizedEmail = normalizeOptionalString(creator?.email);
  const normalizedDisplayName = normalizeOptionalString(creator?.displayName ?? creator?.name);

  return {
    type: 'human',
    id: normalizedViewerSub,
    ...(normalizedEmail ? { email: normalizedEmail } : {}),
    ...(normalizedDisplayName ? { displayName: normalizedDisplayName } : {})
  };
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

  return activityEvents.map((activityEvent) => createActivityEvent(activityEvent));
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

function normalizeActivityEntity(entity) {
  if (entity == null) {
    return null;
  }

  if (typeof entity !== 'object' || Array.isArray(entity)) {
    throw new Error('Workspace activity event entity must be an object or null.');
  }

  const kind = normalizeRequiredString(entity.kind, 'Workspace activity event entity.kind is required.');

  if (!['workspace', 'board', 'card'].includes(kind)) {
    throw new Error(`Unsupported workspace activity event entity.kind: ${kind}`);
  }

  return {
    kind,
    boardId: normalizeOptionalString(entity.boardId) || null,
    cardId: normalizeOptionalString(entity.cardId) || null
  };
}

function normalizeActivityDetails(details) {
  if (details == null) {
    return null;
  }

  if (typeof details !== 'object' || Array.isArray(details)) {
    throw new Error('Workspace activity event details must be an object or null.');
  }

  return structuredClone(details);
}

function normalizeCommandReceipts(commandReceipts) {
  if (!Array.isArray(commandReceipts)) {
    throw new Error('Workspace record commandReceipts must be an array.');
  }

  return commandReceipts.map((receipt) => createCommandReceipt(receipt));
}

function normalizeCommandReceiptResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Workspace command receipt result must be an object.');
  }

  return structuredClone(result);
}

function normalizeBoundedRecentSetSize(value, fieldName) {
  const normalizedValue =
    typeof value === 'number' && Number.isInteger(value) ? value : Number.parseInt(String(value ?? ''), 10);

  if (!Number.isInteger(normalizedValue) || normalizedValue < 1) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return normalizedValue;
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
