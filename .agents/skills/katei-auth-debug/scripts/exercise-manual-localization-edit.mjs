#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  createArtifactStamp,
  normalizeCapturedArtifacts,
  sanitizeArtifactLabel
} from './lib/artifacts.mjs';
import { obtainKateiSession } from './lib/auth.mjs';
import { loadKateiAuthDebugConfig, parseCliArgs } from './lib/config.mjs';
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
  readWorkspaceSnapshot,
  setFormValue,
  setSessionCookie,
  submitSelector,
  waitForSelector,
  waitForText
} from './lib/cdp.mjs';

const { configPath } = parseCliArgs();
const config = await loadKateiAuthDebugConfig({ configPath });
const session = await obtainKateiSession({ config });
const artifactStamp = createArtifactStamp();
const artifactSlug = sanitizeArtifactLabel(`${new URL(config.baseUrl).hostname}-manual-localization-edit`);
const artifactRoot = config.page.artifactDir;
const boardTitle = `Codex Manual Locale ${artifactStamp}`;
const sourceTitle = `Manual locale source ${artifactStamp}`;
const sourceDetails = `English source details ${artifactStamp}`;
const localizedTitle = `Titulo manual ${artifactStamp}`;
const localizedDetails = `Detalles manuales ${artifactStamp}`;

await fs.mkdir(artifactRoot, { recursive: true });

const target = await getOrCreateInspectablePageTarget(config.chrome.remoteDebuggingPort);
const client = await connectToTarget(target);
const stepReports = [];
let createdBoardId = null;

try {
  await enablePageDomainSet(client);
  const collector = createPageEventCollector(client);

  try {
    await ensureAuthenticatedWorkspacePage(client, config, session);
    await createBoardWithoutAi(client, boardTitle, config.page.waitTimeoutMs);

    const createBoardSnapshot = await waitForWorkspaceState(
      client,
      ({ workspace, expectedTitle }) => {
        const board = Object.values(workspace?.boards ?? {}).find((candidate) => candidate?.title === expectedTitle);
        return Boolean(board && workspace?.ui?.activeBoardId === board.id);
      },
      {
        timeoutMs: config.page.waitTimeoutMs,
        description: `create board ${boardTitle}`
      },
      {
        expectedTitle: boardTitle
      }
    );

    createdBoardId = createBoardSnapshot.workspace.ui.activeBoardId;

    await captureStep(client, stepReports, {
      artifactRoot,
      artifactSlug,
      artifactStamp,
      label: 'board-created'
    });

    await createSourceCard(client, {
      title: sourceTitle,
      detailsMarkdown: sourceDetails,
      timeoutMs: config.page.waitTimeoutMs
    });

    const createCardSnapshot = await waitForWorkspaceState(
      client,
      ({ workspace, boardId, expectedTitle }) => {
        const board = workspace?.boards?.[boardId];
        return Object.values(board?.cards ?? {}).some((card) => card?.contentByLocale?.en?.title === expectedTitle);
      },
      {
        timeoutMs: config.page.waitTimeoutMs,
        description: `create card ${sourceTitle}`
      },
      {
        boardId: createdBoardId,
        expectedTitle: sourceTitle
      }
    );

    const createdCard = Object.values(createCardSnapshot.workspace.boards[createdBoardId].cards).find(
      (card) => card?.contentByLocale?.en?.title === sourceTitle
    );

    if (!createdCard?.id) {
      throw new Error(`Unable to resolve created card for ${sourceTitle}.`);
    }

    const cardId = createdCard.id;

    await openCardEditorFor(client, cardId, config.page.waitTimeoutMs);
    await selectEditorLocale(client, 'es');

    const missingLocaleState = await readCardEditorState(client);

    if (missingLocaleState.titleValue !== '' || missingLocaleState.detailsValue !== '') {
      throw new Error('Missing locale fields were not blank in the manual edit state.');
    }

    if (missingLocaleState.generateButtonVisible) {
      throw new Error('Generate button should not be visible when the board has no AI configuration.');
    }

    if (!missingLocaleState.saveControlsVisible) {
      throw new Error('Save controls should remain visible for manual locale editing.');
    }

    if (!missingLocaleState.helpText.includes('manual')) {
      throw new Error(`Expected manual-edit help text, received: ${missingLocaleState.helpText}`);
    }

    await captureStep(client, stepReports, {
      artifactRoot,
      artifactSlug,
      artifactStamp,
      label: 'missing-locale-editable',
      detail: missingLocaleState
    });

    await setFormValue(client, '[data-card-editor-target="titleInput"]', localizedTitle);
    await setFormValue(client, '[data-card-editor-target="markdownInput"]', localizedDetails);
    await submitSelector(client, '[data-card-editor-target="form"]');

    await waitForWorkspaceState(
      client,
      ({ workspace, boardId, cardId: targetCardId, expectedTitle }) => {
        const card = workspace?.boards?.[boardId]?.cards?.[targetCardId];
        return card?.contentByLocale?.es?.title === expectedTitle;
      },
      {
        timeoutMs: config.page.waitTimeoutMs,
        description: `save locale es for card ${cardId}`
      },
      {
        boardId: createdBoardId,
        cardId,
        expectedTitle: localizedTitle
      }
    );

    await waitForText(
      client,
      `[data-card-id="${cardId}"] [data-card-field="title"]`,
      localizedTitle,
      config.page.waitTimeoutMs,
      { exact: true }
    );

    await openCardViewFor(client, cardId, config.page.waitTimeoutMs);

    const viewState = await readCardViewState(client);

    if (viewState.title !== localizedTitle) {
      throw new Error(`View dialog did not render the saved locale. Received: ${viewState.title}`);
    }

    await captureStep(client, stepReports, {
      artifactRoot,
      artifactSlug,
      artifactStamp,
      label: 'view-dialog-localized',
      detail: viewState
    });

    await clickSelector(client, '[data-action="workspace#closeViewDialog"]');

    await openCardEditorFor(client, cardId, config.page.waitTimeoutMs);

    const editState = await readCardEditorState(client);

    if (editState.selectedLocale !== 'es' || editState.titleValue !== localizedTitle || editState.detailsValue !== localizedDetails) {
      throw new Error('Edit dialog did not reopen on the saved localized variant.');
    }

    await captureStep(client, stepReports, {
      artifactRoot,
      artifactSlug,
      artifactStamp,
      label: 'edit-dialog-localized',
      detail: editState
    });

    await clickSelector(client, '[data-action="card-editor#close"]');

    const viewerCheck = await attemptViewerCheck(client, config.page.waitTimeoutMs);

    await captureStep(client, stepReports, {
      artifactRoot,
      artifactSlug,
      artifactStamp,
      label: 'viewer-check',
      detail: viewerCheck
    });

    const report = {
      ok: true,
      configPath: config.configPath,
      baseUrl: config.baseUrl,
      targetUrl: config.targetUrl,
      capturedAt: new Date().toISOString(),
      board: {
        id: createdBoardId,
        title: boardTitle
      },
      card: {
        id: cardId,
        sourceTitle,
        localizedLocale: 'es',
        localizedTitle
      },
      steps: stepReports,
      ...normalizeCapturedArtifacts({
        consoleEntries: collector.consoleEntries,
        pageErrors: collector.pageErrors,
        failedRequests: collector.failedRequests
      })
    };

    const reportPath = path.join(artifactRoot, `${artifactSlug}-${artifactStamp}.json`);
    const latestReportPath = path.join(artifactRoot, 'latest-manual-localization-edit.json');

    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    await fs.writeFile(latestReportPath, `${JSON.stringify(report, null, 2)}\n`);

    console.log(JSON.stringify({
      ok: true,
      reportPath,
      latestReportPath,
      boardId: createdBoardId,
      steps: stepReports.map((step) => step.label)
    }, null, 2));
  } finally {
    collector.dispose();
  }
} finally {
  if (createdBoardId) {
    await attemptCleanup(client, createdBoardId, config.page.waitTimeoutMs);
  }

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

async function waitForWorkspaceState(client, predicate, { timeoutMs, description }, predicateContext = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const snapshot = await loadWorkspaceSnapshot(client);

    if (predicate({ workspace: snapshot.workspace, snapshot, ...predicateContext })) {
      return snapshot;
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for workspace state: ${description}.`);
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

async function createBoardWithoutAi(client, title, timeoutMs) {
  await openBoardOptionsDialog(client);
  await clickSelector(client, '[data-action="board-options#createBoard"]');
  await waitForSelector(client, '[data-controller="board-editor"][open]', timeoutMs);
  await setFormValue(client, '[data-board-editor-target="titleInput"]', title);
  await setFormValue(client, '[data-board-editor-target="sourceLocaleInput"]', 'en');
  await setFormValue(client, '[data-board-editor-target="defaultLocaleInput"]', 'en');
  await setFormValue(client, '[data-board-editor-target="supportedLocalesInput"]', 'en, es, ja');
  await setFormValue(client, '[data-board-editor-target="requiredLocalesInput"]', 'en');
  await submitSelector(client, '[data-board-editor-target="form"]');
  await waitForText(client, '[data-workspace-target="boardTitle"]', title, timeoutMs, { exact: true });
}

async function createSourceCard(client, { title, detailsMarkdown, timeoutMs }) {
  await clickSelector(client, '[data-workspace-target="createCardButton"]');
  await waitForSelector(client, '[data-controller="card-editor"][open]', timeoutMs);
  await setFormValue(client, '[data-card-editor-target="titleInput"]', title);
  await setFormValue(client, '[data-card-editor-target="markdownInput"]', detailsMarkdown);
  await submitSelector(client, '[data-card-editor-target="form"]');
}

async function openCardEditorFor(client, cardId, timeoutMs) {
  await clickSelector(client, `[data-card-id="${cardId}"] [data-card-field="editButton"]`);
  await waitForSelector(client, '[data-controller="card-editor"][open]', timeoutMs);
}

async function openCardViewFor(client, cardId, timeoutMs) {
  await clickSelector(client, `[data-card-id="${cardId}"] [data-action="workspace#openView"]`);
  await waitForSelector(client, '[data-workspace-target="viewDialog"][open]', timeoutMs);
}

async function selectEditorLocale(client, locale) {
  await setFormValue(client, '[data-card-editor-target="localeSelect"]', locale);
}

async function readCardEditorState(client) {
  return evaluateFunction(client, () => {
    const dialog = document.querySelector('[data-controller="card-editor"]');
    const titleInput = dialog?.querySelector('[data-card-editor-target="titleInput"]');
    const markdownInput = dialog?.querySelector('[data-card-editor-target="markdownInput"]');
    const localeSelect = dialog?.querySelector('[data-card-editor-target="localeSelect"]');
    const generateButton = dialog?.querySelector('[data-card-editor-target="generateLocaleButton"]');
    const submitActions = dialog?.querySelector('[data-card-editor-target="submitActions"]');
    const help = dialog?.querySelector('[data-card-editor-target="generateLocaleHelp"]');
    const fallbackNotice = dialog?.querySelector('[data-card-editor-target="localeFallbackNotice"]');
    const localeSummary = dialog?.querySelector('[data-card-editor-target="localeSummary"]');
    const localeEditSummary = dialog?.querySelector('[data-card-editor-target="localeEditSummary"]');

    return {
      selectedLocale: localeSelect?.value ?? '',
      titleValue: titleInput?.value ?? '',
      detailsValue: markdownInput?.value ?? '',
      generateButtonVisible: Boolean(generateButton && !generateButton.hidden),
      saveControlsVisible: Boolean(submitActions && !submitActions.hidden),
      helpText: (help?.hidden ? '' : (help?.textContent ?? '')).trim(),
      fallbackNotice: (fallbackNotice?.hidden ? '' : (fallbackNotice?.textContent ?? '')).trim(),
      localeSummary: (localeSummary?.textContent ?? '').trim(),
      localeEditSummary: (localeEditSummary?.textContent ?? '').trim()
    };
  });
}

async function readCardViewState(client) {
  return evaluateFunction(client, () => {
    const dialog = document.querySelector('[data-workspace-target="viewDialog"]');
    const localeSelect = dialog?.querySelector('[data-workspace-target="viewLocaleSelect"]');

    return {
      title: (dialog?.querySelector('[data-workspace-target="viewCardTitle"]')?.textContent ?? '').trim(),
      body: (dialog?.querySelector('[data-workspace-target="viewCardBody"]')?.textContent ?? '').trim(),
      selectedLocale: localeSelect?.value ?? '',
      localeVisible: Boolean(localeSelect && !localeSelect.hidden)
    };
  });
}

async function attemptViewerCheck(client, timeoutMs) {
  const snapshot = await loadWorkspaceSnapshot(client);
  const currentWorkspaceId = snapshot.workspace?.workspaceId ?? null;
  const currentBoardId = snapshot.workspace?.ui?.activeBoardId ?? null;

  const viewerBoard = await evaluateFunction(client, () => {
    const buttons = Array.from(document.querySelectorAll('[data-card-field="editButton"]'));
    return {
      hasCards: buttons.length > 0
    };
  });

  await openBoardOptionsDialog(client);

  const viewerSwitchResult = await evaluateFunction(client, ({ currentWorkspaceId, currentBoardId }) => {
    const buttons = Array.from(document.querySelectorAll('[data-board-options-field="switchButton"]'));
    const targetButton = buttons.find((button) => {
      const item = button.closest('li');
      const state = (item?.querySelector('[data-board-options-field="state"]')?.textContent ?? '').trim().toLowerCase();

      return (
        state.includes('viewer')
        || state.includes('lector')
        || state.includes('閲覧')
      ) && (
        button.dataset.workspaceId !== currentWorkspaceId
        || button.dataset.boardId !== currentBoardId
      );
    }) ?? null;

    if (!targetButton) {
      return { switched: false };
    }

    const target = {
      boardId: targetButton.dataset.boardId ?? '',
      workspaceId: targetButton.dataset.workspaceId ?? ''
    };

    targetButton.click();

    return {
      switched: true,
      target
    };
  }, {
    currentWorkspaceId,
    currentBoardId
  });

  if (!viewerSwitchResult?.switched) {
    return {
      skipped: 'no-viewer-board-found',
      currentBoardHasCards: viewerBoard.hasCards
    };
  }

  await waitForWorkspaceState(
    client,
    ({ workspace, target }) => {
      return workspace?.ui?.activeBoardId === target.boardId
        && workspace?.workspaceId === target.workspaceId;
    },
    {
      timeoutMs,
      description: 'switch to viewer board'
    },
    {
      target: viewerSwitchResult.target
    }
  );

  const result = await evaluateFunction(client, () => {
    const createCardButton = document.querySelector('[data-workspace-target="createCardButton"]');
    const viewButton = document.querySelector('[data-action="workspace#openView"]');
    const editButton = document.querySelector('[data-card-field="editButton"]');

    if (viewButton) {
      viewButton.click();
    }

    return {
      createCardHidden: Boolean(createCardButton?.hidden),
      hasViewButton: Boolean(viewButton),
      hasEditButton: Boolean(editButton)
    };
  });

  if (result.hasViewButton) {
    await waitForSelector(client, '[data-workspace-target="viewDialog"][open]', timeoutMs);
  }

  return result;
}

async function captureStep(client, stepReports, {
  artifactRoot,
  artifactSlug,
  artifactStamp,
  label,
  detail = null
}) {
  const sanitizedLabel = sanitizeArtifactLabel(label);
  const screenshotPath = path.join(artifactRoot, `${artifactSlug}-${artifactStamp}-${sanitizedLabel}.png`);
  const page = await getPageSummary(client);
  const selectorSnapshots = await inspectSelectors(client, {
    workspaceRoot: { selector: '[data-controller="workspace"]' },
    boardTitle: { selector: '[data-workspace-target="boardTitle"]' },
    cardEditor: { selector: '[data-controller="card-editor"][open]' },
    cardViewDialog: { selector: '[data-workspace-target="viewDialog"][open]' }
  });
  const screenshotBuffer = await captureScreenshot(client);

  await fs.writeFile(screenshotPath, screenshotBuffer);

  stepReports.push({
    label,
    capturedAt: new Date().toISOString(),
    screenshotPath,
    page,
    selectorSnapshots,
    detail
  });
}

async function attemptCleanup(client, boardId, timeoutMs) {
  try {
    const snapshot = await loadWorkspaceSnapshot(client);

    if (!snapshot.workspace?.boards?.[boardId]) {
      return;
    }

    await openBoardOptionsDialog(client);

    const switched = await evaluateFunction(client, ({ boardId }) => {
      const buttons = Array.from(document.querySelectorAll('[data-board-options-field="switchButton"]'));
      const targetButton = buttons.find((button) => button.dataset.boardId === boardId) ?? null;

      if (!targetButton) {
        return { ok: false };
      }

      targetButton.click();

      return { ok: true };
    }, {
      boardId
    });

    if (switched?.ok) {
      await waitForWorkspaceState(
        client,
        ({ workspace, boardId }) => workspace?.ui?.activeBoardId === boardId,
        {
          timeoutMs,
          description: `switch back to cleanup board ${boardId}`
        },
        {
          boardId
        }
      );
    }

    await openBoardOptionsDialog(client);
    await clickSelector(client, '[data-board-options-field="editButton"]:not([hidden])');
    await waitForSelector(client, '[data-controller="board-editor"][open]', timeoutMs);
    await clickSelector(client, '[data-board-editor-target="deleteButton"]');
    await waitForSelector(client, '[data-workspace-target="confirmDialog"][open]', timeoutMs);
    await clickSelector(client, '[data-workspace-target="confirmButton"]');
    await waitForWorkspaceState(
      client,
      ({ workspace, boardId }) => !workspace?.boards?.[boardId],
      {
        timeoutMs,
        description: `delete cleanup board ${boardId}`
      },
      {
        boardId
      }
    );
  } catch (_error) {
    // Best-effort cleanup only.
  }
}

function delay(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
