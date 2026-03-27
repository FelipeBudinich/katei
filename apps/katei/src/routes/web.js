import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import {
  APP_TITLE,
  COLUMN_DEFINITIONS,
  PRIORITY_DEFINITIONS,
  createEmptyWorkspace,
  getActiveBoard
} from '../../public/js/domain/workspace.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '../..');
const envInventoryPath = path.join(appRoot, 'docs', 'env-inventory.html');

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

export function renderEnvInventory(request, response, next) {
  response.sendFile(envInventoryPath, (error) => {
    if (!error) {
      return;
    }

    if (error.code === 'ENOENT') {
      next();
      return;
    }

    next(error);
  });
}

router.get('/', renderWorkspacePage);

router.get('/docs/env-inventory.html', renderEnvInventory);

router.get('/health', renderHealth);

export default router;
