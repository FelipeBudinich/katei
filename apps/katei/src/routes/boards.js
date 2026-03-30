import { Router } from 'express';
import {
  APP_TITLE,
  COLUMN_ORDER,
  PRIORITY_ORDER,
  createEmptyWorkspace,
  getActiveBoard
} from '../../public/js/domain/workspace.js';
import { getColumnDisplayLabel, getPriorityDisplayLabel } from '../../public/js/i18n/workspace_labels.js';

export function createBoardsRouter({ requireSession }) {
  const router = Router();

  router.get('/boards', requireSession, (request, response) => {
    response.render('pages/workspace', buildWorkspacePageModel(request.viewer, response.locals.t));
  });

  return router;
}

export function buildWorkspacePageModel(viewer, t, workspace = createEmptyWorkspace()) {
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
    workspace,
    board: getActiveBoard(workspace),
    columnDefinitions,
    columnDisplayTitles,
    priorityDefinitions,
    pageTitle: t('pageTitles.workspace', { appTitle: APP_TITLE }),
    bodyClass: 'app-shell',
    viewer
  };
}

function buildColumnDisplayTitles(t) {
  return Object.fromEntries(
    COLUMN_ORDER.map((columnId) => [columnId, getColumnDisplayLabel(columnId, t)])
  );
}
