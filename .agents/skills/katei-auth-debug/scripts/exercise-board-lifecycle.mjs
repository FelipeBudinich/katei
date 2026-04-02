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
  clickSelector,
  connectToTarget,
  createPageEventCollector,
  enablePageDomainSet,
  evaluateFunction,
  getOrCreateInspectablePageTarget,
  getPageSummary,
  inspectSelectors,
  navigateToUrl,
  readWorkspaceBootstrap,
  readWorkspaceSnapshot,
  setFormValue,
  setSessionCookie,
  submitSelector,
  waitForSelector,
  waitForText
} from './lib/cdp.mjs';
import {
  buildEditedStageDefinitions,
  createBoardLifecycleTitles,
  findBoardByTitle,
  summarizeWorkspaceBoards
} from './lib/board_lifecycle.mjs';
import { loadKateiAuthDebugConfig, parseCliArgs } from './lib/config.mjs';

const { configPath } = parseCliArgs();
const config = await loadKateiAuthDebugConfig({ configPath });
const session = await obtainKateiSession({ config });
const lifecycleTitles = createBoardLifecycleTitles(config.boardLifecycle);
const editedStageDefinitions = buildEditedStageDefinitions(
  config.boardLifecycle.stageDefinitions,
  config.boardLifecycle.editedTitleSuffix
);
const artifactStamp = createArtifactStamp();
const artifactSlug = sanitizeArtifactLabel(`${new URL(config.baseUrl).hostname}-board-lifecycle`);
const artifactRoot = config.page.artifactDir;

await fs.mkdir(artifactRoot, { recursive: true });

const target = await getOrCreateInspectablePageTarget(config.chrome.remoteDebuggingPort);
const client = await connectToTarget(target);
const stepReports = [];
let createdBoardId = null;
let createdBoardTitle = lifecycleTitles.createdTitle;

try {
  await enablePageDomainSet(client);

  const collector = createPageEventCollector(client);

  try {
    await ensureAuthenticatedWorkspacePage(client, config, session);

    const initialBootstrap = await readWorkspaceBootstrap(client);
    const initialSnapshot = await loadWorkspaceSnapshot(client);
    const initialSummary = summarizeWorkspaceBoards(initialSnapshot.workspace);

    await captureLifecycleStep(client, {
      artifactRoot,
      artifactSlug,
      artifactStamp,
      label: 'initial',
      summary: initialSummary,
      detail: {
        bootstrapWorkspaceId: initialBootstrap?.workspace?.workspaceId ?? null,
        activeBoardTitle: initialSummary.boards.find((board) => board.id === initialSummary.activeBoardId)?.title ?? null
      },
      stepReports
    });

    await openBoardOptionsDialog(client);
    await clickSelector(client, '[data-action="board-options#createBoard"]');
    await waitForSelector(client, '[data-controller="board-editor"][open]', config.page.waitTimeoutMs);

    await fillBoardEditorForm(client, {
      title: lifecycleTitles.createdTitle,
      sourceLocale: config.boardLifecycle.sourceLocale,
      defaultLocale: config.boardLifecycle.defaultLocale,
      supportedLocales: config.boardLifecycle.supportedLocales,
      requiredLocales: config.boardLifecycle.requiredLocales,
      stageDefinitions: config.boardLifecycle.stageDefinitions
    });
    await submitSelector(client, '[data-board-editor-target="form"]');
    await waitForText(
      client,
      '[data-workspace-target="boardTitle"]',
      lifecycleTitles.createdTitle,
      config.page.waitTimeoutMs,
      { exact: true }
    );

    const createSnapshot = await waitForWorkspaceState(
      client,
      ({ workspace, expectedTitle }) => {
        const board = findBoardByTitle(workspace, expectedTitle);
        return board && workspace?.ui?.activeBoardId === board.id;
      },
      {
        timeoutMs: config.page.waitTimeoutMs,
        description: `created board ${lifecycleTitles.createdTitle}`
      },
      {
        expectedTitle: lifecycleTitles.createdTitle
      }
    );

    const createdBoard = findBoardByTitle(createSnapshot.workspace, lifecycleTitles.createdTitle);

    if (!createdBoard?.id) {
      throw new Error(`Unable to resolve created board id for ${lifecycleTitles.createdTitle}.`);
    }

    createdBoardId = createdBoard.id;

    await captureLifecycleStep(client, {
      artifactRoot,
      artifactSlug,
      artifactStamp,
      label: 'create',
      summary: summarizeWorkspaceBoards(createSnapshot.workspace),
      detail: {
        createdBoardId,
        createdBoardTitle: lifecycleTitles.createdTitle
      },
      stepReports
    });

    await ensureActiveBoardById(client, createdBoardId, config.page.waitTimeoutMs);
    await openActiveBoardEditor(client, config.page.waitTimeoutMs);
    await assertBoardEditorTargetsBoard(client, createdBoardId);
    await fillBoardEditorForm(client, {
      title: lifecycleTitles.editedTitle,
      sourceLocale: config.boardLifecycle.sourceLocale,
      defaultLocale: config.boardLifecycle.defaultLocale,
      supportedLocales: config.boardLifecycle.supportedLocales,
      requiredLocales: config.boardLifecycle.requiredLocales,
      stageDefinitions: editedStageDefinitions
    });
    await submitSelector(client, '[data-board-editor-target="form"]');
    await waitForText(
      client,
      '[data-workspace-target="boardTitle"]',
      lifecycleTitles.editedTitle,
      config.page.waitTimeoutMs,
      { exact: true }
    );

    const editSnapshot = await waitForWorkspaceState(
      client,
      ({ workspace, boardId, expectedTitle, expectedFirstStageTitle }) => {
        const board = workspace?.boards?.[boardId];
        return Boolean(
          board &&
          board.title === expectedTitle &&
          board.stageOrder?.[0] &&
          board.stages?.[board.stageOrder[0]]?.title === expectedFirstStageTitle
        );
      },
      {
        timeoutMs: config.page.waitTimeoutMs,
        description: `edited board ${createdBoardId}`
      },
      {
        boardId: createdBoardId,
        expectedTitle: lifecycleTitles.editedTitle,
        expectedFirstStageTitle: extractFirstStageTitle(editedStageDefinitions)
      }
    );

    createdBoardTitle = lifecycleTitles.editedTitle;

    await captureLifecycleStep(client, {
      artifactRoot,
      artifactSlug,
      artifactStamp,
      label: 'edit',
      summary: summarizeWorkspaceBoards(editSnapshot.workspace),
      detail: {
        createdBoardId,
        editedBoardTitle: lifecycleTitles.editedTitle,
        firstEditedStageTitle: extractFirstStageTitle(editedStageDefinitions)
      },
      stepReports
    });

    await ensureActiveBoardById(client, createdBoardId, config.page.waitTimeoutMs);
    await openActiveBoardEditor(client, config.page.waitTimeoutMs);
    await assertBoardEditorTargetsBoard(client, createdBoardId);
    await assertDeleteButtonTargetsBoard(client, createdBoardId);

    const preDeleteSummary = summarizeWorkspaceBoards(editSnapshot.workspace);

    if (preDeleteSummary.boardOrder.length < 2) {
      throw new Error('Refusing to delete the last remaining board.');
    }

    await clickSelector(client, '[data-board-editor-target="deleteButton"]');
    await waitForSelector(client, '[data-workspace-target="confirmDialog"][open]', config.page.waitTimeoutMs);
    await clickSelector(client, '[data-workspace-target="confirmButton"]');

    const deleteSnapshot = await waitForWorkspaceState(
      client,
      ({ workspace, boardId }) => !workspace?.boards?.[boardId] && workspace?.ui?.activeBoardId !== boardId,
      {
        timeoutMs: config.page.waitTimeoutMs,
        description: `deleted board ${createdBoardId}`
      },
      {
        boardId: createdBoardId
      }
    );

    createdBoardId = null;

    await captureLifecycleStep(client, {
      artifactRoot,
      artifactSlug,
      artifactStamp,
      label: 'delete',
      summary: summarizeWorkspaceBoards(deleteSnapshot.workspace),
      detail: {
        deletedBoardTitle: lifecycleTitles.editedTitle
      },
      stepReports
    });

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
      boardLifecycle: {
        createdTitle: lifecycleTitles.createdTitle,
        editedTitle: lifecycleTitles.editedTitle
      },
      initialBootstrapSummary: summarizeWorkspaceBoards(initialBootstrap?.workspace ?? null),
      steps: stepReports,
      ...normalizeCapturedArtifacts({
        consoleEntries: collector.consoleEntries,
        pageErrors: collector.pageErrors,
        failedRequests: collector.failedRequests
      })
    };
    const reportPath = path.join(artifactRoot, `${artifactSlug}-${artifactStamp}.json`);
    const latestPath = path.join(artifactRoot, 'latest-board-lifecycle.json');

    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    await fs.writeFile(latestPath, `${JSON.stringify(report, null, 2)}\n`);

    console.log(JSON.stringify({
      ok: true,
      reportPath,
      latestPath,
      steps: stepReports.map((step) => ({
        label: step.label,
        screenshotPath: step.screenshotPath
      }))
    }, null, 2));
  } catch (error) {
    const cleanup = createdBoardId
      ? await attemptCleanup(client, createdBoardId, config.page.waitTimeoutMs)
      : { attempted: false, ok: true };
    const reportPath = path.join(artifactRoot, `${artifactSlug}-${artifactStamp}-failed.json`);
    const failureReport = {
      ok: false,
      configPath: config.configPath,
      capturedAt: new Date().toISOString(),
      baseUrl: config.baseUrl,
      boardLifecycle: {
        createdTitle: lifecycleTitles.createdTitle,
        editedTitle: lifecycleTitles.editedTitle,
        lastKnownBoardId: createdBoardId,
        lastKnownBoardTitle: createdBoardTitle
      },
      error: {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      },
      cleanup,
      steps: stepReports
    };

    await fs.writeFile(reportPath, `${JSON.stringify(failureReport, null, 2)}\n`);
    throw error;
  } finally {
    collector.dispose();
  }
} finally {
  await client.close();
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

async function loadWorkspaceSnapshot(client) {
  const response = await readWorkspaceSnapshot(client);

  if (!response?.ok || !response?.body?.workspace) {
    throw new Error(`Unable to load live workspace snapshot (status ${response?.status ?? 'unknown'}).`);
  }

  return response.body;
}

async function waitForWorkspaceState(client, predicate, { timeoutMs, description }, predicateContext) {
  const deadline = Date.now() + timeoutMs;
  let lastWorkspace = null;

  while (Date.now() < deadline) {
    const snapshot = await loadWorkspaceSnapshot(client);
    const workspace = snapshot.workspace;
    lastWorkspace = workspace;

    if (predicate({ workspace, snapshot, ...predicateContext })) {
      return snapshot;
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for workspace state: ${description}. Last active board: ${lastWorkspace?.ui?.activeBoardId ?? 'unknown'}.`);
}

async function openBoardOptionsDialog(client) {
  const dialogState = await evaluateFunction(client, () => ({
    open: Boolean(document.querySelector('[data-controller="board-options"]')?.open)
  }));

  if (!dialogState?.open) {
    await clickSelector(client, '[data-action="workspace#openBoardOptions"]');
  }

  await waitForSelector(client, '[data-controller="board-options"][open]');
}

async function ensureActiveBoardById(client, boardId, timeoutMs) {
  const snapshot = await loadWorkspaceSnapshot(client);

  if (snapshot.workspace?.ui?.activeBoardId === boardId) {
    return;
  }

  await openBoardOptionsDialog(client);
  const result = await evaluateFunction(client, ({ boardId: targetBoardId }) => {
    const switchButtons = Array.from(document.querySelectorAll('[data-board-options-field="switchButton"]'));
    const targetButton = switchButtons.find((button) => button.dataset.boardId === targetBoardId && !button.hidden);

    if (!targetButton) {
      return {
        switched: false
      };
    }

    targetButton.click();
    return {
      switched: true
    };
  }, {
    boardId
  });

  if (!result?.switched) {
    throw new Error(`Unable to switch to board ${boardId}.`);
  }

  await waitForWorkspaceState(
    client,
    ({ workspace, boardId: targetBoardId }) => workspace?.ui?.activeBoardId === targetBoardId,
    {
      timeoutMs,
      description: `switch to board ${boardId}`
    },
    {
      boardId
    }
  );
}

async function openActiveBoardEditor(client, timeoutMs) {
  await openBoardOptionsDialog(client);
  await clickSelector(client, '[data-board-options-field="editButton"]:not([hidden])');
  await waitForSelector(client, '[data-controller="board-editor"][open]', timeoutMs);
}

async function fillBoardEditorForm(client, {
  title,
  sourceLocale,
  defaultLocale,
  supportedLocales,
  requiredLocales,
  stageDefinitions
}) {
  await setFormValue(client, '[data-board-editor-target="titleInput"]', title);
  await setFormValue(client, '[data-board-editor-target="sourceLocaleInput"]', sourceLocale);
  await setFormValue(client, '[data-board-editor-target="defaultLocaleInput"]', defaultLocale);
  await setFormValue(client, '[data-board-editor-target="supportedLocalesInput"]', supportedLocales.join(', '));
  await setFormValue(client, '[data-board-editor-target="requiredLocalesInput"]', requiredLocales.join(', '));
  await setFormValue(client, '[data-board-editor-target="stageDefinitionsInput"]', stageDefinitions.join('\n'));
}

async function assertBoardEditorTargetsBoard(client, boardId) {
  const editorState = await evaluateFunction(client, () => ({
    boardId: document.querySelector('[data-board-editor-target="boardIdInput"]')?.value ?? '',
    mode: document.querySelector('[data-board-editor-target="modeInput"]')?.value ?? ''
  }));

  if (editorState?.mode !== 'edit' || editorState?.boardId !== boardId) {
    throw new Error(`Board editor is not targeting expected board ${boardId}.`);
  }
}

async function assertDeleteButtonTargetsBoard(client, boardId) {
  const deleteState = await evaluateFunction(client, () => ({
    boardId: document.querySelector('[data-board-editor-target="deleteButton"]')?.dataset.boardId ?? '',
    hidden: Boolean(document.querySelector('[data-board-editor-target="deleteActions"]')?.hidden)
  }));

  if (deleteState?.hidden || deleteState?.boardId !== boardId) {
    throw new Error(`Delete action is not targeting expected board ${boardId}.`);
  }
}

async function captureLifecycleStep(client, {
  artifactRoot,
  artifactSlug,
  artifactStamp,
  label,
  summary,
  detail = {},
  stepReports
}) {
  const sanitizedLabel = sanitizeArtifactLabel(label);
  const screenshotPath = path.join(artifactRoot, `${artifactSlug}-${artifactStamp}-${sanitizedLabel}.png`);
  const page = await getPageSummary(client);
  const selectorSnapshots = await inspectSelectors(client, {
    workspaceRoot: { selector: '[data-controller="workspace"]' },
    boardTitle: { selector: '[data-workspace-target="boardTitle"]' },
    boardOptionsDialog: { selector: '[data-controller="board-options"][open]' },
    boardEditorDialog: { selector: '[data-controller="board-editor"][open]' },
    confirmDialog: { selector: '[data-workspace-target="confirmDialog"][open]' }
  });
  const screenshotBuffer = await captureScreenshot(client);

  await fs.writeFile(screenshotPath, screenshotBuffer);

  stepReports.push({
    label,
    capturedAt: new Date().toISOString(),
    screenshotPath,
    page,
    selectorSnapshots,
    workspace: summary,
    detail
  });
}

async function attemptCleanup(client, boardId, timeoutMs) {
  try {
    const snapshot = await loadWorkspaceSnapshot(client);

    if (!snapshot.workspace?.boards?.[boardId]) {
      return {
        attempted: true,
        ok: true,
        skipped: 'board-already-absent'
      };
    }

    if ((snapshot.workspace?.boardOrder?.length ?? 0) < 2) {
      return {
        attempted: true,
        ok: false,
        skipped: 'last-remaining-board'
      };
    }

    await ensureActiveBoardById(client, boardId, timeoutMs);
    await openActiveBoardEditor(client, timeoutMs);
    await assertBoardEditorTargetsBoard(client, boardId);
    await assertDeleteButtonTargetsBoard(client, boardId);
    await clickSelector(client, '[data-board-editor-target="deleteButton"]');
    await waitForSelector(client, '[data-workspace-target="confirmDialog"][open]', timeoutMs);
    await clickSelector(client, '[data-workspace-target="confirmButton"]');
    await waitForWorkspaceState(
      client,
      ({ workspace, boardId: targetBoardId }) => !workspace?.boards?.[targetBoardId],
      {
        timeoutMs,
        description: `cleanup delete board ${boardId}`
      },
      {
        boardId
      }
    );

    return {
      attempted: true,
      ok: true
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: error?.message ?? String(error)
    };
  }
}

function extractFirstStageTitle(stageDefinitions) {
  const firstStageDefinition = Array.isArray(stageDefinitions) ? stageDefinitions[0] : '';
  return String(firstStageDefinition)
    .split('|')
    .map((segment) => segment.trim())[1] ?? '';
}

function delay(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
