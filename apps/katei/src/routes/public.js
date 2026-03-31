import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { APP_TITLE } from '../../public/js/domain/workspace_read_model.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '../..');
const envInventoryPath = path.join(appRoot, 'docs', 'env-inventory.html');
const filetreePath = path.join(appRoot, 'docs', 'filetree.html');

export function createPublicRouter({ config }) {
  const router = Router();

  router.get('/', (request, response) => {
    if (request.viewer) {
      response.redirect('/boards');
      return;
    }

    const { t } = response.locals;

    response.render('pages/landing', {
      pageTitle: t('pageTitles.landing', { appTitle: APP_TITLE }),
      bodyClass: 'app-shell landing-shell',
      googleClientId: config.googleClientId,
      authUrl: '/auth/google',
      redirectUrl: '/boards'
    });
  });

  router.get('/docs/env-inventory.html', (request, response, next) => {
    sendGeneratedDoc(response, next, envInventoryPath);
  });

  router.get('/docs/filetree.html', (request, response, next) => {
    sendGeneratedDoc(response, next, filetreePath);
  });

  router.get('/health', (request, response) => {
    response.json({ ok: true });
  });

  return router;
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
