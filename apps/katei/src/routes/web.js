import { Router } from 'express';
import {
  APP_TITLE,
  COLUMN_DEFINITIONS,
  PRIORITY_DEFINITIONS,
  createEmptyWorkspace,
  getActiveBoard
} from '../../public/js/domain/workspace.js';

const router = Router();

export function buildWorkspacePageModel() {
  const workspace = createEmptyWorkspace();

  return {
    workspace,
    board: getActiveBoard(workspace),
    columnDefinitions: COLUMN_DEFINITIONS,
    priorityDefinitions: PRIORITY_DEFINITIONS,
    pageTitle: APP_TITLE
  };
}

export function renderWorkspacePage(request, response) {
  response.render('pages/workspace', buildWorkspacePageModel());
}

export function renderHealth(request, response) {
  response.json({ ok: true });
}

router.get('/', renderWorkspacePage);

router.get('/health', renderHealth);

export default router;
