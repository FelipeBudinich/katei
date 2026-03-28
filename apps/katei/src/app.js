import express from 'express';
import nunjucks from 'nunjucks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import { createRuntimeConfig } from './config.js';
import { createGoogleIdTokenVerifier } from './auth/verify_google_id_token.js';
import { createAttachSessionMiddleware } from './middleware/attach_session.js';
import { createWebRouter } from './routes/web.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appRoot, '../..');

export function createApp({ env = process.env, googleTokenVerifier } = {}) {
  const app = express();
  const config = createRuntimeConfig(env);
  const viewsPath = path.join(__dirname, 'views');
  const stimulusDistPath = resolveStimulusDistPath();
  const verifyGoogleIdToken = googleTokenVerifier || createGoogleIdTokenVerifier({
    clientId: config.googleClientId
  });

  app.set('view engine', 'njk');
  app.set('views', viewsPath);

  nunjucks.configure(viewsPath, {
    autoescape: true,
    express: app,
    noCache: config.nodeEnv !== 'production'
  });

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use(express.static(path.join(appRoot, 'public')));

  if (stimulusDistPath) {
    app.use('/vendor/stimulus', express.static(stimulusDistPath));
  }

  app.use(createAttachSessionMiddleware(config));
  app.use(createWebRouter({ config, verifyGoogleIdToken }));
  app.use(handleBodyParserError);
  app.use(handleUnexpectedError);

  return app;
}

function handleBodyParserError(error, request, response, next) {
  if (error?.type !== 'entity.parse.failed') {
    next(error);
    return;
  }

  if (request.path.startsWith('/auth/')) {
    response.status(400).json({
      ok: false,
      error: 'Invalid request body.'
    });
    return;
  }

  response.status(400).send('Bad Request');
}

function handleUnexpectedError(error, request, response, next) {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (request.path.startsWith('/auth/')) {
    response.status(500).json({
      ok: false,
      error: 'Unable to complete the request.'
    });
    return;
  }

  next(error);
}

function resolveStimulusDistPath() {
  const candidates = [
    path.join(appRoot, 'node_modules', '@hotwired', 'stimulus', 'dist'),
    path.join(repoRoot, 'node_modules', '@hotwired', 'stimulus', 'dist')
  ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}
