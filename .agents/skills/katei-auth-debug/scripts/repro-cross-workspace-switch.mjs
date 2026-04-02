#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createArtifactStamp,
  normalizeCapturedArtifacts,
  sanitizeArtifactLabel
} from './lib/artifacts.mjs';
import { obtainKateiSession } from './lib/auth.mjs';
import {
  captureScreenshot,
  connectToTarget,
  createPageEventCollector,
  enablePageDomainSet,
  evaluateFunction,
  getOrCreateInspectablePageTarget,
  navigateToUrl,
  setSessionCookie,
  waitForSelector
} from './lib/cdp.mjs';
import { loadKateiAuthDebugConfig, parseCliArgs } from './lib/config.mjs';
import {
  classifyWorkspaceInviteAcceptanceOutcome,
  classifyWorkspaceSwitchOutcome,
  DEFAULT_WORKSPACE_SWITCH_REPRO_SCENARIOS,
  selectScenarioButton
} from './lib/workspace_switch_repro.mjs';

const { configPath } = parseCliArgs();
const config = await loadKateiAuthDebugConfig({ configPath });
const session = await obtainKateiSession({ config });
const artifactStamp = createArtifactStamp();
const artifactSlug = sanitizeArtifactLabel(`${new URL(config.baseUrl).hostname}-cross-workspace-switch`);
const artifactRoot = config.page.artifactDir;

await fs.mkdir(artifactRoot, { recursive: true });

const target = await getOrCreateInspectablePageTarget(config.chrome.remoteDebuggingPort);
const client = await connectToTarget(target);

try {
  await enablePageDomainSet(client);
  await registerReproInstrumentationBootstrap(client);

  const collector = createPageEventCollector(client);

  try {
    await ensureAuthenticatedWorkspacePage(client, config, session);

    const scenarioReports = [];
    const initialOptionsSnapshot = await captureOptionsSnapshot(client, {
      reinstallInstrumentation: true
    });

    const scenarios = Array.isArray(config.workspaceSwitchRepro?.scenarios) && config.workspaceSwitchRepro.scenarios.length > 0
      ? config.workspaceSwitchRepro.scenarios
      : DEFAULT_WORKSPACE_SWITCH_REPRO_SCENARIOS;

    for (const scenario of scenarios) {
      const consoleStart = collector.consoleEntries.length;
      const pageErrorsStart = collector.pageErrors.length;
      const failedRequestsStart = collector.failedRequests.length;
      const scenarioReport = await runScenario(client, {
        config,
        artifactRoot,
        artifactSlug,
        artifactStamp,
        scenario
      });

      scenarioReport.consoleEntries = collector.consoleEntries.slice(consoleStart);
      scenarioReport.pageErrors = collector.pageErrors.slice(pageErrorsStart);
      scenarioReport.failedRequests = collector.failedRequests.slice(failedRequestsStart);
      scenarioReports.push(scenarioReport);
    }

    const report = {
      ok: true,
      configPath: config.configPath,
      capturedAt: new Date().toISOString(),
      baseUrl: config.baseUrl,
      targetUrl: config.targetUrl,
      session: {
        mode: session.mode,
        viewer: session.viewer,
        redirectTo: session.redirectTo
      },
      initialOptionsSnapshot,
      scenarios: scenarioReports,
      ...normalizeCapturedArtifacts({
        consoleEntries: collector.consoleEntries,
        pageErrors: collector.pageErrors,
        failedRequests: collector.failedRequests
      })
    };
    const reportPath = path.join(artifactRoot, `${artifactSlug}-${artifactStamp}.json`);
    const latestPath = path.join(artifactRoot, 'latest-cross-workspace-switch.json');

    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    await fs.writeFile(latestPath, `${JSON.stringify(report, null, 2)}\n`);

    console.log(JSON.stringify({
      ok: true,
      reportPath,
      latestPath,
      diagnoses: scenarioReports.map((scenarioReport) => ({
        id: scenarioReport.id,
        category: scenarioReport.diagnosis.category,
        summary: scenarioReport.diagnosis.summary
      }))
    }, null, 2));
  } finally {
    collector.dispose();
  }
} finally {
  await client.close();
}

async function runScenario(client, {
  config,
  artifactRoot,
  artifactSlug,
  artifactStamp,
  scenario
}) {
  const scenarioAction = scenario.action ?? 'switch';

  await navigateToUrl(client, config.targetUrl, config.page.waitTimeoutMs);
  await waitForSelector(client, config.page.waitForSelector, config.page.waitTimeoutMs);
  await installReproInstrumentation(client);

  const beforeState = await readCurrentWorkspaceState(client);
  const optionsSnapshot = await captureOptionsSnapshot(client);
  const candidateButtons = scenarioAction === 'accept-invite' ? optionsSnapshot.inviteButtons : optionsSnapshot.switchButtons;
  const clickedButtonDataset = selectScenarioButton(candidateButtons, scenario, {
    currentWorkspaceId: beforeState.activeWorkspaceId
  });
  const beforeScreenshotPath = path.join(
    artifactRoot,
    `${artifactSlug}-${artifactStamp}-${sanitizeArtifactLabel(`${scenario.id}-before`)}.png`
  );

  await writeScreenshot(client, beforeScreenshotPath);

  if (!clickedButtonDataset) {
    const diagnosis = {
      category: 'inconclusive',
      summary: scenarioAction === 'accept-invite'
        ? 'No matching invite row was visible for this scenario.'
        : 'No matching switch row was visible for this scenario.',
      evidence: {
        availableButtons: candidateButtons
      }
    };

    return {
      id: scenario.id,
      description: scenario.description,
      beforeUrl: beforeState.url,
      afterUrl: beforeState.url,
      beforeBoardTitle: beforeState.boardTitle,
      afterBoardTitle: beforeState.boardTitle,
      beforeState,
      afterState: beforeState,
      optionsSnapshot,
      clickedButtonDataset: null,
      emittedEventDetail: null,
      networkEntries: [],
      historyEntries: [],
      beforeScreenshotPath,
      afterScreenshotPath: beforeScreenshotPath,
      diagnosis
    };
  }

  await resetReproInstrumentation(client);
  if (scenarioAction === 'accept-invite') {
    await clickInviteAcceptButton(client, clickedButtonDataset);
  } else {
    await clickSwitchButton(client, clickedButtonDataset);
  }
  await waitForReproIdle(client, config.page.waitTimeoutMs);

  const instrumentation = await readReproInstrumentation(client);
  const afterState = await readCurrentWorkspaceState(client);
  const afterScreenshotPath = path.join(
    artifactRoot,
    `${artifactSlug}-${artifactStamp}-${sanitizeArtifactLabel(`${scenario.id}-after`)}.png`
  );
  const emittedEvent = instrumentation.events.at(-1) ?? null;
  const emittedEventDetail = emittedEvent?.detail ?? null;

  await writeScreenshot(client, afterScreenshotPath);

  const diagnosis = scenarioAction === 'accept-invite'
    ? classifyWorkspaceInviteAcceptanceOutcome({
        beforeState,
        afterState,
        clickedButtonDataset,
        emittedEventDetail,
        networkEntries: instrumentation.networkEntries,
        historyEntries: instrumentation.historyEntries,
        expectedWorkspaceId: clickedButtonDataset.workspaceId,
        expectedBoardId: clickedButtonDataset.boardId
      })
    : classifyWorkspaceSwitchOutcome({
        beforeState,
        afterState,
        clickedButtonDataset,
        emittedEventDetail,
        networkEntries: instrumentation.networkEntries,
        historyEntries: instrumentation.historyEntries,
        expectedWorkspaceId: clickedButtonDataset.workspaceId,
        expectedBoardId: clickedButtonDataset.boardId
      });

  return {
    id: scenario.id,
    description: scenario.description,
    action: scenarioAction,
    beforeUrl: beforeState.url,
    afterUrl: afterState.url,
    beforeBoardTitle: beforeState.boardTitle,
    afterBoardTitle: afterState.boardTitle,
    beforeState,
    afterState,
    optionsSnapshot,
    clickedButtonDataset,
    emittedEventName: emittedEvent?.name ?? null,
    emittedEventDetail,
    networkEntries: instrumentation.networkEntries,
    historyEntries: instrumentation.historyEntries,
    beforeScreenshotPath,
    afterScreenshotPath,
    diagnosis
  };
}

async function ensureAuthenticatedWorkspacePage(client, config, session) {
  await setSessionCookie(client, {
    url: config.baseUrl,
    name: session.cookieName,
    value: session.cookieValue
  });
  await navigateToUrl(client, config.targetUrl, config.page.waitTimeoutMs);
  await waitForSelector(client, config.page.waitForSelector, config.page.waitTimeoutMs);
}

async function captureOptionsSnapshot(client, { reinstallInstrumentation = false } = {}) {
  if (reinstallInstrumentation) {
    await installReproInstrumentation(client);
  }

  await openBoardOptionsDialog(client);

  return evaluateFunction(client, () => {
    const switchButtons = Array.from(document.querySelectorAll('[data-board-options-field="switchButton"]'))
      .filter((button) => !button.hidden)
      .map((button) => {
        const row = button.closest('li');
        const title = row?.querySelector?.('[data-board-options-field="title"]')?.textContent?.trim?.() ?? '';
        const state = row?.querySelector?.('[data-board-options-field="state"]')?.textContent?.trim?.() ?? '';
        const workspaceSection = row?.closest?.('section');
        const workspaceTitle = workspaceSection?.querySelector?.('[data-board-options-field="workspaceTitle"]')?.textContent?.trim?.() ?? '';

        return {
          boardId: button.dataset.boardId ?? '',
          workspaceId: button.dataset.workspaceId ?? '',
          isHomeWorkspace: button.dataset.isHomeWorkspace === 'true',
          boardTitle: button.dataset.boardTitle ?? '',
          title,
          state,
          workspaceTitle,
          buttonText: button.textContent?.trim?.() ?? ''
        };
      });
    const inviteButtons = Array.from(document.querySelectorAll('[data-board-options-field="inviteAcceptButton"]'))
      .filter((button) => !button.hidden)
      .map((button) => {
        const row = button.closest('li');
        const title = row?.querySelector?.('[data-board-options-field="inviteTitle"]')?.textContent?.trim?.() ?? '';
        const meta = row?.querySelector?.('[data-board-options-field="inviteMeta"]')?.textContent?.trim?.() ?? '';
        const role = row?.querySelector?.('[data-board-options-field="inviteRole"]')?.textContent?.trim?.() ?? '';

        return {
          workspaceId: button.dataset.workspaceId ?? '',
          boardId: button.dataset.boardId ?? '',
          inviteId: button.dataset.inviteId ?? '',
          boardTitle: title,
          meta,
          role,
          text: button.textContent?.trim?.() ?? ''
        };
      });

    return {
      switchButtons,
      inviteButtons
    };
  });
}

async function installReproInstrumentation(client) {
  await evaluateFunction(client, createReproInstrumentationBootstrap);
}

async function registerReproInstrumentationBootstrap(client) {
  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(${createReproInstrumentationBootstrap.toString()})();`
  });
}

async function resetReproInstrumentation(client) {
  await evaluateFunction(client, () => {
    const state = window.__kateiWorkspaceSwitchReproState;

    if (!state) {
      return false;
    }

    state.events = [];
    state.historyEntries = [];
    state.networkEntries = [];
    state.pendingFetchCount = 0;
    state.lastActivityAt = Date.now();
    return true;
  });
}

async function readReproInstrumentation(client) {
  return evaluateFunction(client, () => {
    const state = window.__kateiWorkspaceSwitchReproState;

    if (!state) {
      return {
        events: [],
        historyEntries: [],
        networkEntries: [],
        pendingFetchCount: 0,
        quietForMs: 0
      };
    }

    return {
      events: structuredClone(state.events),
      historyEntries: structuredClone(state.historyEntries),
      networkEntries: structuredClone(state.networkEntries),
      pendingFetchCount: state.pendingFetchCount,
      quietForMs: Date.now() - state.lastActivityAt
    };
  });
}

async function waitForReproIdle(client, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const state = await readReproInstrumentation(client);

    if (state.pendingFetchCount === 0 && state.quietForMs >= 400) {
      return state;
    }

    await delay(150);
  }

  return readReproInstrumentation(client);
}

async function readCurrentWorkspaceState(client) {
  return evaluateFunction(client, async () => {
    const originalFetch = window.__kateiWorkspaceSwitchOriginalFetch ?? window.fetch.bind(window);
    const boardTitle = document.querySelector('[data-workspace-target="boardTitle"]')?.textContent?.trim?.() ?? '';
    const workspaceApiUrl = `/api/workspace${window.location.search || ''}`;

    try {
      const response = await originalFetch(workspaceApiUrl, {
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'x-katei-auth-debug-internal': '1'
        }
      });
      const body = await response.json().catch(() => null);

      return {
        url: window.location.href,
        boardTitle,
        responseStatus: response.status,
        activeWorkspaceId: body?.activeWorkspace?.workspaceId ?? null,
        isHomeWorkspace: body?.activeWorkspace?.isHomeWorkspace === true,
        activeBoardId: body?.workspace?.ui?.activeBoardId ?? null,
        boardOrder: Array.isArray(body?.workspace?.boardOrder) ? [...body.workspace.boardOrder] : [],
        workspaceId: body?.workspace?.workspaceId ?? null,
        workspaceApiUrl
      };
    } catch (error) {
      return {
        url: window.location.href,
        boardTitle,
        responseStatus: null,
        activeWorkspaceId: null,
        isHomeWorkspace: false,
        activeBoardId: null,
        boardOrder: [],
        workspaceId: null,
        workspaceApiUrl,
        error: String(error?.message ?? error)
      };
    }
  });
}

async function clickSwitchButton(client, buttonDataset) {
  const result = await evaluateFunction(client, ({ buttonDataset: targetButton }) => {
    const button = Array.from(document.querySelectorAll('[data-board-options-field="switchButton"]'))
      .find((candidate) =>
        !candidate.hidden
        && (candidate.dataset.boardId ?? '') === (targetButton.boardId ?? '')
        && (candidate.dataset.workspaceId ?? '') === (targetButton.workspaceId ?? '')
        && (candidate.dataset.boardTitle ?? '') === (targetButton.boardTitle ?? '')
      ) ?? null;

    if (!button) {
      return {
        clicked: false
      };
    }

    button.click();
    return {
      clicked: true
    };
  }, {
    buttonDataset
  });

  if (!result?.clicked) {
    throw new Error(
      `Unable to click switch button for board ${buttonDataset?.boardId ?? 'unknown'} workspace ${buttonDataset?.workspaceId ?? 'unknown'}.`
    );
  }
}

async function clickInviteAcceptButton(client, buttonDataset) {
  const result = await evaluateFunction(client, ({ buttonDataset: targetButton }) => {
    const button = Array.from(document.querySelectorAll('[data-board-options-field="inviteAcceptButton"]'))
      .find((candidate) =>
        !candidate.hidden
        && (candidate.dataset.boardId ?? '') === (targetButton.boardId ?? '')
        && (candidate.dataset.workspaceId ?? '') === (targetButton.workspaceId ?? '')
        && (candidate.dataset.inviteId ?? '') === (targetButton.inviteId ?? '')
      ) ?? null;

    if (!button) {
      return {
        clicked: false
      };
    }

    button.click();
    return {
      clicked: true
    };
  }, {
    buttonDataset
  });

  if (!result?.clicked) {
    throw new Error(
      `Unable to click invite accept button for board ${buttonDataset?.boardId ?? 'unknown'} workspace ${buttonDataset?.workspaceId ?? 'unknown'}.`
    );
  }
}

async function openBoardOptionsDialog(client) {
  const dialogState = await evaluateFunction(client, () => ({
    open: Boolean(document.querySelector('[data-controller="board-options"]')?.open)
  }));

  if (!dialogState?.open) {
    await evaluateFunction(client, () => {
      document.querySelector('[data-action="workspace#openBoardOptions"]')?.click?.();
      return true;
    });
  }

  await waitForSelector(client, '[data-controller="board-options"][open]');
}

async function writeScreenshot(client, destinationPath) {
  const screenshotBuffer = await captureScreenshot(client);
  await fs.writeFile(destinationPath, screenshotBuffer);
}

function delay(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function createReproInstrumentationBootstrap() {
  if (window.__kateiWorkspaceSwitchReproInstalled) {
    return true;
  }

  const state = {
    events: [],
    historyEntries: [],
    networkEntries: [],
    pendingFetchCount: 0,
    lastActivityAt: Date.now(),
    sequence: 0
  };
  const originalFetch = window.fetch.bind(window);
  const originalPushState = window.history?.pushState?.bind(window.history) ?? null;
  const originalReplaceState = window.history?.replaceState?.bind(window.history) ?? null;

  window.__kateiWorkspaceSwitchOriginalFetch = originalFetch;
  window.__kateiWorkspaceSwitchReproState = state;
  window.__kateiWorkspaceSwitchReproInstalled = true;

  function normalizeOptionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  function normalizeHeaders(headersLike = null) {
    if (!headersLike) {
      return new Headers();
    }

    try {
      return new Headers(headersLike);
    } catch (error) {
      return new Headers();
    }
  }

  function shouldTrack(url, headers) {
    const internalRequest = normalizeHeaders(headers).get('x-katei-auth-debug-internal');

    if (internalRequest) {
      return false;
    }

    try {
      const parsedUrl = new URL(url, window.location.href);
      return parsedUrl.pathname === '/api/workspace' || parsedUrl.pathname === '/api/workspace/commands';
    } catch (error) {
      return false;
    }
  }

  function summarizeWorkspacePayload(payload) {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    return {
      activeWorkspace: payload.activeWorkspace && typeof payload.activeWorkspace === 'object'
        ? {
            workspaceId: normalizeOptionalString(payload.activeWorkspace.workspaceId),
            isHomeWorkspace: payload.activeWorkspace.isHomeWorkspace === true
          }
        : null,
      workspace: payload.workspace && typeof payload.workspace === 'object'
        ? {
            workspaceId: normalizeOptionalString(payload.workspace.workspaceId),
            activeBoardId: normalizeOptionalString(payload.workspace.ui?.activeBoardId),
            boardOrder: Array.isArray(payload.workspace.boardOrder) ? [...payload.workspace.boardOrder] : [],
            boardIds: Object.keys(payload.workspace.boards ?? {})
          }
        : null
    };
  }

  function recordEvent(name, event) {
    state.events.push({
      at: new Date().toISOString(),
      name,
      detail: event?.detail ? structuredClone(event.detail) : null
    });
    state.lastActivityAt = Date.now();
  }

  document.addEventListener('board-options:switch-board', (event) => {
    recordEvent('board-options:switch-board', event);
  }, true);

  document.addEventListener('board-options:accept-invite', (event) => {
    recordEvent('board-options:accept-invite', event);
  }, true);

  if (originalPushState) {
    window.history.pushState = function pushStateWrapper(nextState, title, url) {
      const nextHref = typeof url === 'string' && url.trim()
        ? new URL(url, window.location.href).toString()
        : window.location.href;
      const workspaceId = normalizeOptionalString(nextState?.workspaceId)
        ?? normalizeOptionalString(new URL(nextHref).searchParams.get('workspaceId'));

      state.historyEntries.push({
        method: 'pushState',
        href: nextHref,
        workspaceId,
        at: new Date().toISOString()
      });
      state.lastActivityAt = Date.now();
      return originalPushState(nextState, title, url);
    };
  }

  if (originalReplaceState) {
    window.history.replaceState = function replaceStateWrapper(nextState, title, url) {
      const nextHref = typeof url === 'string' && url.trim()
        ? new URL(url, window.location.href).toString()
        : window.location.href;
      const workspaceId = normalizeOptionalString(nextState?.workspaceId)
        ?? normalizeOptionalString(new URL(nextHref).searchParams.get('workspaceId'));

      state.historyEntries.push({
        method: 'replaceState',
        href: nextHref,
        workspaceId,
        at: new Date().toISOString()
      });
      state.lastActivityAt = Date.now();
      return originalReplaceState(nextState, title, url);
    };
  }

  window.fetch = async function wrappedFetch(input, init = undefined) {
    const requestUrl = typeof input === 'string'
      ? input
      : (typeof input?.url === 'string' ? input.url : String(input));
    const headers = init?.headers ?? input?.headers ?? null;

    if (!shouldTrack(requestUrl, headers)) {
      return originalFetch(input, init);
    }

    const entry = {
      id: ++state.sequence,
      url: new URL(requestUrl, window.location.href).toString(),
      method: typeof init?.method === 'string'
        ? init.method.toUpperCase()
        : (typeof input?.method === 'string' ? input.method.toUpperCase() : 'GET'),
      startedAt: new Date().toISOString()
    };
    const startedAt = Date.now();

    state.pendingFetchCount += 1;
    state.lastActivityAt = startedAt;

    try {
      const response = await originalFetch(input, init);
      entry.status = response.status;
      entry.ok = response.ok;

      try {
        const payload = await response.clone().json();
        entry.responseSummary = summarizeWorkspacePayload(payload);
      } catch (error) {
        entry.responseSummary = null;
      }

      return response;
    } catch (error) {
      entry.error = String(error?.message ?? error);
      throw error;
    } finally {
      entry.durationMs = Date.now() - startedAt;
      entry.completedAt = new Date().toISOString();
      state.networkEntries.push(entry);
      state.pendingFetchCount = Math.max(0, state.pendingFetchCount - 1);
      state.lastActivityAt = Date.now();
    }
  };

  return true;
}
