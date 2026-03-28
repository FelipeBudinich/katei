import { Router } from 'express';
import {
  APP_TITLE,
  COLUMN_DEFINITIONS,
  PRIORITY_DEFINITIONS,
  createEmptyWorkspace,
  getActiveBoard
} from '../../public/js/domain/workspace.js';

export function createBoardsRouter({ requireSession }) {
  const router = Router();

  router.get('/boards', requireSession, (request, response) => {
    response.render('pages/workspace', buildWorkspacePageModel(request.viewer));
  });

  return router;
}

export function buildWorkspacePageModel(viewer) {
  const workspace = createEmptyWorkspace();

  return {
    workspace,
    board: getActiveBoard(workspace),
    columnDefinitions: COLUMN_DEFINITIONS,
    priorityDefinitions: PRIORITY_DEFINITIONS,
    pageTitle: APP_TITLE,
    bodyClass: 'app-shell',
    viewer
  };
}

