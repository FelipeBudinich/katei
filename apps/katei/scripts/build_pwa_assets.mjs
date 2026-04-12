import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_PRECACHE_URLS = Object.freeze([
  '/offline.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/background.webp',
  '/assets/app.css',
  '/js/app.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png'
]);

const BUILD_ID_PLACEHOLDER = "'BUILD_ID'";
const PRECACHE_URLS_PLACEHOLDER = '/* PRECACHE_URLS */ []';
const DEFAULT_BUILD_ENV = {
  PWA_BUILD_ID: process.env.PWA_BUILD_ID,
  GITHUB_SHA: process.env.GITHUB_SHA
};

export function resolveBuildId({ env = process.env, packageVersion }) {
  // Use CI metadata so each deploy gets a stable cache version tied to the
  // built artifact. Server boot time would churn caches on dyno restarts.
  return env.PWA_BUILD_ID || env.GITHUB_SHA || `dev-${packageVersion}`;
}

export async function filterExistingPrecacheUrls({
  publicDirUrl,
  candidateUrls = DEFAULT_PRECACHE_URLS
}) {
  const existingUrls = [];

  for (const urlPath of candidateUrls) {
    if (await publicAssetExists(publicDirUrl, urlPath)) {
      existingUrls.push(urlPath);
    }
  }

  return existingUrls;
}

export function renderServiceWorker({ template, buildId, precacheUrls }) {
  if (!template.includes(BUILD_ID_PLACEHOLDER)) {
    throw new Error(`Service worker template is missing ${BUILD_ID_PLACEHOLDER}.`);
  }

  if (!template.includes(PRECACHE_URLS_PLACEHOLDER)) {
    throw new Error(`Service worker template is missing ${PRECACHE_URLS_PLACEHOLDER}.`);
  }

  return template
    .replace(BUILD_ID_PLACEHOLDER, JSON.stringify(buildId))
    .replace(PRECACHE_URLS_PLACEHOLDER, JSON.stringify(precacheUrls, null, 2));
}

export async function buildPwaAssets({
  appRootUrl = new URL('../', import.meta.url),
  env = DEFAULT_BUILD_ENV,
  precacheUrls = DEFAULT_PRECACHE_URLS
} = {}) {
  const packageJson = JSON.parse(
    await fs.readFile(new URL('package.json', appRootUrl), 'utf8')
  );

  if (!packageJson.version) {
    throw new Error('apps/katei/package.json must define version for the local PWA fallback build id.');
  }

  const buildId = resolveBuildId({
    env,
    packageVersion: packageJson.version
  });
  const publicDirUrl = new URL('public/', appRootUrl);
  const resolvedPrecacheUrls = await filterExistingPrecacheUrls({
    publicDirUrl,
    candidateUrls: precacheUrls
  });
  const template = await fs.readFile(
    new URL('public/sw.template.js', appRootUrl),
    'utf8'
  );
  const output = renderServiceWorker({
    template,
    buildId,
    precacheUrls: resolvedPrecacheUrls
  });

  await fs.writeFile(new URL('public/sw.js', appRootUrl), output);

  return {
    buildId,
    precacheUrls: resolvedPrecacheUrls,
    output
  };
}

async function publicAssetExists(publicDirUrl, urlPath) {
  const relativePath = urlPath.replace(/^\//, '');

  try {
    await fs.access(new URL(relativePath, publicDirUrl));
    return true;
  } catch {
    return false;
  }
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  await buildPwaAssets();
}
