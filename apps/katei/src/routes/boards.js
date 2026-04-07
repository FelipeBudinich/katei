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
import { setBoardSurfaceCookie, setPortfolioSurfaceCookie } from '../auth/last_surface_cookie.js';
import { WorkspaceAccessDeniedError } from '../workspaces/workspace_record_repository.js';

export function createBoardsRouter({ requireSession, workspaceRecordRepository, config }) {
  const router = Router();

  router.get('/boards', requireSession, async (request, response, next) => {
    const debugLog = createInviteDebugLogger({ request });
    const requestedWorkspaceId = resolveRequestedWorkspaceId(request);
    const requestedBoardId = resolveRequestedBoardId(request);

    try {
      debugLog('viewer.identity', {
        route: 'GET /boards',
        workspaceId: requestedWorkspaceId,
        hasSession: Boolean(request?.kateiSession),
        viewerSub: request.viewer?.sub ?? null,
        viewerEmail: request.viewer?.email ?? null,
        viewerName: typeof request.viewer?.name === 'string' && request.viewer.name.trim() ? request.viewer.name.trim() : null
      });
      const [record, pendingWorkspaceInvites] = await Promise.all([
        workspaceRecordRepository.loadOrCreateWorkspaceRecord({
          viewerSub: request.viewer.sub,
          viewerEmail: request.viewer.email ?? null,
          workspaceId: requestedWorkspaceId,
          debugLog
        }),
        workspaceRecordRepository.listPendingWorkspaceInvitesForViewer({
          viewerSub: request.viewer.sub,
          viewerEmail: request.viewer.email ?? null,
          debugLog
        })
      ]);
      if (shouldFallbackSuperAdminBoardRequestToPortfolio(request.viewer, {
        requestedWorkspaceId,
        requestedBoardId,
        workspace: record.workspace
      })) {
        setPortfolioSurfaceCookie(response, config);
        response.redirect('/portfolio');
        return;
      }

      const accessibleWorkspaces = await workspaceRecordRepository.listAccessibleWorkspacesForViewer({
        viewerSub: request.viewer.sub,
        viewerEmail: request.viewer.email ?? null,
        excludeWorkspaceId: record.workspaceId,
        debugLog
      });
      const workspaceForPage = applyRequestedBoardSelection(record.workspace, requestedBoardId);

      const pageModel = buildWorkspacePageModel(
        request.viewer,
        response.locals.t,
        request.uiLocale ?? null,
        workspaceForPage,
        createWorkspaceBootstrapMeta(record),
        pendingWorkspaceInvites,
        accessibleWorkspaces
      );
      setBoardSurfaceCookie(
        response,
        {
          ...record,
          workspace: workspaceForPage
        },
        config
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
        if (shouldFallbackSuperAdminBoardRequestToPortfolio(request.viewer, {
          requestedWorkspaceId,
          requestedBoardId
        })) {
          setPortfolioSurfaceCookie(response, config);
          response.redirect('/portfolio');
          return;
        }

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
  uiLocaleOrWorkspace = null,
  workspaceOrMeta = createEmptyWorkspace(),
  workspaceMetaOrPendingWorkspaceInvites = null,
  pendingWorkspaceInvitesOrAccessibleWorkspaces = [],
  accessibleWorkspacesArg = []
) {
  const {
    uiLocale,
    workspace,
    workspaceMeta,
    pendingWorkspaceInvites,
    accessibleWorkspaces
  } = normalizeBuildWorkspacePageModelArgs(
    uiLocaleOrWorkspace,
    workspaceOrMeta,
    workspaceMetaOrPendingWorkspaceInvites,
    pendingWorkspaceInvitesOrAccessibleWorkspaces,
    accessibleWorkspacesArg
  );
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

function resolveRequestedBoardId(request) {
  return typeof request?.query?.boardId === 'string' && request.query.boardId.trim()
    ? request.query.boardId.trim()
    : null;
}

function applyRequestedBoardSelection(workspace, requestedBoardId) {
  const normalizedBoardId = normalizeOptionalString(requestedBoardId);

  if (!normalizedBoardId || !workspace?.boards?.[normalizedBoardId]) {
    return workspace;
  }

  const nextWorkspace = structuredClone(workspace);
  nextWorkspace.ui = {
    ...(nextWorkspace.ui ?? {}),
    activeBoardId: normalizedBoardId
  };

  return nextWorkspace;
}

function shouldFallbackSuperAdminBoardRequestToPortfolio(viewer, {
  requestedWorkspaceId = null,
  requestedBoardId = null,
  workspace = null
} = {}) {
  if (viewer?.isSuperAdmin !== true) {
    return false;
  }

  const normalizedRequestedWorkspaceId = normalizeOptionalString(requestedWorkspaceId);
  const normalizedRequestedBoardId = normalizeOptionalString(requestedBoardId);

  if (!normalizedRequestedWorkspaceId && !normalizedRequestedBoardId) {
    return false;
  }

  if (!workspace || typeof workspace !== 'object') {
    return true;
  }

  if (!normalizedRequestedBoardId) {
    return false;
  }

  return !workspace?.boards?.[normalizedRequestedBoardId];
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeBuildWorkspacePageModelArgs(
  uiLocaleOrWorkspace,
  workspaceOrMeta,
  workspaceMetaOrPendingWorkspaceInvites,
  pendingWorkspaceInvitesOrAccessibleWorkspaces,
  accessibleWorkspacesArg
) {
  if (typeof uiLocaleOrWorkspace === 'string' || uiLocaleOrWorkspace == null) {
    return {
      uiLocale: uiLocaleOrWorkspace ?? null,
      workspace: workspaceOrMeta ?? createEmptyWorkspace(),
      workspaceMeta: workspaceMetaOrPendingWorkspaceInvites ?? null,
      pendingWorkspaceInvites: Array.isArray(pendingWorkspaceInvitesOrAccessibleWorkspaces)
        ? pendingWorkspaceInvitesOrAccessibleWorkspaces
        : [],
      accessibleWorkspaces: Array.isArray(accessibleWorkspacesArg) ? accessibleWorkspacesArg : []
    };
  }

  return {
    uiLocale: null,
    workspace: uiLocaleOrWorkspace ?? createEmptyWorkspace(),
    workspaceMeta: workspaceOrMeta ?? null,
    pendingWorkspaceInvites: Array.isArray(workspaceMetaOrPendingWorkspaceInvites)
      ? workspaceMetaOrPendingWorkspaceInvites
      : [],
    accessibleWorkspaces: Array.isArray(pendingWorkspaceInvitesOrAccessibleWorkspaces)
      ? pendingWorkspaceInvitesOrAccessibleWorkspaces
      : []
  };
}
