import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_CONFIG_RELATIVE,
  REPORT_RELATIVE,
  discoverApps,
  discoverWorkspaceProjects,
  extractImports,
  generateEnvInventory,
  loadConfig,
  runCli,
} from "../scripts/generate-env-inventory.mjs";

const FIXTURE_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "fixtures",
  "smoke-repo"
);

async function copyFixtureRepo() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "env-inventory-"));
  await fs.cp(FIXTURE_ROOT, tempRoot, { recursive: true });
  return tempRoot;
}

test("extractImports finds import, export, require, and static dynamic import", () => {
  const source = `
import foo from "./foo.js";
export { bar } from "./bar.js";
const baz = require("./baz.js");
await import("./qux.js");
`;
  const imports = extractImports(source, "apps/app-a/src/index.js");
  assert.deepEqual(
    imports.map((entry) => [entry.kind, entry.specifier]),
    [
      ["import", "./foo.js"],
      ["export", "./bar.js"],
      ["require", "./baz.js"],
      ["dynamic-import", "./qux.js"],
    ]
  );
});

test("discoverApps and discoverWorkspaceProjects follow the fixture workspace layout", async () => {
  const repoRoot = await copyFixtureRepo();
  const apps = await discoverApps(repoRoot, "apps");
  const projects = await discoverWorkspaceProjects(repoRoot, apps);

  assert.deepEqual(apps.map((app) => app.name), ["app-a", "app-b"]);
  assert.deepEqual(
    projects.map((project) => [project.rootRel, project.projectName]),
    [
      ["apps/app-a", "@fixture/app-a"],
      ["apps/app-b", "@fixture/app-b"],
      ["packages/shared", "@fixture/shared"],
    ]
  );
});

test("loadConfig uses the default fixture config file when present", async () => {
  const repoRoot = await copyFixtureRepo();
  const config = await loadConfig(repoRoot, DEFAULT_CONFIG_RELATIVE);

  assert.equal(config.exists, true);
  assert.equal(config.relativePath, ".agents/env-inventory.config.json");
  assert.deepEqual(config.compiled.appPathOverrides[".github/workflows/deploy-app-a.yml"], ["app-a"]);
});

test("generateEnvInventory reports app-local, shared-package, grounded root, default/validation, compose, and dynamic env access", async () => {
  const repoRoot = await copyFixtureRepo();
  const report = await generateEnvInventory({
    repoRoot,
    appsRoot: "apps",
    appName: "app-a",
    configPath: DEFAULT_CONFIG_RELATIVE,
  });

  assert.equal(report.app.outputPath, "apps/app-a/doc/env-inventory.json");
  assert.ok(report.variables.some((entry) => entry.name === "APP_A_TOKEN" && entry.definitions.some((definition) => definition.kind === "envFile")));
  assert.ok(report.variables.some((entry) => entry.name === "APP_A_TOKEN" && entry.definitions.some((definition) => definition.snippet === "APP_A_TOKEN=replace-me" && definition.comment === "# Example token for local docs")));
  assert.ok(report.variables.some((entry) => entry.name === "PUBLIC_FLAG" && entry.definitions.some((definition) => definition.snippet === "PUBLIC_FLAG=1" && definition.comment === "# Immediate public flag note")));
  assert.equal(report.variables.every((entry) => entry.definitions.every((definition) => definition.file.endsWith(".env.example"))), true);
  assert.ok(report.variables.some((entry) => entry.name === "SHARED_TOKEN" && entry.usages.some((usage) => usage.scope === "package")));
  assert.ok(report.variables.some((entry) => entry.name === "APP_A_RUNTIME_SECRET" && entry.definitions.length === 0));
  assert.ok(report.variables.some((entry) => entry.name === "APP_A_DEPLOY_NAME" && entry.definitions.length === 0));
  assert.ok(report.variables.some((entry) => entry.name === "APP_A_DEPLOY_NAME" && entry.usages.some((usage) => usage.kind === "default")));
  assert.ok(report.variables.some((entry) => entry.name === "COMPOSE_ONLY" && entry.definitions.length === 0));
  assert.ok(report.variables.some((entry) => entry.name === "APP_A_RUNTIME_SECRET" && entry.usages.some((usage) => usage.kind === "validation")));
  assert.ok(report.dynamicAccesses.some((entry) => entry.file === "apps/app-a/src/config/env.js"));
  assert.equal(report.variables.some((entry) => entry.name === "UNGROUNDED_ROOT"), false);
  assert.equal(report.variables.some((entry) => entry.name === "GITHUB_OUTPUT"), false);
  assert.equal(report.variables.some((entry) => entry.name === "GITHUB_PATH"), false);
  assert.equal(report.variables.some((entry) => entry.name === "GITHUB_STATE"), false);

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("APP_A_TOKEN=replace-me"), true);
  assert.equal(serialized.includes("# Example token for local docs"), true);
  assert.equal(serialized.includes("# Public flag note that should not be used"), false);
});

test("generateEnvInventory keeps shared and rooted variables out of non-consuming apps unless grounded or app-scoped", async () => {
  const repoRoot = await copyFixtureRepo();
  const report = await generateEnvInventory({
    repoRoot,
    appsRoot: "apps",
    appName: "app-b",
    configPath: DEFAULT_CONFIG_RELATIVE,
  });

  assert.ok(report.variables.some((entry) => entry.name === "VITE_API_URL" && entry.publicLike));
  assert.equal(report.variables.some((entry) => entry.name === "SHARED_TOKEN"), false);
  assert.equal(report.variables.some((entry) => entry.name === "APP_A_RUNTIME_SECRET"), false);
});

test("runCli writes one app report or all app reports and does not create a root aggregate", async () => {
  const repoRoot = await copyFixtureRepo();

  const singleExit = await runCli([
    "--root",
    repoRoot,
    "--apps-root",
    "./apps",
    "--app",
    "app-a",
    "--config",
    DEFAULT_CONFIG_RELATIVE,
  ]);
  assert.equal(singleExit, 0);
  assert.equal(await fileExists(path.join(repoRoot, "apps", "app-a", REPORT_RELATIVE)), true);
  assert.equal(await fileExists(path.join(repoRoot, "apps", "app-b", REPORT_RELATIVE)), false);
  assert.equal(await fileExists(path.join(repoRoot, "doc", "env-inventory.json")), false);

  const allExit = await runCli([
    "--root",
    repoRoot,
    "--apps-root",
    "./apps",
    "--all-apps",
    "--config",
    DEFAULT_CONFIG_RELATIVE,
  ]);
  assert.equal(allExit, 0);
  assert.equal(await fileExists(path.join(repoRoot, "apps", "app-b", REPORT_RELATIVE)), true);
});

test("runCli --check fails when reports are missing and succeeds after generation", async () => {
  const repoRoot = await copyFixtureRepo();
  const staleExit = await runCli([
    "--root",
    repoRoot,
    "--apps-root",
    "./apps",
    "--all-apps",
    "--config",
    DEFAULT_CONFIG_RELATIVE,
    "--check",
  ]);
  assert.equal(staleExit, 1);

  const writeExit = await runCli([
    "--root",
    repoRoot,
    "--apps-root",
    "./apps",
    "--all-apps",
    "--config",
    DEFAULT_CONFIG_RELATIVE,
  ]);
  assert.equal(writeExit, 0);

  const cleanExit = await runCli([
    "--root",
    repoRoot,
    "--apps-root",
    "./apps",
    "--all-apps",
    "--config",
    DEFAULT_CONFIG_RELATIVE,
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
