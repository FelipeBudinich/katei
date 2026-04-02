#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createArtifactStamp,
  normalizeCapturedArtifacts,
  sanitizeArtifactLabel
} from './lib/artifacts.mjs';
import {
  captureScreenshot,
  connectToTarget,
  createPageEventCollector,
  enablePageDomainSet,
  findInspectablePageTarget,
  getPageSummary,
  inspectSelectors,
  waitForSelector
} from './lib/cdp.mjs';
import { loadKateiAuthDebugConfig, parseCliArgs } from './lib/config.mjs';

const { configPath } = parseCliArgs();
const config = await loadKateiAuthDebugConfig({ configPath });
const pageTarget = await findInspectablePageTarget(config.chrome.remoteDebuggingPort, {
  targetUrlPrefix: config.baseUrl
});

if (!pageTarget) {
  throw new Error(`No Chrome page target is open for ${config.baseUrl}. Run open-authenticated-page.mjs first.`);
}

const client = await connectToTarget(pageTarget);

try {
  await enablePageDomainSet(client);

  const collector = createPageEventCollector(client);

  try {
    await waitForSelector(client, config.page.waitForSelector, config.page.waitTimeoutMs);

    const pageSummary = await getPageSummary(client);
    const selectorSnapshots = await inspectSelectors(client, config.page.inspectSelectors);
    const screenshotBuffer = await captureScreenshot(client);
    const artifactStamp = createArtifactStamp();
    const artifactSlug = sanitizeArtifactLabel(new URL(config.baseUrl).hostname);
    const artifactRoot = config.page.artifactDir;
    const screenshotPath = path.join(artifactRoot, `${artifactSlug}-${artifactStamp}.png`);
    const reportPath = path.join(artifactRoot, `${artifactSlug}-${artifactStamp}.json`);
    const latestSessionPath = path.join(artifactRoot, 'latest-session.json');
    const initialNavigation = await readJsonIfPresent(latestSessionPath);
    const report = {
      ok: true,
      configPath: config.configPath,
      capturedAt: new Date().toISOString(),
      page: pageSummary,
      initialNavigation,
      ...normalizeCapturedArtifacts({
        consoleEntries: collector.consoleEntries,
        pageErrors: collector.pageErrors,
        failedRequests: collector.failedRequests,
        selectorSnapshots
      })
    };

    await fs.mkdir(artifactRoot, { recursive: true });
    await fs.writeFile(screenshotPath, screenshotBuffer);
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({
      ok: true,
      screenshotPath,
      reportPath,
      page: pageSummary
    }, null, 2));
  } finally {
    collector.dispose();
  }
} finally {
  await client.close();
}

async function readJsonIfPresent(filePath) {
  try {
    const rawText = await fs.readFile(filePath, 'utf8');
    return JSON.parse(rawText);
  } catch (error) {
    return null;
  }
}
