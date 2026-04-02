import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_CONFIG_PATH = path.resolve(process.cwd(), '.agents/katei-auth-debug.config.json');
export const DEFAULT_CHROME_BINARY_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const DEFAULT_REMOTE_DEBUGGING_PORT = 9222;
export const DEFAULT_USER_DATA_DIR = '/tmp/katei-auth-debug-profile';
export const DEFAULT_ARTIFACT_DIR = '/tmp/katei-auth-debug';
export const DEFAULT_WAIT_TIMEOUT_MS = 15000;
export const DEFAULT_START_PATH = '/boards';
export const DEFAULT_WAIT_SELECTOR = '[data-controller="workspace"]';
export const DEFAULT_BOARD_LIFECYCLE_TITLE_PREFIX = 'Codex Board Smoke';
export const DEFAULT_BOARD_LIFECYCLE_EDITED_TITLE_SUFFIX = 'Edited';
export const DEFAULT_BOARD_LIFECYCLE_SOURCE_LOCALE = 'en';
export const DEFAULT_BOARD_LIFECYCLE_DEFAULT_LOCALE = 'en';
export const DEFAULT_BOARD_LIFECYCLE_SUPPORTED_LOCALES = Object.freeze(['en']);
export const DEFAULT_BOARD_LIFECYCLE_REQUIRED_LOCALES = Object.freeze(['en']);
export const DEFAULT_BOARD_LIFECYCLE_STAGE_DEFINITIONS = Object.freeze([
  'backlog | Backlog | doing, done',
  'doing | Doing | backlog, done',
  'done | Done | backlog, doing, archived',
  'archived | Archived | backlog, doing, done | card.delete'
]);
export const DEFAULT_INSPECT_SELECTORS = Object.freeze({
  workspaceRoot: '[data-controller="workspace"]',
  boardTitle: '[data-workspace-target="boardTitle"]',
  workspaceBootstrap: '#workspace-bootstrap'
});

export function parseCliArgs(argv = process.argv.slice(2)) {
  const args = [...argv];
  let configPath = DEFAULT_CONFIG_PATH;

  while (args.length > 0) {
    const arg = args.shift();

    if (arg === '--config') {
      const nextValue = args.shift();

      if (!nextValue) {
        throw new Error('Missing value for --config.');
      }

      configPath = path.resolve(process.cwd(), nextValue);
      continue;
    }

    throw new Error(`Unsupported argument: ${arg}`);
  }

  return { configPath };
}

export async function loadKateiAuthDebugConfig({ configPath = DEFAULT_CONFIG_PATH } = {}) {
  const resolvedConfigPath = path.resolve(process.cwd(), configPath);
  const rawText = await fs.readFile(resolvedConfigPath, 'utf8');
  const parsed = JSON.parse(rawText);

  return normalizeKateiAuthDebugConfig(parsed, { configPath: resolvedConfigPath });
}

export function normalizeKateiAuthDebugConfig(rawConfig, { configPath = DEFAULT_CONFIG_PATH } = {}) {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    throw new Error('Katei auth debug config must be a JSON object.');
  }

  const baseUrl = normalizeBaseUrl(rawConfig.baseUrl);
  const startPath = normalizeStartPath(rawConfig.startPath ?? DEFAULT_START_PATH);
  const auth = normalizeAuthConfig(rawConfig.auth, { baseUrl });
  const chrome = normalizeChromeConfig(rawConfig.chrome);
  const page = normalizePageConfig(rawConfig.page);
  const boardLifecycle = normalizeBoardLifecycleConfig(rawConfig.boardLifecycle);

  return {
    configPath,
    baseUrl,
    startPath,
    targetUrl: new URL(startPath, baseUrl).toString(),
    auth,
    chrome,
    page,
    boardLifecycle
  };
}

function normalizeAuthConfig(rawAuth = {}, { baseUrl }) {
  if (rawAuth != null && (typeof rawAuth !== 'object' || Array.isArray(rawAuth))) {
    throw new Error('auth config must be an object when provided.');
  }

  const mode = normalizeAuthMode(rawAuth?.mode ?? 'debug-route');
  const defaultSecretKeychainAccount = new URL(baseUrl).hostname;

  return {
    mode,
    debugLoginPath: normalizeStartPath(rawAuth?.debugLoginPath ?? '/__debug/login'),
    secretEnvVar: normalizeEnvVarName(rawAuth?.secretEnvVar ?? 'KATEI_DEBUG_AUTH_SECRET'),
    secretKeychainService: normalizeNonEmptyString(rawAuth?.secretKeychainService) || 'katei-auth-debug',
    secretKeychainAccount: normalizeNonEmptyString(rawAuth?.secretKeychainAccount) || defaultSecretKeychainAccount,
    cookieName: normalizeCookieName(rawAuth?.cookieName ?? 'katei_session'),
    cookieEnvVar: normalizeEnvVarName(rawAuth?.cookieEnvVar ?? 'KATEI_DEBUG_SESSION_COOKIE')
  };
}

function normalizeChromeConfig(rawChrome = {}) {
  if (rawChrome != null && (typeof rawChrome !== 'object' || Array.isArray(rawChrome))) {
    throw new Error('chrome config must be an object when provided.');
  }

  return {
    binaryPath: normalizeNonEmptyString(rawChrome?.binaryPath) || DEFAULT_CHROME_BINARY_PATH,
    remoteDebuggingPort: normalizePort(rawChrome?.remoteDebuggingPort ?? DEFAULT_REMOTE_DEBUGGING_PORT),
    userDataDir: normalizeFsPath(rawChrome?.userDataDir ?? DEFAULT_USER_DATA_DIR)
  };
}

function normalizePageConfig(rawPage = {}) {
  if (rawPage != null && (typeof rawPage !== 'object' || Array.isArray(rawPage))) {
    throw new Error('page config must be an object when provided.');
  }

  return {
    waitForSelector: normalizeSelector(rawPage?.waitForSelector ?? DEFAULT_WAIT_SELECTOR, 'page.waitForSelector'),
    waitTimeoutMs: normalizePositiveInteger(rawPage?.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS, 'page.waitTimeoutMs'),
    artifactDir: normalizeFsPath(rawPage?.artifactDir ?? DEFAULT_ARTIFACT_DIR),
    inspectSelectors: normalizeInspectSelectors(rawPage?.inspectSelectors ?? DEFAULT_INSPECT_SELECTORS)
  };
}

function normalizeBoardLifecycleConfig(rawBoardLifecycle = {}) {
  if (rawBoardLifecycle != null && (typeof rawBoardLifecycle !== 'object' || Array.isArray(rawBoardLifecycle))) {
    throw new Error('boardLifecycle config must be an object when provided.');
  }

  return {
    titlePrefix: normalizeNonEmptyString(rawBoardLifecycle?.titlePrefix) || DEFAULT_BOARD_LIFECYCLE_TITLE_PREFIX,
    editedTitleSuffix:
      normalizeNonEmptyString(rawBoardLifecycle?.editedTitleSuffix) || DEFAULT_BOARD_LIFECYCLE_EDITED_TITLE_SUFFIX,
    sourceLocale: normalizeLocale(rawBoardLifecycle?.sourceLocale ?? DEFAULT_BOARD_LIFECYCLE_SOURCE_LOCALE, 'boardLifecycle.sourceLocale'),
    defaultLocale:
      normalizeLocale(rawBoardLifecycle?.defaultLocale ?? DEFAULT_BOARD_LIFECYCLE_DEFAULT_LOCALE, 'boardLifecycle.defaultLocale'),
    supportedLocales: normalizeLocaleList(
      rawBoardLifecycle?.supportedLocales ?? DEFAULT_BOARD_LIFECYCLE_SUPPORTED_LOCALES,
      'boardLifecycle.supportedLocales'
    ),
    requiredLocales: normalizeLocaleList(
      rawBoardLifecycle?.requiredLocales ?? DEFAULT_BOARD_LIFECYCLE_REQUIRED_LOCALES,
      'boardLifecycle.requiredLocales'
    ),
    stageDefinitions: normalizeStringList(
      rawBoardLifecycle?.stageDefinitions ?? DEFAULT_BOARD_LIFECYCLE_STAGE_DEFINITIONS,
      'boardLifecycle.stageDefinitions'
    )
  };
}

function normalizeInspectSelectors(rawInspectSelectors) {
  if (!rawInspectSelectors || typeof rawInspectSelectors !== 'object' || Array.isArray(rawInspectSelectors)) {
    throw new Error('page.inspectSelectors must be an object.');
  }

  const entries = Object.entries(rawInspectSelectors);

  if (entries.length === 0) {
    throw new Error('page.inspectSelectors must define at least one selector.');
  }

  return Object.fromEntries(
    entries.map(([label, value]) => [normalizeLabel(label), normalizeInspectSelectorEntry(label, value)])
  );
}

function normalizeInspectSelectorEntry(label, value) {
  if (typeof value === 'string') {
    return {
      selector: normalizeSelector(value, `page.inspectSelectors.${label}`)
    };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`page.inspectSelectors.${label} must be a selector string or object.`);
  }

  return {
    selector: normalizeSelector(value.selector, `page.inspectSelectors.${label}.selector`)
  };
}

function normalizeBaseUrl(value) {
  const normalizedValue = normalizeNonEmptyString(value);

  if (!normalizedValue) {
    throw new Error('baseUrl is required.');
  }

  const parsedUrl = new URL(normalizedValue);

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('baseUrl must use http or https.');
  }

  return parsedUrl.toString().replace(/\/$/, '');
}

function normalizeStartPath(value) {
  const normalizedValue = normalizeNonEmptyString(value);

  if (!normalizedValue) {
    throw new Error('Path values must not be blank.');
  }

  return normalizedValue.startsWith('/') ? normalizedValue : `/${normalizedValue}`;
}

function normalizeAuthMode(value) {
  const normalizedValue = normalizeNonEmptyString(value);

  if (normalizedValue === 'debug-route' || normalizedValue === 'cookie') {
    return normalizedValue;
  }

  throw new Error(`Unsupported auth.mode: ${value}`);
}

function normalizeCookieName(value) {
  const normalizedValue = normalizeNonEmptyString(value);

  if (!normalizedValue) {
    throw new Error('auth.cookieName is required.');
  }

  return normalizedValue;
}

function normalizeEnvVarName(value) {
  const normalizedValue = normalizeNonEmptyString(value);

  if (!normalizedValue) {
    throw new Error('Env var names must not be blank.');
  }

  return normalizedValue;
}

function normalizePort(value) {
  return normalizePositiveInteger(value, 'chrome.remoteDebuggingPort');
}

function normalizeLocale(value, fieldName) {
  const normalizedValue = normalizeNonEmptyString(value);

  if (!normalizedValue) {
    throw new Error(`${fieldName} must not be blank.`);
  }

  return normalizedValue.replaceAll('_', '-');
}

function normalizePositiveInteger(value, fieldName) {
  const normalizedValue = Number.parseInt(String(value), 10);

  if (!Number.isInteger(normalizedValue) || normalizedValue <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return normalizedValue;
}

function normalizeSelector(value, fieldName) {
  const normalizedValue = normalizeNonEmptyString(value);

  if (!normalizedValue) {
    throw new Error(`${fieldName} must not be blank.`);
  }

  return normalizedValue;
}

function normalizeLabel(value) {
  const normalizedValue = normalizeNonEmptyString(value);

  if (!normalizedValue) {
    throw new Error('Selector labels must not be blank.');
  }

  return normalizedValue;
}

function normalizeFsPath(value) {
  const normalizedValue = normalizeNonEmptyString(value);

  if (!normalizedValue) {
    throw new Error('Filesystem paths must not be blank.');
  }

  return path.isAbsolute(normalizedValue)
    ? normalizedValue
    : path.resolve(process.cwd(), normalizedValue);
}

function normalizeLocaleList(value, fieldName) {
  const normalizedEntries = normalizeStringList(value, fieldName).map((entry) => entry.replaceAll('_', '-'));

  if (normalizedEntries.length === 0) {
    throw new Error(`${fieldName} must define at least one locale.`);
  }

  return normalizedEntries;
}

function normalizeStringList(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array.`);
  }

  const normalizedEntries = value
    .map((entry) => normalizeNonEmptyString(entry))
    .filter(Boolean);

  if (normalizedEntries.length === 0) {
    throw new Error(`${fieldName} must define at least one entry.`);
  }

  return normalizedEntries;
}

function normalizeNonEmptyString(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}
