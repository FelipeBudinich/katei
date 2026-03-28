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
const filetreePath = path.join(appRoot, 'docs', 'filetree.html');

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

function sendGeneratedDoc(response, next, filePath) {
  response.sendFile(filePath, (error) => {
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

export function renderEnvInventory(request, response, next) {
  sendGeneratedDoc(response, next, envInventoryPath);
}

export function renderFiletree(request, response, next) {
  sendGeneratedDoc(response, next, filetreePath);
}

router.get('/', renderWorkspacePage);

router.get('/docs/env-inventory.html', renderEnvInventory);
router.get('/docs/filetree.html', renderFiletree);

router.get('/health', renderHealth);

export default router;
