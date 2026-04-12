import { logInviteAcceptDebug } from '../lib/invite_debug.js';

const WORKSPACE_TITLE_SET_COMMAND_TYPE = 'workspace.title.set';

export class WorkspaceService {
  constructor(repository) {
    this.repository = repository;
  }

  async load() {
    return this.repository.loadWorkspace();
  }

  getActiveWorkspaceId() {
    if (typeof this.repository.getActiveWorkspaceId === 'function') {
      return this.repository.getActiveWorkspaceId();
    }

    return this.repository.activeWorkspaceId ?? null;
  }

  getPendingWorkspaceInvites() {
    if (typeof this.repository.getPendingWorkspaceInvites === 'function') {
      return this.repository.getPendingWorkspaceInvites();
    }

    return Array.isArray(this.repository.pendingWorkspaceInvites) ? this.repository.pendingWorkspaceInvites : [];
  }

  getAccessibleWorkspaces() {
    if (typeof this.repository.getAccessibleWorkspaces === 'function') {
      return this.repository.getAccessibleWorkspaces();
    }

    return Array.isArray(this.repository.accessibleWorkspaces) ? this.repository.accessibleWorkspaces : [];
  }

  getIsHomeWorkspace() {
    if (typeof this.repository.getIsHomeWorkspace === 'function') {
      return this.repository.getIsHomeWorkspace();
    }

    return this.repository.isHomeWorkspace === true;
  }

  getDebugContext() {
    const meta =
      typeof this.repository.getMeta === 'function'
        ? this.repository.getMeta()
        : this.repository.meta ?? null;
    const cachedRevision =
      typeof this.repository.getRevision === 'function'
        ? this.repository.getRevision()
        : (Number.isInteger(this.repository.revision) ? this.repository.revision : null);
    const revisionWorkspaceId =
      typeof this.repository.getLastRevisionWorkspaceId === 'function'
        ? this.repository.getLastRevisionWorkspaceId()
        : this.repository.lastRevisionWorkspaceId ?? null;
    const revisionSource =
      typeof this.repository.getLastStateSource === 'function'
        ? this.repository.getLastStateSource()
        : this.repository.lastStateSource ?? null;

    return {
      activeWorkspaceId: this.getActiveWorkspaceId(),
      cachedRevision,
      revisionWorkspaceId,
      revisionSource,
      meta
    };
  }

  setActiveWorkspace(workspaceId) {
    if (typeof this.repository.setActiveWorkspace === 'function') {
      this.repository.setActiveWorkspace(workspaceId);
    } else {
      this.repository.activeWorkspaceId = workspaceId ?? null;
    }
  }

  async switchWorkspace(workspaceId) {
    this.setActiveWorkspace(workspaceId);
    return this.load();
  }

  async setWorkspaceTitle(workspaceId, title, expectedRevision = null) {
    const targetWorkspaceId = normalizeOptionalWorkspaceId(workspaceId) ?? this.getActiveWorkspaceId();
    const resolvedExpectedRevision =
      Number.isInteger(expectedRevision) ? expectedRevision : await this.#resolveWorkspaceRevision(targetWorkspaceId);
    const request = {
      clientMutationId: createClientMutationId(),
      title
    };
    const response =
      typeof this.repository.setWorkspaceTitle === 'function'
        ? await this.repository.setWorkspaceTitle(request, {
            workspaceId: targetWorkspaceId,
            expectedRevision: resolvedExpectedRevision
          })
        : await this.repository.applyCommand({
            clientMutationId: request.clientMutationId,
            type: WORKSPACE_TITLE_SET_COMMAND_TYPE,
            payload: {
              title
            }
          }, {
            workspaceId: targetWorkspaceId,
            expectedRevision: resolvedExpectedRevision
          });

    return createWorkspaceTitleMutationResult(response);
  }

  async createWorkspace(input = {}) {
    if (typeof this.repository.createWorkspace !== 'function') {
      throw new Error('Workspace creation is not available for this repository.');
    }

    return this.repository.createWorkspace({
      title: input?.title
    });
  }

  async createBoard(input) {
    return this.#applyCommand('board.create', {
      title: input?.title,
      ...buildBoardSchemaPayload(input),
      ...buildBoardLocalizationPayload(input)
    });
  }

  async renameBoard(boardId, title) {
    return this.#applyCommand('board.rename', {
      boardId,
      title
    });
  }

  async updateBoard(boardId, input) {
    return this.#applyCommand('board.update', {
      boardId,
      title: input?.title,
      ...buildBoardSchemaPayload(input),
      ...buildBoardLocalizationPayload(input),
      ...buildBoardAiPayload(input)
    });
  }

  async deleteBoard(boardId) {
    return this.#applyCommand('board.delete', {
      boardId
    });
  }

  async setActiveBoard(boardId) {
    return this.#applyCommand('ui.activeBoard.set', {
      boardId
    });
  }

  async resetBoard(boardId) {
    return this.#applyCommand('board.reset', {
      boardId
    });
  }

  async inviteBoardMember(boardId, email, role) {
    return this.#applyCommand('board.invite.create', {
      boardId,
      email,
      role
    });
  }

  async revokeBoardInvite(boardId, inviteId) {
    return this.#applyCommand('board.invite.revoke', {
      boardId,
      inviteId
    });
  }

  async acceptBoardInvite(boardId, inviteId, workspaceId = null) {
    return this.#applyInviteDecisionCommand('board.invite.accept', {
      boardId,
      inviteId
    }, workspaceId);
  }

  async declineBoardInvite(boardId, inviteId, workspaceId = null) {
    return this.#applyInviteDecisionCommand('board.invite.decline', {
      boardId,
      inviteId
    }, workspaceId);
  }

  async setBoardMemberRole(boardId, actor, role) {
    return this.#applyCommand('board.member.role.set', {
      boardId,
      targetActor: actor,
      role
    });
  }

  async setBoardSelfRole(boardId, role, {
    workspaceId = null,
    expectedRevision = null
  } = {}) {
    return this.#applyCommand('board.self.role.set', {
      boardId,
      role
    }, {
      workspaceId,
      expectedRevision
    });
  }

  async removeBoardMember(boardId, actor) {
    return this.#applyCommand('board.member.remove', {
      boardId,
      targetActor: actor
    });
  }

  async createCard(boardId, input) {
    return this.#applyCommand('card.create', {
      boardId,
      stageId: input?.stageId,
      title: input?.title,
      detailsMarkdown: input?.detailsMarkdown,
      priority: input?.priority,
      requiresReview: input?.requiresReview === true
    });
  }

  async updateCard(boardId, cardId, updates) {
    return this.#applyCommand('card.update', {
      boardId,
      cardId,
      ...updates
    });
  }

  async upsertCardLocale(boardId, cardId, locale, input) {
    return this.#applyCommand('card.locale.upsert', {
      boardId,
      cardId,
      locale,
      title: input?.title,
      detailsMarkdown: input?.detailsMarkdown
    });
  }

  async discardCardLocale(boardId, cardId, locale) {
    return this.#applyCommand('card.locale.discard', {
      boardId,
      cardId,
      locale
    });
  }

  async generateCardLocalization(boardId, cardId, targetLocale) {
    const targetWorkspaceId = this.getActiveWorkspaceId();
    const expectedRevision = await this.#resolveWorkspaceRevision(targetWorkspaceId);
    const response = await this.repository.generateCardLocalization({
      clientMutationId: createClientMutationId(),
      boardId,
      cardId,
      targetLocale
    }, {
      workspaceId: targetWorkspaceId,
      expectedRevision
    });

    return response?.workspace ?? response;
  }

  async runStagePrompt(boardId, cardId) {
    const targetWorkspaceId = this.getActiveWorkspaceId();
    const expectedRevision = await this.#resolveWorkspaceRevision(targetWorkspaceId);
    const response = await this.repository.runStagePrompt({
      clientMutationId: createClientMutationId(),
      boardId,
      cardId
    }, {
      workspaceId: targetWorkspaceId,
      expectedRevision
    });

    return response?.workspace ?? response;
  }

  async requestCardLocale(boardId, cardId, locale) {
    return this.#applyCommand('card.locale.request', {
      boardId,
      cardId,
      locale
    });
  }

  async clearCardLocaleRequest(boardId, cardId, locale) {
    return this.#applyCommand('card.locale.request.clear', {
      boardId,
      cardId,
      locale
    });
  }

  async requestCardLocaleReview(boardId, cardId, locale) {
    return this.#applyCommand('card.locale.review.request', {
      boardId,
      cardId,
      locale
    });
  }

  async verifyCardLocaleReview(boardId, cardId, locale) {
    return this.#applyCommand('card.locale.review.verify', {
      boardId,
      cardId,
      locale
    });
  }

  async deleteCard(boardId, cardId) {
    return this.#applyCommand('card.delete', {
      boardId,
      cardId
    });
  }

  async approveCardReview(boardId, cardId) {
    return this.#applyCommand('card.review.approve', {
      boardId,
      cardId
    });
  }

  async rejectCardReview(boardId, cardId) {
    return this.#applyCommand('card.review.reject', {
      boardId,
      cardId
    });
  }

  async moveCard(boardId, cardId, sourceColumnId, targetColumnId) {
    return this.#applyCommand('card.move', {
      boardId,
      cardId,
      sourceColumnId,
      targetColumnId
    });
  }

  async #applyInviteDecisionCommand(type, payload, workspaceId) {
    const targetWorkspaceId = normalizeOptionalWorkspaceId(workspaceId) ?? this.getActiveWorkspaceId();
    const expectedRevision = await this.#resolveWorkspaceRevision(targetWorkspaceId);

    return this.#applyCommand(type, payload, {
      workspaceId: targetWorkspaceId,
      expectedRevision
    });
  }

  async #resolveWorkspaceRevision(workspaceId) {
    const targetWorkspaceId = normalizeOptionalWorkspaceId(workspaceId);
    const debugContext = this.getDebugContext();
    const cachedRevisionMatchesTargetWorkspace =
      Number.isInteger(debugContext.cachedRevision)
      && (
        (!targetWorkspaceId && !debugContext.revisionWorkspaceId)
        || (targetWorkspaceId && debugContext.revisionWorkspaceId === targetWorkspaceId)
      );

    if (cachedRevisionMatchesTargetWorkspace) {
      return debugContext.cachedRevision;
    }

    if (typeof this.repository.resolveWorkspaceRevision === 'function') {
      const resolvedRevision = await this.repository.resolveWorkspaceRevision(targetWorkspaceId);

      if (Number.isInteger(resolvedRevision)) {
        return resolvedRevision;
      }
    }

    if (
      targetWorkspaceId
      && debugContext.revisionWorkspaceId
      && debugContext.revisionWorkspaceId !== targetWorkspaceId
    ) {
      throw new Error('Unable to resolve the target workspace revision for this invite decision.');
    }

    return Number.isInteger(debugContext.cachedRevision) ? debugContext.cachedRevision : 0;
  }

  async #applyCommand(type, payload, {
    workspaceId = null,
    expectedRevision = null
  } = {}) {
    const targetWorkspaceId = normalizeOptionalWorkspaceId(workspaceId) ?? this.getActiveWorkspaceId();

    if (isInviteDecisionType(type)) {
      const debugContext = this.getDebugContext();
      logInviteAcceptDebug('client.service.applyCommand', {
        commandType: type,
        targetWorkspaceId,
        commandPayload: payload,
        expectedRevision: Number.isInteger(expectedRevision) ? expectedRevision : debugContext.cachedRevision,
        cachedWorkspaceId: debugContext.revisionWorkspaceId,
        cachedRevision: debugContext.cachedRevision,
        cachedRevisionSource: debugContext.revisionSource,
        cachedMetaRevision: Number.isInteger(debugContext.meta?.revision) ? debugContext.meta.revision : null
      });
    }

    const response = await this.repository.applyCommand({
      clientMutationId: createClientMutationId(),
      type,
      payload
    }, {
      workspaceId: targetWorkspaceId,
      expectedRevision
    });

    return response?.workspace ?? response;
  }
}

function createClientMutationId() {
  const randomId =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().replaceAll('-', '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

  return `cmd_${randomId}`;
}

function buildBoardSchemaPayload(input) {
  const payload = {};

  if (input?.languagePolicy !== undefined) {
    payload.languagePolicy = input.languagePolicy;
  }

  if (input?.stageDefinitions !== undefined) {
    payload.stageDefinitions = input.stageDefinitions;
  }

  if (input?.templates !== undefined) {
    payload.templates = input.templates;
  }

  return payload;
}

function buildBoardAiPayload(input) {
  const payload = {};

  if (input?.aiProvider !== undefined) {
    payload.aiProvider = input.aiProvider;
  }

  if (input?.openAiApiKey !== undefined) {
    payload.openAiApiKey = input.openAiApiKey;
  }

  if (input?.clearOpenAiApiKey !== undefined) {
    payload.clearOpenAiApiKey = input.clearOpenAiApiKey;
  }

  return payload;
}

function buildBoardLocalizationPayload(input) {
  const payload = {};

  if (input?.localizationGlossary !== undefined) {
    payload.localizationGlossary = input.localizationGlossary;
  }

  return payload;
}

function isInviteDecisionType(type) {
  return type === 'board.invite.accept' || type === 'board.invite.decline';
}

function createWorkspaceTitleMutationResult(response) {
  const payload = isPlainObject(response)
    ? response
    : {
        workspace: response ?? null
      };
  const workspaceId =
    normalizeOptionalWorkspaceId(payload?.result?.workspaceId)
    ?? normalizeOptionalWorkspaceId(payload?.activeWorkspace?.workspaceId)
    ?? normalizeOptionalWorkspaceId(payload?.workspace?.workspaceId);
  const workspaceTitle =
    normalizeOptionalString(payload?.result?.workspaceTitle)
    || normalizeOptionalString(payload?.activeWorkspace?.workspaceTitle)
    || normalizeOptionalString(payload?.workspace?.title)
    || null;

  return {
    ...payload,
    workspaceId,
    workspaceTitle
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalWorkspaceId(workspaceId) {
  return typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId.trim() : null;
}
