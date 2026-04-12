import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPwaAssets, resolveBuildId } from '../scripts/build_pwa_assets.mjs';

test('resolveBuildId prefers explicit CI metadata and falls back to the package version', () => {
  assert.equal(
    resolveBuildId({
      env: {
        PWA_BUILD_ID: 'manual-build-id',
        GITHUB_SHA: 'commit-sha'
      },
      packageVersion: '1.2.3'
    }),
    'manual-build-id'
  );
  assert.equal(
    resolveBuildId({
      env: {
        GITHUB_SHA: 'commit-sha'
      },
      packageVersion: '1.2.3'
    }),
    'commit-sha'
  );
  assert.equal(
    resolveBuildId({
      env: {},
      packageVersion: '1.2.3'
    }),
    'dev-1.2.3'
  );
});

test('buildPwaAssets filters missing precache files and writes deterministic output', async (t) => {
  const tempAppRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'katei-pwa-assets-'));
  t.after(async () => {
    await fs.rm(tempAppRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(tempAppRoot, 'public', 'assets'), { recursive: true });
  await fs.mkdir(path.join(tempAppRoot, 'public', 'js'), { recursive: true });

  await fs.writeFile(
    path.join(tempAppRoot, 'package.json'),
    JSON.stringify({ name: '@katei/app', version: '9.9.9' }, null, 2)
  );
  await fs.writeFile(
    path.join(tempAppRoot, 'public', 'sw.template.js'),
    [
      "const BUILD_ID = 'BUILD_ID';",
      "const PRECACHE_URLS = Object.freeze(/* PRECACHE_URLS */ []);",
      ''
    ].join('\n')
  );
  await fs.writeFile(path.join(tempAppRoot, 'public', 'offline.html'), '<p>offline</p>');
  await fs.writeFile(path.join(tempAppRoot, 'public', 'assets', 'app.css'), 'body {}');
  await fs.writeFile(path.join(tempAppRoot, 'public', 'js', 'app.js'), 'console.log("katei");');

  const appRootUrl = pathToFileURL(`${tempAppRoot}${path.sep}`);
  const firstBuild = await buildPwaAssets({
    appRootUrl,
    env: {
      GITHUB_SHA: 'abcdef123456'
    }
  });
  const firstOutput = await fs.readFile(path.join(tempAppRoot, 'public', 'sw.js'), 'utf8');
  const secondBuild = await buildPwaAssets({
    appRootUrl,
    env: {
      GITHUB_SHA: 'abcdef123456'
    }
  });
  const secondOutput = await fs.readFile(path.join(tempAppRoot, 'public', 'sw.js'), 'utf8');

  assert.equal(firstBuild.buildId, 'abcdef123456');
  assert.deepEqual(firstBuild.precacheUrls, [
    '/offline.html',
    '/assets/app.css',
    '/js/app.js'
  ]);
  assert.equal(firstOutput, secondOutput);
  assert.equal(secondBuild.buildId, 'abcdef123456');
  assert.match(firstOutput, /const BUILD_ID = "abcdef123456";/);
  assert.doesNotMatch(firstOutput, /'BUILD_ID'/);
  assert.doesNotMatch(firstOutput, /\/\* PRECACHE_URLS \*\//);
});
