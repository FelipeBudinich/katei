import { Router } from 'express';
import { projectWorkspaceWithLegacyColumns } from '../../public/js/domain/board_workflow.js';
import { projectWorkspaceWithLegacyCardContent } from '../../public/js/domain/card_localization.js';
import { migrateWorkspaceSnapshot } from '../../public/js/domain/workspace_migrations.js';
import {
  APP_TITLE,
  COLUMN_ORDER,
  PRIORITY_ORDER,
  createEmptyWorkspace
} from '../../public/js/domain/workspace_read_model.js';
import { getActiveBoard } from '../../public/js/domain/workspace_selectors.js';
import { getColumnDisplayLabel, getPriorityDisplayLabel } from '../../public/js/i18n/workspace_labels.js';
import { WorkspaceAccessDeniedError } from '../workspaces/workspace_record_repository.js';

export function createBoardsRouter({ requireSession, workspaceRecordRepository }) {
  const router = Router();

  router.get('/boards', requireSession, async (request, response, next) => {
    try {
      const record = await workspaceRecordRepository.loadOrCreateWorkspaceRecord({
        viewerSub: request.viewer.sub,
        viewerEmail: request.viewer.email ?? null,
        workspaceId: resolveRequestedWorkspaceId(request)
      });

      response.render(
        'pages/workspace',
        buildWorkspacePageModel(
          request.viewer,
          response.locals.t,
          record.workspace,
          createWorkspaceBootstrapMeta(record)
        )
      );
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

export function buildWorkspacePageModel(viewer, t, workspace = createEmptyWorkspace(), workspaceMeta = null) {
  const normalizedWorkspace = migrateWorkspaceSnapshot(workspace);
  const projectedWorkspace = projectWorkspaceWithLegacyColumns(
    projectWorkspaceWithLegacyCardContent(normalizedWorkspace)
  );
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
    workspace: projectedWorkspace,
    board: getActiveBoard(projectedWorkspace),
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
          meta: workspaceMeta
        })
      : null
  };
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
