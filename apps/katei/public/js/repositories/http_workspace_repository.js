import { migrateWorkspaceSnapshot } from '../domain/workspace_migrations.js';
import { validateWorkspaceShape } from '../domain/workspace_validation.js';
import { canonicalizeBoardRole } from '../domain/board_collaboration.js';
import { isInviteDebugEnabled, logInviteAcceptDebug, logInviteDebug } from '../lib/invite_debug.js';
import { postWorkspaceImport, readLocalV4Workspace } from '../lib/workspace_import.js';
import { WorkspaceRepository } from './workspace_repository.js';

export const WORKSPACE_CONFLICT_ERROR_MESSAGE = 'This workspace changed elsewhere. Refresh to continue.';

export class HttpWorkspaceRepository extends WorkspaceRepository {
  constructor({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    viewerSub,
    workspaceId = null,
    storage = globalThis.localStorage,
    document = globalThis.document
  } = {}) {
    super();
    this.fetchImpl = resolveFetch(fetchImpl);
    this.viewerSub = normalizeViewerSub(viewerSub);
    this.activeWorkspaceId = normalizeOptionalWorkspaceId(workspaceId);
    this.isHomeWorkspace = null;
    this.storage = storage ?? null;
    this.document = document ?? null;
    this.meta = null;
    this.pendingWorkspaceInvites = [];
    this.accessibleWorkspaces = [];
    this.revision = null;
    this.lastStateSource = null;
    this.lastRevisionWorkspaceId = null;
    this.hasConsumedBootstrap = false;
  }

  async loadWorkspace() {
    let payload = this.#consumeBootstrapPayload();

    if (!payload) {
      payload = await this.#requestWorkspace(this.#buildWorkspaceUrl('/api/workspace'), {
        method: 'GET'
      }, 'Unable to load workspace.');
    }

    if (payload.meta?.isPristine && this.isHomeWorkspace) {
      const localWorkspace = readLocalV4Workspace(this.storage, this.viewerSub);

      if (localWorkspace) {
        try {
          const importedPayload = await postWorkspaceImport({
            fetchImpl: this.fetchImpl,
            workspace: localWorkspace,
            workspaceId: this.activeWorkspaceId
          });
          this.#setState(importedPayload, { source: 'import' });
        } catch (error) {
          if (error?.status !== 409) {
            throw error;
          }
        }

        payload = await this.#requestWorkspace(this.#buildWorkspaceUrl('/api/workspace'), {
          method: 'GET'
        }, 'Unable to load workspace.');
      }
    }

    return payload.workspace;
  }

  getActiveWorkspaceId() {
    return this.activeWorkspaceId;
  }

  getPendingWorkspaceInvites() {
    return this.pendingWorkspaceInvites;
  }

  getAccessibleWorkspaces() {
    return this.accessibleWorkspaces;
  }

  getIsHomeWorkspace() {
    return this.isHomeWorkspace === true;
  }

  getMeta() {
    return this.meta;
  }

  getRevision() {
    return this.revision;
  }

  getLastStateSource() {
    return this.lastStateSource;
  }

  getLastRevisionWorkspaceId() {
    return this.lastRevisionWorkspaceId;
  }

  setActiveWorkspace(workspaceId) {
    this.activeWorkspaceId = normalizeOptionalWorkspaceId(workspaceId);
  }

  async saveWorkspace(workspace) {
    const normalizedWorkspace = normalizeWorkspaceSnapshot(workspace);

    if (!validateWorkspaceShape(normalizedWorkspace)) {
      throw new Error('Cannot save an invalid workspace.');
    }

    const payload = await this.#requestWorkspace(
      '/api/workspace',
      {
        method: 'PUT',
        body: JSON.stringify({
          workspace: normalizedWorkspace,
          workspaceId: this.activeWorkspaceId ?? normalizedWorkspace.workspaceId,
          expectedRevision: this.revision ?? 0
        })
      },
      'Unable to save workspace.'
    );

    return payload.workspace;
  }

  async resolveWorkspaceRevision(workspaceId = null) {
    const targetWorkspaceId = normalizeOptionalWorkspaceId(workspaceId) ?? this.activeWorkspaceId;

    if (
      Number.isInteger(this.revision)
      && (
        (!targetWorkspaceId && !this.lastRevisionWorkspaceId)
        || (targetWorkspaceId && this.lastRevisionWorkspaceId === targetWorkspaceId)
      )
    ) {
      return this.revision;
    }

    const payload = await this.#requestWorkspace(
      this.#buildWorkspaceUrl('/api/workspace', targetWorkspaceId),
      {
        method: 'GET'
      },
      'Unable to load workspace.',
      { updateState: false }
    );

    return Number.isInteger(payload?.meta?.revision) ? payload.meta.revision : 0;
  }

  async applyCommand(command, {
    workspaceId = null,
    expectedRevision = null
  } = {}) {
    const targetWorkspaceId = normalizeOptionalWorkspaceId(workspaceId) ?? this.activeWorkspaceId;
    const commandExpectedRevision = Number.isInteger(expectedRevision) ? expectedRevision : (this.revision ?? 0);

    return this.#requestWorkspace(
      '/api/workspace/commands',
      {
        method: 'POST',
        body: JSON.stringify({
          command,
          workspaceId: targetWorkspaceId,
          expectedRevision: commandExpectedRevision
        })
      },
      'Unable to apply workspace command.'
    );
  }

  async generateCardLocalization(
    {
      clientMutationId,
      boardId,
      cardId,
      targetLocale
    },
    {
      workspaceId = null,
      expectedRevision = null
    } = {}
  ) {
    const targetWorkspaceId = normalizeOptionalWorkspaceId(workspaceId) ?? this.activeWorkspaceId;
    const mutationExpectedRevision = Number.isInteger(expectedRevision) ? expectedRevision : (this.revision ?? 0);

    return this.#requestWorkspace(
      '/api/workspace/localizations/generate',
      {
        method: 'POST',
        body: JSON.stringify({
          clientMutationId,
          workspaceId: targetWorkspaceId,
          boardId,
          cardId,
          targetLocale,
          expectedRevision: mutationExpectedRevision
        })
      },
      'Unable to generate card localization.'
    );
  }

  async #requestWorkspace(url, options, fallbackMessage, { updateState = true } = {}) {
    const parsedRequestBody = parseRequestBody(options?.body);
    const inviteDecisionDebugFields = buildInviteAcceptRequestDebugFields({
      url,
      method: options?.method ?? 'GET',
      body: parsedRequestBody,
      activeWorkspaceId: this.activeWorkspaceId,
      cachedRevision: this.revision,
      cachedRevisionWorkspaceId: this.lastRevisionWorkspaceId,
      cachedRevisionSource: this.lastStateSource
    });

    if (inviteDecisionDebugFields) {
      logInviteAcceptDebug('client.repository.request', inviteDecisionDebugFields);
    }

    const debugHeaders = isInviteDebugEnabled() ? { 'X-Katei-Debug-Invites': '1' } : {};
    const response = await this.fetchImpl(url, {
      credentials: 'same-origin',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
        ...debugHeaders,
        ...(options?.headers ?? {})
      }
    });
    const data = await parseJsonResponse(response);

    logInviteDebug('client.invite.payload', buildRawPayloadDebugFields('api', data));

    if (inviteDecisionDebugFields) {
      logInviteAcceptDebug('client.repository.response', {
        ...inviteDecisionDebugFields,
        responseStatus: response.status,
        responseOk: response.ok,
        conflictBody: response.ok ? null : data
      });
    }

    if (!response.ok) {
      throw createWorkspaceApiError(response, data, fallbackMessage);
    }

    const workspace = normalizeWorkspaceSnapshot(data?.workspace);

    if (!validateActorFacingWorkspaceShape(workspace)) {
      throw new Error('Workspace API returned an invalid workspace.');
    }

    const payload = isPlainObject(data)
      ? {
          ...data,
          workspace
        }
      : { workspace };

    if (updateState) {
      this.#setState(payload, { source: 'api' });
    }

    return payload;
  }

  #consumeBootstrapPayload() {
    if (this.hasConsumedBootstrap) {
      return null;
    }

    this.hasConsumedBootstrap = true;

    if (!this.document || typeof this.document.getElementById !== 'function') {
      return null;
    }

    const bootstrapElement = this.document.getElementById('workspace-bootstrap');

    if (!bootstrapElement?.textContent) {
      return null;
    }

    try {
      const payload = JSON.parse(bootstrapElement.textContent);
      logInviteDebug('client.invite.payload', buildRawPayloadDebugFields('bootstrap', payload));
      const workspace = normalizeWorkspaceSnapshot(payload?.workspace);

      if (!validateActorFacingWorkspaceShape(workspace)) {
        return null;
      }

      const nextPayload = isPlainObject(payload)
        ? {
            ...payload,
            workspace
          }
        : { workspace };

      this.#setState(nextPayload, { source: 'bootstrap' });
      return nextPayload;
    } catch (error) {
      return null;
    }
  }

  #setState(payload, { source = 'unknown' } = {}) {
    this.#setMeta(payload?.meta ?? null);
    const workspace = isPlainObject(payload?.workspace) ? payload.workspace : null;
    const activeWorkspace = normalizeActiveWorkspace(payload?.activeWorkspace, payload?.workspace);
    this.pendingWorkspaceInvites = normalizePendingWorkspaceInvites(payload?.pendingWorkspaceInvites);
    this.accessibleWorkspaces = normalizeAccessibleWorkspaces(payload?.accessibleWorkspaces, {
      activeWorkspaceId: activeWorkspace?.workspaceId ?? workspace?.workspaceId ?? null
    });
    const rawPendingWorkspaceInvites = Array.isArray(payload?.pendingWorkspaceInvites) ? payload.pendingWorkspaceInvites : [];
    const rawPendingWorkspaceInviteIds = rawPendingWorkspaceInvites
      .map((invite) => normalizeOptionalWorkspaceId(invite?.inviteId))
      .filter(Boolean);
    const normalizedPendingWorkspaceInviteIds = this.pendingWorkspaceInvites.map((invite) => invite.inviteId);
    const boardOrder = Array.isArray(workspace?.boardOrder) ? workspace.boardOrder.filter((boardId) => typeof boardId === 'string') : [];
    const activeBoardId = normalizeOptionalWorkspaceId(workspace?.ui?.activeBoardId);

    this.activeWorkspaceId = activeWorkspace?.workspaceId ?? this.activeWorkspaceId ?? null;
    this.isHomeWorkspace =
      typeof activeWorkspace?.isHomeWorkspace === 'boolean' ? activeWorkspace.isHomeWorkspace : this.isHomeWorkspace;
    this.lastStateSource = source;
    this.lastRevisionWorkspaceId = normalizeOptionalWorkspaceId(activeWorkspace?.workspaceId)
      ?? normalizeOptionalWorkspaceId(workspace?.workspaceId)
      ?? this.lastRevisionWorkspaceId
      ?? null;

    logInviteDebug('client.invite.state', {
      source,
      rawPendingWorkspaceInviteIds,
      rawPendingWorkspaceInviteCount: rawPendingWorkspaceInvites.length,
      normalizedPendingWorkspaceInviteIds,
      normalizedPendingWorkspaceInviteCount: this.pendingWorkspaceInvites.length,
      droppedInviteCount: Math.max(rawPendingWorkspaceInvites.length - this.pendingWorkspaceInvites.length, 0),
      workspaceId: normalizeOptionalWorkspaceId(workspace?.workspaceId),
      boardOrder,
      activeBoardId,
      activeWorkspaceId: this.activeWorkspaceId,
      isHomeWorkspace: this.isHomeWorkspace,
      pendingWorkspaceInvitesCount: this.pendingWorkspaceInvites.length,
      pendingWorkspaceInviteIds: this.pendingWorkspaceInvites.map((invite) => invite.inviteId),
      accessibleWorkspaceIds: this.accessibleWorkspaces.map((summary) => summary.workspaceId),
      metaRevision: Number.isInteger(this.meta?.revision) ? this.meta.revision : null
    });
  }

  #setMeta(meta) {
    this.meta = meta ?? null;
    this.revision = Number.isInteger(meta?.revision) ? meta.revision : null;
  }

  #buildWorkspaceUrl(pathname, workspaceId = this.activeWorkspaceId) {
    const targetWorkspaceId = normalizeOptionalWorkspaceId(workspaceId);

    if (!targetWorkspaceId) {
      return pathname;
    }

    return `${pathname}?workspaceId=${encodeURIComponent(targetWorkspaceId)}`;
  }
}

function normalizeViewerSub(viewerSub) {
  if (typeof viewerSub !== 'string' || !viewerSub.trim()) {
    throw new Error('A verified viewer sub is required for workspace persistence.');
  }

  return viewerSub.trim();
}

function normalizeOptionalWorkspaceId(workspaceId) {
  return typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId.trim() : null;
}

function resolveFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required for workspace persistence.');
  }

  return fetchImpl;
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

function createWorkspaceApiError(response, data, fallbackMessage) {
  const message = response.status === 409 ? WORKSPACE_CONFLICT_ERROR_MESSAGE : (data?.error || fallbackMessage);
  const error = new Error(message);
  error.status = response.status;
  error.code = typeof data?.errorCode === 'string' ? data.errorCode : undefined;
  error.data = data;
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeWorkspaceSnapshot(workspace) {
  return migrateWorkspaceSnapshot(workspace);
}

function normalizeActiveWorkspace(activeWorkspace, workspace) {
  const workspaceId =
    normalizeOptionalWorkspaceId(activeWorkspace?.workspaceId) ??
    normalizeOptionalWorkspaceId(workspace?.workspaceId);

  if (!workspaceId) {
    return null;
  }

  return {
    workspaceId,
    isHomeWorkspace: typeof activeWorkspace?.isHomeWorkspace === 'boolean' ? activeWorkspace.isHomeWorkspace : false
  };
}

function validateActorFacingWorkspaceShape(workspace) {
  return validateWorkspaceShape(workspace) || isValidEmptyActorFacingWorkspace(workspace);
}

function isValidEmptyActorFacingWorkspace(workspace) {
  return Boolean(
    isPlainObject(workspace)
      && typeof workspace.workspaceId === 'string'
      && workspace.workspaceId.trim()
      && Number.isInteger(workspace.version)
      && Array.isArray(workspace.boardOrder)
      && workspace.boardOrder.length === 0
      && isPlainObject(workspace.boards)
      && Object.keys(workspace.boards).length === 0
      && isPlainObject(workspace.ui)
      && (workspace.ui.activeBoardId == null || normalizeOptionalWorkspaceId(workspace.ui.activeBoardId) == null)
  );
}

function normalizePendingWorkspaceInvites(invites) {
  if (!Array.isArray(invites)) {
    return [];
  }

  return invites
    .map((invite) => normalizePendingWorkspaceInvite(invite))
    .filter(Boolean);
}

function normalizePendingWorkspaceInvite(invite) {
  if (!isPlainObject(invite)) {
    return null;
  }

  const workspaceId = normalizeOptionalWorkspaceId(invite.workspaceId);
  const boardId = normalizeOptionalWorkspaceId(invite.boardId);
  const boardTitle = normalizeOptionalString(invite.boardTitle);
  const inviteId = normalizeOptionalWorkspaceId(invite.inviteId);
  const role = canonicalizeBoardRole(invite.role);
  const invitedAt = normalizeOptionalIsoString(invite.invitedAt);
  const invitedBy = normalizePendingWorkspaceInvitedBy(invite.invitedBy);

  if (!workspaceId || !boardId || !boardTitle || !inviteId || !role || !invitedAt || !invitedBy) {
    return null;
  }

  return {
    workspaceId,
    boardId,
    boardTitle,
    inviteId,
    role,
    invitedAt,
    invitedBy: {
      id: invitedBy.id,
      email: invitedBy.email ?? null,
      displayName: invitedBy.displayName ?? null
    }
  };
}

function normalizePendingWorkspaceInvitedBy(invitedBy) {
  if (!isPlainObject(invitedBy)) {
    return null;
  }

  const id = normalizeOptionalString(invitedBy.id);

  if (!id) {
    return null;
  }

  return {
    id,
    email: normalizeOptionalEmail(invitedBy.email),
    displayName: normalizeOptionalString(invitedBy.displayName ?? invitedBy.name) || null
  };
}

function normalizeAccessibleWorkspaces(accessibleWorkspaces, { activeWorkspaceId = null } = {}) {
  if (!Array.isArray(accessibleWorkspaces)) {
    return [];
  }

  const normalizedActiveWorkspaceId = normalizeOptionalWorkspaceId(activeWorkspaceId);
  const seenWorkspaceIds = new Set();

  return accessibleWorkspaces
    .map((summary) => normalizeAccessibleWorkspace(summary))
    .filter((summary) => {
      if (!summary || summary.workspaceId === normalizedActiveWorkspaceId || seenWorkspaceIds.has(summary.workspaceId)) {
        return false;
      }

      seenWorkspaceIds.add(summary.workspaceId);
      return true;
    });
}

function normalizeAccessibleWorkspace(summary) {
  if (!isPlainObject(summary)) {
    return null;
  }

  const workspaceId = normalizeOptionalWorkspaceId(summary.workspaceId);
  const boards = normalizeAccessibleWorkspaceBoards(summary.boards);

  if (!workspaceId || boards.length === 0) {
    return null;
  }

  return {
    workspaceId,
    isHomeWorkspace: summary.isHomeWorkspace === true,
    boards
  };
}

function normalizeAccessibleWorkspaceBoards(boards) {
  if (!Array.isArray(boards)) {
    return [];
  }

  const seenBoardIds = new Set();

  return boards
    .map((board) => normalizeAccessibleWorkspaceBoard(board))
    .filter((board) => {
      if (!board || seenBoardIds.has(board.boardId)) {
        return false;
      }

      seenBoardIds.add(board.boardId);
      return true;
    });
}

function normalizeAccessibleWorkspaceBoard(board) {
  if (!isPlainObject(board)) {
    return null;
  }

  const boardId = normalizeOptionalWorkspaceId(board.boardId);
  const boardTitle = normalizeOptionalString(board.boardTitle);
  const role = canonicalizeBoardRole(board.role);

  if (!boardId || !boardTitle || !role) {
    return null;
  }

  return {
    boardId,
    boardTitle,
    role
  };
}

function normalizeOptionalIsoString(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const parsedValue = new Date(value);
  return Number.isNaN(parsedValue.getTime()) ? null : parsedValue.toISOString();
}

function buildRawPayloadDebugFields(source, payload) {
  const workspace = isPlainObject(payload?.workspace) ? payload.workspace : null;
  const rawPendingWorkspaceInvites = Array.isArray(payload?.pendingWorkspaceInvites) ? payload.pendingWorkspaceInvites : [];

  return {
    source,
    rawPendingWorkspaceInviteIds: rawPendingWorkspaceInvites
      .map((invite) => normalizeOptionalWorkspaceId(invite?.inviteId))
      .filter(Boolean),
    rawPendingWorkspaceInviteCount: rawPendingWorkspaceInvites.length,
    rawWorkspaceId: normalizeOptionalWorkspaceId(workspace?.workspaceId),
    rawBoardOrder: Array.isArray(workspace?.boardOrder) ? workspace.boardOrder.filter((boardId) => typeof boardId === 'string') : [],
    rawActiveBoardId: normalizeOptionalWorkspaceId(workspace?.ui?.activeBoardId),
    rawProjectedBoardIds: collectBoardIds(workspace),
    rawProjectedBoardInviteIdsByBoard: collectBoardInviteIdsByBoard(workspace)
  };
}

function collectBoardIds(workspace) {
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
    if (seenBoardIds.has(boardId)) {
      continue;
    }

    seenBoardIds.add(boardId);
    boardIds.push(boardId);
  }

  return boardIds;
}

function collectBoardInviteIdsByBoard(workspace) {
  return Object.fromEntries(
    collectBoardIds(workspace).map((boardId) => {
      const rawInvites = Array.isArray(workspace?.boards?.[boardId]?.collaboration?.invites)
        ? workspace.boards[boardId].collaboration.invites
        : [];

      return [
        boardId,
        rawInvites
          .map((invite) => normalizeOptionalWorkspaceId(invite?.id))
          .filter(Boolean)
      ];
    })
  );
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalEmail(value) {
  const normalizedValue = normalizeOptionalString(value).toLowerCase();
  return normalizedValue || null;
}

function parseRequestBody(body) {
  if (typeof body !== 'string' || !body.trim()) {
    return null;
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    return null;
  }
}

function buildInviteAcceptRequestDebugFields({
  url,
  method = 'GET',
  body = null,
  activeWorkspaceId = null,
  cachedRevision = null,
  cachedRevisionWorkspaceId = null,
  cachedRevisionSource = null
} = {}) {
  const commandType = normalizeOptionalString(body?.command?.type);

  if (commandType !== 'board.invite.accept' && commandType !== 'board.invite.decline') {
    return null;
  }

  return {
    requestMethod: method,
    requestUrl: url,
    requestWorkspaceId: normalizeOptionalWorkspaceId(body?.workspaceId),
    requestBoardId: normalizeOptionalWorkspaceId(body?.command?.payload?.boardId),
    requestInviteId: normalizeOptionalWorkspaceId(body?.command?.payload?.inviteId),
    requestExpectedRevision: Number.isInteger(body?.expectedRevision) ? body.expectedRevision : null,
    commandType,
    activeWorkspaceId,
    cachedRevision: Number.isInteger(cachedRevision) ? cachedRevision : null,
    cachedRevisionWorkspaceId: normalizeOptionalWorkspaceId(cachedRevisionWorkspaceId),
    cachedRevisionSource: normalizeOptionalString(cachedRevisionSource) || null
  };
}
