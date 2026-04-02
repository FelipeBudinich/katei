#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeCapturedArtifacts } from './lib/artifacts.mjs';
import { obtainKateiSession } from './lib/auth.mjs';
import {
  captureScreenshot,
  connectToTarget,
  createPageEventCollector,
  enablePageDomainSet,
  getOrCreateInspectablePageTarget,
  getPageSummary,
  navigateToUrl,
  setSessionCookie,
  waitForSelector
} from './lib/cdp.mjs';
import { loadKateiAuthDebugConfig, parseCliArgs } from './lib/config.mjs';

const { configPath } = parseCliArgs();
const config = await loadKateiAuthDebugConfig({ configPath });
const session = await obtainKateiSession({ config });
const target = await getOrCreateInspectablePageTarget(config.chrome.remoteDebuggingPort);
const client = await connectToTarget(target);

try {
  await enablePageDomainSet(client);

  const collector = createPageEventCollector(client);

  try {
    await setSessionCookie(client, {
      url: config.baseUrl,
      name: session.cookieName,
      value: session.cookieValue
    });
    await navigateToUrl(client, config.targetUrl, config.page.waitTimeoutMs);
    await waitForSelector(client, config.page.waitForSelector, config.page.waitTimeoutMs);

    await fs.mkdir(config.page.artifactDir, { recursive: true });

    const pageSummary = await getPageSummary(client);
    const screenshotBuffer = await captureScreenshot(client);
    const screenshotPath = path.join(config.page.artifactDir, 'latest-open.png');
    const sessionPath = path.join(config.page.artifactDir, 'latest-session.json');
    const navigationArtifacts = normalizeCapturedArtifacts({
      consoleEntries: collector.consoleEntries,
      pageErrors: collector.pageErrors,
      failedRequests: collector.failedRequests
    });
    const output = {
      ok: true,
      mode: session.mode,
      configPath: config.configPath,
      targetUrl: config.targetUrl,
      page: pageSummary,
      waitForSelector: config.page.waitForSelector,
      viewer: session.viewer,
      redirectTo: session.redirectTo,
      screenshotPath,
      navigationArtifacts
    };

    await fs.writeFile(screenshotPath, screenshotBuffer);
    await fs.writeFile(sessionPath, `${JSON.stringify(output, null, 2)}\n`);
    console.log(JSON.stringify({
      ...output,
      sessionPath
    }, null, 2));
  } finally {
    collector.dispose();
  }
} finally {
  await client.close();
}
