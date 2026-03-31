import { Router } from 'express';
import { projectWorkspaceWithLegacyColumns } from '../../public/js/domain/board_workflow.js';
import {
  APP_TITLE,
  COLUMN_ORDER,
  PRIORITY_ORDER,
  createEmptyWorkspace
} from '../../public/js/domain/workspace_read_model.js';
import { getActiveBoard } from '../../public/js/domain/workspace_selectors.js';
import { getColumnDisplayLabel, getPriorityDisplayLabel } from '../../public/js/i18n/workspace_labels.js';

export function createBoardsRouter({ requireSession, workspaceRecordRepository }) {
  const router = Router();

  router.get('/boards', requireSession, async (request, response, next) => {
    try {
      const record = await workspaceRecordRepository.loadOrCreateWorkspaceRecord(request.viewer.sub);

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
      next(error);
    }
  });

  return router;
}

export function buildWorkspacePageModel(viewer, t, workspace = createEmptyWorkspace(), workspaceMeta = null) {
  const projectedWorkspace = projectWorkspaceWithLegacyColumns(workspace);
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
          workspace: projectedWorkspace,
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
    isPristine: record.revision === 0
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
