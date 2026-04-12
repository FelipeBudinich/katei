import fs from 'node:fs';
import path from 'node:path';

const COMMIT_LIKE_BUILD_ID_PATTERN = /^[a-f0-9]{12,}$/i;

export function formatPwaBuildIdShort(pwaBuildId) {
  const normalizedBuildId = normalizeRequiredString('pwaBuildId', pwaBuildId);

  return COMMIT_LIKE_BUILD_ID_PATTERN.test(normalizedBuildId)
    ? normalizedBuildId.slice(0, 7)
    : normalizedBuildId;
}

export function createPwaBuildMeta(pwaBuildId) {
  const normalizedBuildId = normalizeRequiredString('pwaBuildId', pwaBuildId);

  return {
    pwaBuildId: normalizedBuildId,
    pwaBuildIdShort: formatPwaBuildIdShort(normalizedBuildId)
  };
}

export function loadPwaBuildMeta({ appRootPath }) {
  const normalizedAppRootPath = normalizeRequiredString('appRootPath', appRootPath);
  const buildMetaPath = path.join(normalizedAppRootPath, 'public', 'build-meta.json');

  if (!fs.existsSync(buildMetaPath)) {
    return createPwaBuildMeta(resolveFallbackBuildId(normalizedAppRootPath));
  }

  return parseBuildMetaFile(fs.readFileSync(buildMetaPath, 'utf8'), buildMetaPath);
}

function parseBuildMetaFile(fileContents, sourcePath) {
  let parsed;

  try {
    parsed = JSON.parse(fileContents);
  } catch (error) {
    throw new Error(`Failed to parse ${sourcePath}: ${error.message}`);
  }

  const pwaBuildId = normalizeRequiredString('pwaBuildId', parsed?.pwaBuildId, sourcePath);
  const pwaBuildIdShort = normalizeRequiredString('pwaBuildIdShort', parsed?.pwaBuildIdShort, sourcePath);
  const expectedShort = formatPwaBuildIdShort(pwaBuildId);

  if (pwaBuildIdShort !== expectedShort) {
    throw new Error(`${sourcePath} has invalid pwaBuildIdShort; expected "${expectedShort}".`);
  }

  return {
    pwaBuildId,
    pwaBuildIdShort
  };
}

function resolveFallbackBuildId(appRootPath) {
  const packageJsonPath = path.join(appRootPath, 'package.json');
  const packageJson = readJsonFile(packageJsonPath);
  const packageVersion = normalizeRequiredString('version', packageJson?.version, packageJsonPath);

  return `dev-${packageVersion}`;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to read ${filePath}: ${error.message}`);
  }
}

function normalizeRequiredString(name, value, sourcePath = 'value') {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${sourcePath} must define a non-empty ${name}.`);
  }

  return value.trim();
}
