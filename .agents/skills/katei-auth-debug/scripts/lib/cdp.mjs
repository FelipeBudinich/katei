import WebSocket from 'ws';

const DEFAULT_CDP_HOST = '127.0.0.1';

export async function getOrCreateInspectablePageTarget(port) {
  const pageTargets = await listPageTargets(port);
  const preferredTarget = pageTargets.find((target) => target.url === 'about:blank')
    ?? pageTargets[0];

  if (preferredTarget) {
    return preferredTarget;
  }

  return createPageTarget(port, 'about:blank');
}

export async function findInspectablePageTarget(port, { targetUrlPrefix } = {}) {
  const pageTargets = await listPageTargets(port);

  if (!targetUrlPrefix) {
    return pageTargets[0] ?? null;
  }

  return pageTargets.find((target) => typeof target.url === 'string' && target.url.startsWith(targetUrlPrefix)) ?? null;
}

export async function listPageTargets(port) {
  const response = await fetch(buildDevToolsUrl(port, '/json/list'));

  if (!response.ok) {
    throw new Error(`Unable to list Chrome targets on port ${port}.`);
  }

  const targets = await response.json();

  return Array.isArray(targets)
    ? targets.filter((target) => target?.type === 'page' && typeof target.webSocketDebuggerUrl === 'string')
    : [];
}

export async function createPageTarget(port, url = 'about:blank') {
  const response = await fetch(buildDevToolsUrl(port, `/json/new?${encodeURIComponent(url)}`), {
    method: 'PUT'
  });

  if (!response.ok) {
    throw new Error(`Unable to create a Chrome target on port ${port}.`);
  }

  return response.json();
}

export async function connectToTarget(target) {
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  return client;
}

export async function enablePageDomainSet(client) {
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Log.enable');
  await client.send('Network.enable');
}

export function createPageEventCollector(client) {
  const consoleEntries = [];
  const pageErrors = [];
  const failedRequests = [];
  const detachFns = [];

  detachFns.push(client.on('Runtime.consoleAPICalled', (params) => {
    consoleEntries.push({
      type: params?.type ?? 'log',
      text: formatRemoteArguments(params?.args),
      url: params?.stackTrace?.callFrames?.[0]?.url ?? null
    });
  }));

  detachFns.push(client.on('Runtime.exceptionThrown', (params) => {
    pageErrors.push({
      text: params?.exceptionDetails?.text ?? 'Unhandled exception',
      url: params?.exceptionDetails?.url ?? null,
      lineNumber: params?.exceptionDetails?.lineNumber ?? null,
      columnNumber: params?.exceptionDetails?.columnNumber ?? null
    });
  }));

  detachFns.push(client.on('Log.entryAdded', (params) => {
    const entry = params?.entry;

    if (!entry || (entry.level !== 'error' && entry.level !== 'warning')) {
      return;
    }

    pageErrors.push({
      level: entry.level,
      text: entry.text ?? '',
      url: entry.url ?? null,
      source: entry.source ?? null
    });
  }));

  detachFns.push(client.on('Network.loadingFailed', (params) => {
    failedRequests.push({
      requestId: params?.requestId ?? null,
      type: params?.type ?? null,
      errorText: params?.errorText ?? '',
      canceled: Boolean(params?.canceled),
      blockedReason: params?.blockedReason ?? null
    });
  }));

  return {
    consoleEntries,
    pageErrors,
    failedRequests,
    dispose() {
      for (const detachFn of detachFns) {
        detachFn();
      }
    }
  };
}

export async function setSessionCookie(client, { url, name, value }) {
  const { success } = await client.send('Network.setCookie', {
    url,
    name,
    value,
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: url.startsWith('https:')
  });

  if (!success) {
    throw new Error(`Unable to set ${name} cookie in Chrome.`);
  }
}

export async function navigateToUrl(client, url, timeoutMs = 15000) {
  const loadEventPromise = waitForEvent(client, 'Page.loadEventFired', timeoutMs);
  await client.send('Page.navigate', { url });
  await loadEventPromise;
}

export async function waitForSelector(client, selector, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const selectorState = await evaluate(client, buildSelectorInspectionExpression({
      waitForSelector: selector,
      inspectSelectors: {
        target: {
          selector
        }
      }
    }));

    if (selectorState?.target?.count > 0) {
      return selectorState.target;
    }

    await sleep(200);
  }

  throw new Error(`Timed out waiting for selector ${selector}.`);
}

export async function waitForText(client, selector, text, timeoutMs = 15000, { exact = false } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await evaluateFunction(client, ({ selector: targetSelector, text: expectedText, exact: expectExact }) => {
      const elements = Array.from(document.querySelectorAll(targetSelector));
      const visibleElement = elements.find((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return (
          !element.hidden &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(rect.width) > 0 &&
          Number(rect.height) > 0
        );
      }) ?? elements[0] ?? null;

      const actualText = (visibleElement?.textContent ?? '').trim();

      return {
        matched: expectExact ? actualText === expectedText : actualText.includes(expectedText),
        actualText
      };
    }, {
      selector,
      text,
      exact
    });

    if (result?.matched) {
      return result;
    }

    await sleep(200);
  }

  throw new Error(`Timed out waiting for text "${text}" in selector ${selector}.`);
}

export async function clickSelector(client, selector, { requireVisible = true } = {}) {
  const result = await evaluateFunction(client, ({ selector: targetSelector, requireVisible: requireVisibleSelection }) => {
    const elements = Array.from(document.querySelectorAll(targetSelector));

    function isVisible(element) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return (
        !element.hidden &&
        !element.disabled &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(rect.width) > 0 &&
        Number(rect.height) > 0
      );
    }

    const element = elements.find((candidate) => !requireVisibleSelection || isVisible(candidate)) ?? null;

    if (!element) {
      return {
        clicked: false,
        matches: elements.length
      };
    }

    element.scrollIntoView({
      block: 'center',
      inline: 'center'
    });
    element.click();

    return {
      clicked: true,
      matches: elements.length,
      tagName: element.tagName.toLowerCase()
    };
  }, {
    selector,
    requireVisible
  });

  if (!result?.clicked) {
    throw new Error(`Unable to click selector ${selector}.`);
  }

  return result;
}

export async function setFormValue(client, selector, value) {
  const result = await evaluateFunction(client, ({ selector: targetSelector, value: nextValue }) => {
    const element = document.querySelector(targetSelector);

    if (!element) {
      return {
        ok: false,
        reason: 'not-found'
      };
    }

    if (!('value' in element)) {
      return {
        ok: false,
        reason: 'missing-value-property'
      };
    }

    element.focus();
    element.value = nextValue;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));

    return {
      ok: true,
      tagName: element.tagName.toLowerCase(),
      value: element.value
    };
  }, {
    selector,
    value
  });

  if (!result?.ok) {
    throw new Error(`Unable to set value for selector ${selector}.`);
  }

  return result;
}

export async function submitSelector(client, selector) {
  const result = await evaluateFunction(client, ({ selector: targetSelector }) => {
    const element = document.querySelector(targetSelector);

    if (!element) {
      return {
        submitted: false,
        reason: 'not-found'
      };
    }

    if (typeof element.requestSubmit === 'function') {
      element.requestSubmit();
      return {
        submitted: true,
        mode: 'requestSubmit',
        tagName: element.tagName.toLowerCase()
      };
    }

    if (typeof element.submit === 'function') {
      element.submit();
      return {
        submitted: true,
        mode: 'submit',
        tagName: element.tagName.toLowerCase()
      };
    }

    if (typeof element.click === 'function') {
      element.click();
      return {
        submitted: true,
        mode: 'click',
        tagName: element.tagName.toLowerCase()
      };
    }

    return {
      submitted: false,
      reason: 'unsupported-element',
      tagName: element.tagName.toLowerCase()
    };
  }, {
    selector
  });

  if (!result?.submitted) {
    throw new Error(`Unable to submit selector ${selector}.`);
  }

  return result;
}

export async function inspectSelectors(client, inspectSelectors) {
  return evaluate(client, buildSelectorInspectionExpression({
    waitForSelector: null,
    inspectSelectors
  }));
}

export async function readWorkspaceBootstrap(client) {
  return evaluateFunction(client, () => {
    const bootstrapElement = document.getElementById('workspace-bootstrap');

    if (!bootstrapElement?.textContent) {
      return null;
    }

    try {
      return JSON.parse(bootstrapElement.textContent);
    } catch (error) {
      return {
        __parseError: String(error?.message ?? error)
      };
    }
  });
}

export async function readWorkspaceSnapshot(client, workspaceApiPath = '/api/workspace') {
  return evaluateFunction(client, async ({ workspaceApiPath: targetPath }) => {
    const response = await fetch(targetPath, {
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json'
      }
    });

    const body = await response.json().catch(() => null);

    return {
      ok: response.ok,
      status: response.status,
      body
    };
  }, {
    workspaceApiPath
  });
}

export async function getPageSummary(client) {
  return evaluate(client, `(() => ({
    url: window.location.href,
    title: document.title,
    readyState: document.readyState
  }))()`);
}

export async function captureScreenshot(client) {
  const { data } = await client.send('Page.captureScreenshot', {
    format: 'png'
  });

  if (typeof data !== 'string' || !data) {
    throw new Error('Chrome did not return screenshot data.');
  }

  return Buffer.from(data, 'base64');
}

export async function evaluateFunction(client, pageFunction, argument = undefined) {
  const functionSource = typeof pageFunction === 'function' ? pageFunction.toString() : String(pageFunction);
  const expression = argument === undefined
    ? `(${functionSource})()`
    : `(${functionSource})(${JSON.stringify(argument)})`;

  return evaluate(client, expression);
}

function buildSelectorInspectionExpression({ waitForSelector, inspectSelectors }) {
  return `(() => {
    const selectorEntries = ${JSON.stringify(inspectSelectors)};

    function snapshot(selector) {
      const elements = Array.from(document.querySelectorAll(selector));
      const firstElement = elements[0] ?? null;

      if (!firstElement) {
        return {
          selector,
          count: 0,
          visible: false,
          text: ''
        };
      }

      const rect = firstElement.getBoundingClientRect();
      const style = window.getComputedStyle(firstElement);
      const visible =
        !firstElement.hidden
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(rect.width) > 0
        && Number(rect.height) > 0;

      return {
        selector,
        count: elements.length,
        visible,
        text: (firstElement.textContent || '').trim()
      };
    }

    return Object.fromEntries(
      Object.entries(selectorEntries).map(([label, entry]) => [label, snapshot(entry.selector)])
    );
  })()`;
}

async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });

  if (response?.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || 'Runtime evaluation failed.');
  }

  return response?.result?.value;
}

function waitForEvent(client, method, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      detach();
      reject(new Error(`Timed out waiting for ${method}.`));
    }, timeoutMs);

    const detach = client.on(method, (params) => {
      clearTimeout(timeout);
      detach();
      resolve(params);
    });
  });
}

function buildDevToolsUrl(port, path) {
  return `http://${DEFAULT_CDP_HOST}:${port}${path}`;
}

function formatRemoteArguments(args = []) {
  return args
    .map((arg) => {
      if (Object.prototype.hasOwnProperty.call(arg ?? {}, 'value')) {
        return formatPrimitive(arg.value);
      }

      if (typeof arg?.description === 'string' && arg.description) {
        return arg.description;
      }

      return arg?.type ?? 'unknown';
    })
    .join(' ');
}

function formatPrimitive(value) {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

function sleep(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

class CdpClient {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.socket = null;
    this.nextCommandId = 0;
    this.pendingCommands = new Map();
    this.listeners = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.webSocketUrl);

      socket.once('open', () => {
        this.socket = socket;
        resolve();
      });

      socket.once('error', reject);
      socket.on('message', (payload) => {
        this.handleMessage(payload.toString());
      });
      socket.on('close', () => {
        this.rejectAllPendingCommands(new Error('Chrome target disconnected.'));
      });
    });
  }

  on(method, handler) {
    const handlers = this.listeners.get(method) ?? new Set();
    handlers.add(handler);
    this.listeners.set(method, handlers);

    return () => {
      handlers.delete(handler);

      if (handlers.size === 0) {
        this.listeners.delete(method);
      }
    };
  }

  async send(method, params = {}) {
    if (!this.socket) {
      throw new Error('Chrome target socket is not connected.');
    }

    const id = ++this.nextCommandId;
    const payload = JSON.stringify({ id, method, params });

    return new Promise((resolve, reject) => {
      this.pendingCommands.set(id, { resolve, reject });
      this.socket.send(payload, (error) => {
        if (!error) {
          return;
        }

        this.pendingCommands.delete(id);
        reject(error);
      });
    });
  }

  async close() {
    if (!this.socket) {
      return;
    }

    const socket = this.socket;
    this.socket = null;

    await new Promise((resolve) => {
      socket.once('close', resolve);
      socket.close();
    });
  }

  handleMessage(payload) {
    const message = JSON.parse(payload);

    if (message.id) {
      const pendingCommand = this.pendingCommands.get(message.id);

      if (!pendingCommand) {
        return;
      }

      this.pendingCommands.delete(message.id);

      if (message.error) {
        pendingCommand.reject(new Error(message.error.message || 'Chrome DevTools command failed.'));
        return;
      }

      pendingCommand.resolve(message.result);
      return;
    }

    const handlers = this.listeners.get(message.method);

    if (!handlers) {
      return;
    }

    for (const handler of handlers) {
      handler(message.params);
    }
  }

  rejectAllPendingCommands(error) {
    for (const [id, pendingCommand] of this.pendingCommands.entries()) {
      this.pendingCommands.delete(id);
      pendingCommand.reject(error);
    }
  }
}
