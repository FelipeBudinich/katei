import { Router } from 'express';
import { getBoardCardContentVariant } from '../../public/js/domain/card_localization.js';
import { migrateWorkspaceSnapshot } from '../../public/js/domain/workspace_migrations.js';
import {
  APP_TITLE,
  COLUMN_ORDER,
  PRIORITY_ORDER,
  createEmptyWorkspace
} from '../../public/js/domain/workspace_read_model.js';
import { getColumnDisplayLabel, getPriorityDisplayLabel } from '../../public/js/i18n/workspace_labels.js';
import { buildInviteResponseDebugFields, createInviteDebugLogger } from '../lib/invite_debug.js';
import { WorkspaceAccessDeniedError } from '../workspaces/workspace_record_repository.js';

export function createBoardsRouter({ requireSession, workspaceRecordRepository }) {
  const router = Router();

  router.get('/boards', requireSession, async (request, response, next) => {
    const debugLog = createInviteDebugLogger({ request });

    try {
      debugLog('viewer.identity', {
        route: 'GET /boards',
        workspaceId: resolveRequestedWorkspaceId(request),
        hasSession: Boolean(request?.kateiSession),
        viewerSub: request.viewer?.sub ?? null,
        viewerEmail: request.viewer?.email ?? null,
        viewerName: typeof request.viewer?.name === 'string' && request.viewer.name.trim() ? request.viewer.name.trim() : null
      });
      const [record, pendingWorkspaceInvites] = await Promise.all([
        workspaceRecordRepository.loadOrCreateWorkspaceRecord({
          viewerSub: request.viewer.sub,
          viewerEmail: request.viewer.email ?? null,
          workspaceId: resolveRequestedWorkspaceId(request),
          debugLog
        }),
        workspaceRecordRepository.listPendingWorkspaceInvitesForViewer({
          viewerSub: request.viewer.sub,
          viewerEmail: request.viewer.email ?? null,
          debugLog
        })
      ]);
      const accessibleWorkspaces = await workspaceRecordRepository.listAccessibleWorkspacesForViewer({
        viewerSub: request.viewer.sub,
        viewerEmail: request.viewer.email ?? null,
        excludeWorkspaceId: record.workspaceId,
        debugLog
      });

      const pageModel = buildWorkspacePageModel(
        request.viewer,
        response.locals.t,
        request.uiLocale ?? null,
        record.workspace,
        createWorkspaceBootstrapMeta(record),
        pendingWorkspaceInvites,
        accessibleWorkspaces
      );

      debugLog('invite.response.summary', buildInviteResponseDebugFields({
        route: 'GET /boards',
        viewer: request.viewer,
        workspace: pageModel.workspace,
        activeWorkspace: {
          workspaceId: record.workspaceId,
          isHomeWorkspace: record.isHomeWorkspace
        },
        pendingWorkspaceInvites
      }));

      response.render('pages/workspace', pageModel);
    } catch (error) {
      if (error instanceof WorkspaceAccessDeniedError || error?.code === 'WORKSPACE_ACCESS_DENIED') {
        response.status(404).send('Workspace not found.');
        return;
      }

      next(error);
    }
  });

  return router;
}

export function buildWorkspacePageModel(
  viewer,
  t,
  uiLocale = null,
  workspace = createEmptyWorkspace(),
  workspaceMeta = null,
  pendingWorkspaceInvites = [],
  accessibleWorkspaces = []
) {
  const normalizedWorkspace = migrateWorkspaceSnapshot(workspace);
  const activeBoard = getProjectedActiveBoard(normalizedWorkspace);
  const columnDisplayTitles = buildColumnDisplayTitles(t);
  const columnDefinitions = COLUMN_ORDER.map((id) => ({
    id,
    title: columnDisplayTitles[id]
  }));
  const priorityDefinitions = PRIORITY_ORDER.map((id) => ({
    id,
    label: getPriorityDisplayLabel(id, t)
  }));

  return {
    workspace: normalizedWorkspace,
    board: buildServerRenderedBoard(activeBoard, uiLocale),
    columnDefinitions,
    columnDisplayTitles,
    priorityDefinitions,
    pageTitle: t('pageTitles.workspace', { appTitle: APP_TITLE }),
    bodyClass: 'app-shell',
    viewer,
    workspaceBootstrapJson: workspaceMeta
      ? serializeWorkspaceBootstrapPayload({
          workspace: normalizedWorkspace,
          activeWorkspace: createActiveWorkspaceDescriptor(normalizedWorkspace, workspaceMeta),
          meta: workspaceMeta,
          pendingWorkspaceInvites: Array.isArray(pendingWorkspaceInvites) ? pendingWorkspaceInvites : [],
          accessibleWorkspaces: Array.isArray(accessibleWorkspaces) ? accessibleWorkspaces : []
        })
      : null
  };
}

function buildServerRenderedBoard(board, uiLocale = null) {
  if (!board || typeof board !== 'object') {
    return board;
  }

  const nextBoard = structuredClone(board);

  if (!nextBoard.cards || typeof nextBoard.cards !== 'object') {
    return nextBoard;
  }

  for (const [cardId, card] of Object.entries(nextBoard.cards)) {
    const content = getBoardCardContentVariant(card, board, { uiLocale });

    nextBoard.cards[cardId] = {
      ...card,
      title: content?.title ?? '',
      detailsMarkdown: content?.detailsMarkdown ?? ''
    };
  }

  return nextBoard;
}

function getProjectedActiveBoard(workspace) {
  const activeBoardId = typeof workspace?.ui?.activeBoardId === 'string' ? workspace.ui.activeBoardId.trim() : '';
  return activeBoardId ? workspace?.boards?.[activeBoardId] ?? null : null;
}

function buildColumnDisplayTitles(t) {
  return Object.fromEntries(
    COLUMN_ORDER.map((columnId) => [columnId, getColumnDisplayLabel(columnId, t)])
  );
}

function createWorkspaceBootstrapMeta(record) {
  return {
    revision: record.revision,
    updatedAt: record.updatedAt,
    lastChangedBy: record.lastChangedBy,
    isPristine: record.revision === 0,
    workspaceId: record.workspaceId,
    isHomeWorkspace: record.isHomeWorkspace
  };
}

function createActiveWorkspaceDescriptor(workspace, workspaceMeta) {
  return {
    workspaceId: workspaceMeta?.workspaceId ?? workspace?.workspaceId ?? null,
    isHomeWorkspace: workspaceMeta?.isHomeWorkspace ?? false
  };
}

function serializeWorkspaceBootstrapPayload(payload) {
  return JSON.stringify(payload)
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function resolveRequestedWorkspaceId(request) {
  return typeof request?.query?.workspaceId === 'string' && request.query.workspaceId.trim()
    ? request.query.workspaceId.trim()
    : null;
}
