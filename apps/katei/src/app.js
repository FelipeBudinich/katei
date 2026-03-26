import express from 'express';
import nunjucks from 'nunjucks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webRouter from './routes/web.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appRoot, '../..');

export function createApp() {
  const app = express();
  const viewsPath = path.join(__dirname, 'views');
  const stimulusDistPath = resolveStimulusDistPath();

  app.set('view engine', 'njk');
  app.set('views', viewsPath);

  nunjucks.configure(viewsPath, {
    autoescape: true,
    express: app,
    noCache: process.env.NODE_ENV !== 'production'
  });

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(path.join(appRoot, 'public')));

  if (stimulusDistPath) {
    app.use('/vendor/stimulus', express.static(stimulusDistPath));
  }

  app.use(webRouter);

  return app;
}

function resolveStimulusDistPath() {
  const candidates = [
    path.join(appRoot, 'node_modules', '@hotwired', 'stimulus', 'dist'),
    path.join(repoRoot, 'node_modules', '@hotwired', 'stimulus', 'dist')
  ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}
