import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_CONFIG_RELATIVE,
  runCli as generateRunCli,
} from "../scripts/generate-env-inventory.mjs";
import {
  HTML_REPORT_RELATIVE,
  renderEnvInventoryHtml,
  runCli as renderRunCli,
} from "../scripts/render-env-inventory-html.mjs";

const FIXTURE_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "fixtures",
  "smoke-repo"
);

async function copyFixtureRepo() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "env-inventory-html-"));
  await fs.cp(FIXTURE_ROOT, tempRoot, { recursive: true });
  return tempRoot;
}

test("renderEnvInventoryHtml highlights config warnings, fallback groups, gaps, and dynamic access", () => {
  const report = {
    app: {
      name: "demo",
      path: "apps/demo",
      outputPath: "apps/demo/docs/env-inventory.json",
    },
    scan: {
      config: {
        path: ".agents/env-inventory.config.json",
        exists: false,
      },
      roots: {
        app: ["apps/demo/src", "apps/demo/doc"],
        package: ["packages/shared/src"],
        root: [".github/workflows"],
      },
      ignoredGlobs: ["**/node_modules/**"],
    },
    summary: {
      totalVariables: 3,
      totalDefinitions: 2,
      totalUsages: 4,
      secretLikeCount: 1,
      publicLikeCount: 1,
      dynamicAccessCount: 1,
    },
    variables: [
      {
        name: "APP_SECRET",
        secretLike: true,
        publicLike: false,
        definitions: [
          {
            kind: "envFile",
            file: "apps/demo/.env.example",
            line: 1,
            scope: "app",
            comment: "# Demo app secret",
            snippet: "APP_SECRET=replace-me",
          },
        ],
        usages: [
          {
            kind: "validation",
            file: "apps/demo/src/config/env.js",
            line: 4,
            scope: "app",
            snippet: "APP_SECRET: source.APP_SECRET",
          },
        ],
      },
      {
        name: "PUBLIC_BASE_URL",
        secretLike: false,
        publicLike: true,
        definitions: [],
        usages: [
          {
            kind: "default",
            file: "apps/demo/src/config/env.js",
            line: 8,
            scope: "app",
            snippet: "PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || \"https://example.test\"",
          },
        ],
      },
      {
        name: "SHARED_FLAG",
        secretLike: false,
        publicLike: false,
        definitions: [],
        usages: [
          {
            kind: "read",
            file: "packages/shared/src/index.js",
            line: 3,
            scope: "package",
            snippet: "process.env.SHARED_FLAG",
          },
        ],
      },
    ],
    dynamicAccesses: [
      {
        file: "apps/demo/src/config/env.js",
        line: 12,
        scope: "app",
        snippet: "process.env[key]",
        reason: "computed member access",
      },
    ],
    scanWarnings: ["Skipped malformed docs snippet"],
  };

  const html = renderEnvInventoryHtml(report);

  assert.match(html, /<title>Env inventory · demo<\/title>/);
  assert.match(html, /Env inventory report/);
  assert.match(html, /href="\/assets\/app\.css"/);
  assert.match(html, /class="app-shell"/);
  assert.match(html, /class="top-bar"/);
  assert.match(html, /class="top-bar-title-row env-inventory-title-row"/);
  assert.match(html, /<a class="touch-button-secondary" href="\/">demo<\/a>/);
  assert.match(html, /<tbody id="variable-table-body" class="text-sm leading-6">/);
  assert.match(html, /data-copy-raw/);
  assert.match(html, /data-copy-target="scan-details-raw-json"/);
  assert.match(html, /<pre id="scan-details-raw-json" class="env-inventory-raw text-sm leading-6" data-copy-source>/);
  assert.match(html, /navigator\.clipboard\.writeText/);
  assert.match(html, /# Demo app secret/);
  assert.match(html, /<div class="env-inventory-snippet">\s*<div class="text-sm leading-6 text-muted"># Demo app secret<\/div>\s*<code class="env-inventory-inline-code">APP_SECRET=replace-me<\/code>/);
  assert.match(html, /Config warning:/);
  assert.match(html, /No fallback observed/);
  assert.match(html, /Fallbacks observed/);
  assert.match(html, /Missing example\/docs/);
  assert.match(html, /Dynamic env access/);
  assert.match(html, /apps\/demo\/docs\/env-inventory\.html/);
  assert.doesNotMatch(html, /Config found/);
  assert.doesNotMatch(html, /Back to board/);
  assert.doesNotMatch(html, /count-chip env-inventory-chip px-3 py-1 text-sm font-medium/);
  assert.doesNotMatch(html, /Likely required/);
  assert.doesNotMatch(html, /<style>/);
});

test("generator --html writes per-app HTML reports and no root aggregate", async () => {
  const repoRoot = await copyFixtureRepo();

  const exitCode = await generateRunCli([
    "--root",
    repoRoot,
    "--apps-root",
    "./apps",
    "--all-apps",
    "--config",
    DEFAULT_CONFIG_RELATIVE,
    "--html",
  ]);

  assert.equal(exitCode, 0);
  assert.equal(await fileExists(path.join(repoRoot, "apps", "app-a", HTML_REPORT_RELATIVE)), true);
  assert.equal(await fileExists(path.join(repoRoot, "apps", "app-b", HTML_REPORT_RELATIVE)), true);
  assert.equal(await fileExists(path.join(repoRoot, "docs", "env-inventory.html")), false);
});

test("standalone renderer reads JSON input and supports --check", async () => {
  const repoRoot = await copyFixtureRepo();

  const generateExit = await generateRunCli([
    "--root",
    repoRoot,
    "--apps-root",
    "./apps",
    "--app",
    "app-a",
    "--config",
    DEFAULT_CONFIG_RELATIVE,
  ]);
  assert.equal(generateExit, 0);

  const staleExit = await renderRunCli([
    "--input",
    path.join(repoRoot, "apps", "app-a", "docs", "env-inventory.json"),
    "--output",
    path.join(repoRoot, "apps", "app-a", "docs", "env-inventory.html"),
    "--check",
  ]);
  assert.equal(staleExit, 1);

  const renderExit = await renderRunCli([
    "--input",
    path.join(repoRoot, "apps", "app-a", "docs", "env-inventory.json"),
    "--output",
    path.join(repoRoot, "apps", "app-a", "docs", "env-inventory.html"),
  ]);
  assert.equal(renderExit, 0);

  const html = await fs.readFile(path.join(repoRoot, "apps", "app-a", "docs", "env-inventory.html"), "utf8");
  assert.match(html, /<title>Env inventory · app-a<\/title>/);
  assert.match(html, /Env inventory report/);
  assert.match(html, /Variable explorer/);
  assert.match(html, /href="\/assets\/app\.css"/);
  assert.match(html, /class="app-shell"/);
  assert.doesNotMatch(html, /<style>/);

  const cleanExit = await renderRunCli([
    "--input",
    path.join(repoRoot, "apps", "app-a", "docs", "env-inventory.json"),
    "--output",
    path.join(repoRoot, "apps", "app-a", "docs", "env-inventory.html"),
    "--check",
  ]);
  assert.equal(cleanExit, 0);
});

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
