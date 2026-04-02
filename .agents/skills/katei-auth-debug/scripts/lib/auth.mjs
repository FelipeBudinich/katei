import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function obtainKateiSession({ config, env = process.env, fetchImpl = fetch } = {}) {
  if (config.auth.mode === 'cookie') {
    const cookieValue = requireEnv(config.auth.cookieEnvVar, env);

    return {
      mode: 'cookie',
      cookieName: config.auth.cookieName,
      cookieValue,
      viewer: null,
      redirectTo: config.startPath
    };
  }

  return requestDebugRouteSession({ config, env, fetchImpl });
}

export async function requestDebugRouteSession({ config, env = process.env, fetchImpl = fetch } = {}) {
  const secret = await resolveDebugAuthSecret({ config, env });
  const debugLoginUrl = new URL(config.auth.debugLoginPath, config.baseUrl).toString();
  const response = await fetchImpl(debugLoginUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'x-katei-debug-auth': secret
    }
  });
  const responseBody = await parseJsonResponse(response);
  const setCookieHeaders = getSetCookieHeaders(response.headers);
  const cookieValue = extractCookieValueFromSetCookieHeaders(setCookieHeaders, config.auth.cookieName);

  if (!response.ok) {
    throw new Error(
      responseBody?.error
        ? `Hosted debug login failed (${response.status}): ${responseBody.error}`
        : `Hosted debug login failed with status ${response.status}.`
    );
  }

  if (!cookieValue) {
    throw new Error(`Hosted debug login did not return a ${config.auth.cookieName} cookie.`);
  }

  return {
    mode: 'debug-route',
    cookieName: config.auth.cookieName,
    cookieValue,
    viewer: normalizeViewer(responseBody?.viewer),
    redirectTo: typeof responseBody?.redirectTo === 'string' && responseBody.redirectTo.trim()
      ? responseBody.redirectTo.trim()
      : config.startPath,
    debugLoginUrl
  };
}

export function extractCookieValueFromSetCookieHeaders(setCookieHeaders, cookieName) {
  const normalizedHeaders = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : (typeof setCookieHeaders === 'string' && setCookieHeaders ? [setCookieHeaders] : []);
  const escapedCookieName = escapeForRegExp(cookieName);
  const cookiePattern = new RegExp(`(?:^|[,\\s])${escapedCookieName}=([^;]+)`);

  for (const headerValue of normalizedHeaders) {
    const normalizedHeaderValue = typeof headerValue === 'string' ? headerValue : '';
    const match = normalizedHeaderValue.match(cookiePattern);

    if (match) {
      return match[1];
    }
  }

  return '';
}

export function getSetCookieHeaders(headers) {
  if (headers && typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }

  const singleHeader = headers?.get?.('set-cookie');
  return singleHeader ? [singleHeader] : [];
}

export async function resolveDebugAuthSecret({
  config,
  env = process.env,
  execFileImpl = execFileAsync
} = {}) {
  const envValue = readEnv(config.auth.secretEnvVar, env);

  if (envValue) {
    return envValue;
  }

  const keychainValue = await readSecretFromMacOsKeychain({
    service: config.auth.secretKeychainService,
    account: config.auth.secretKeychainAccount,
    execFileImpl
  });

  if (keychainValue) {
    return keychainValue;
  }

  throw new Error(
    `Missing debug auth secret. Set ${config.auth.secretEnvVar} or add a macOS Keychain item with service ` +
    `${config.auth.secretKeychainService} and account ${config.auth.secretKeychainAccount}.`
  );
}

export async function readSecretFromMacOsKeychain({
  service,
  account,
  execFileImpl = execFileAsync
} = {}) {
  if (process.platform !== 'darwin') {
    return '';
  }

  try {
    const { stdout } = await execFileImpl('security', [
      'find-generic-password',
      '-w',
      '-s',
      service,
      '-a',
      account
    ]);

    return typeof stdout === 'string' ? stdout.trim() : '';
  } catch (error) {
    return '';
  }
}

function requireEnv(name, env = process.env) {
  const value = readEnv(name, env);

  if (!value) {
    throw new Error(`Environment variable ${name} is required.`);
  }

  return value;
}

function readEnv(name, env = process.env) {
  return typeof env?.[name] === 'string' ? env[name].trim() : '';
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

function normalizeViewer(viewer) {
  if (!viewer || typeof viewer !== 'object') {
    return null;
  }

  const sub = typeof viewer.sub === 'string' ? viewer.sub.trim() : '';
  const email = typeof viewer.email === 'string' ? viewer.email.trim() : '';
  const name = typeof viewer.name === 'string' ? viewer.name.trim() : '';

  if (!sub) {
    return null;
  }

  return {
    sub,
    ...(email ? { email } : {}),
    ...(name ? { name } : {})
  };
}

function escapeForRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
