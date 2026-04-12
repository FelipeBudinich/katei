import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { formatPwaBuildIdShort, loadPwaBuildMeta } from '../src/lib/pwa_build_meta.js';

test('formatPwaBuildIdShort shortens commit-like ids to seven characters', () => {
  assert.equal(formatPwaBuildIdShort('abc1234ef567890'), 'abc1234');
});

test('formatPwaBuildIdShort leaves non-commit-like ids unchanged', () => {
  assert.equal(formatPwaBuildIdShort('dev-0.0.0'), 'dev-0.0.0');
});

test('loadPwaBuildMeta reads generated build metadata from disk', async (t) => {
  const tempAppRoot = await createTempAppRoot(t, { version: '1.2.3' });
  await fs.mkdir(path.join(tempAppRoot, 'public'), { recursive: true });
  await fs.writeFile(
    path.join(tempAppRoot, 'public', 'build-meta.json'),
    JSON.stringify({
      pwaBuildId: 'abcdef1234567890',
      pwaBuildIdShort: 'abcdef1'
    }, null, 2)
  );

  assert.deepEqual(loadPwaBuildMeta({ appRootPath: tempAppRoot }), {
    pwaBuildId: 'abcdef1234567890',
    pwaBuildIdShort: 'abcdef1'
  });
});

test('loadPwaBuildMeta falls back to the package version when build metadata is missing', async (t) => {
  const tempAppRoot = await createTempAppRoot(t, { version: '1.2.3' });

  assert.deepEqual(loadPwaBuildMeta({ appRootPath: tempAppRoot }), {
    pwaBuildId: 'dev-1.2.3',
    pwaBuildIdShort: 'dev-1.2.3'
  });
});

test('loadPwaBuildMeta rejects malformed existing build metadata', async (t) => {
  const tempAppRoot = await createTempAppRoot(t, { version: '1.2.3' });
  await fs.mkdir(path.join(tempAppRoot, 'public'), { recursive: true });
  await fs.writeFile(
    path.join(tempAppRoot, 'public', 'build-meta.json'),
    JSON.stringify({
      pwaBuildId: 'abcdef1234567890',
      pwaBuildIdShort: 'wrong'
    }, null, 2)
  );

  assert.throws(
    () => loadPwaBuildMeta({ appRootPath: tempAppRoot }),
    /invalid pwaBuildIdShort/
  );
});

async function createTempAppRoot(t, { version }) {
  const tempAppRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'katei-pwa-meta-'));
  t.after(async () => {
    await fs.rm(tempAppRoot, { recursive: true, force: true });
  });

  await fs.writeFile(
    path.join(tempAppRoot, 'package.json'),
    JSON.stringify({ name: '@katei/app', version }, null, 2)
  );

  return tempAppRoot;
}
